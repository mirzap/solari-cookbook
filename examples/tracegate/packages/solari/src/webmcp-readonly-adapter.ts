import { createHash } from "node:crypto"

import {
  PublicHttpsOriginSchema,
  UntrustedWebMcpResultV1Schema,
  WebMcpInvocationRequestSchema,
  WebMcpToolCatalogV1Schema,
  WebMcpToolDescriptorV1Schema,
  redactJson,
  type BrowserController,
  type PublicHttpsOrigin,
  type UntrustedWebMcpResultV1,
  type WebMcpClosedInput,
  type WebMcpInvocationRequest,
  type WebMcpReadOnlyAdapterPort,
  type WebMcpToolDescriptorV1,
} from "@tracegate/shared"

import type { RawCurrentOriginWebMcpTool } from "./browser-controller.js"

const MAX_RESULT_BYTES = 12_000
const ROOT_SCHEMA_KEYS = new Set(["type", "properties", "required", "additionalProperties"])
const PROPERTY_SCHEMA_KEYS = new Set([
  "type",
  "description",
  "enum",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
])

interface WebMcpControllerSource {
  currentBrowserOrigin(): string
  currentOriginWebMcpTools(signal: AbortSignal): Promise<readonly RawCurrentOriginWebMcpTool[]>
  invokeCurrentOriginWebMcpTool(
    name: string,
    input: Readonly<Record<string, string | number | boolean | null>>,
    signal: AbortSignal,
  ): Promise<string>
}

function asSource(controller: BrowserController): WebMcpControllerSource {
  const candidate = controller as BrowserController & Partial<WebMcpControllerSource>
  if (
    typeof candidate.currentOriginWebMcpTools !== "function" ||
    typeof candidate.invokeCurrentOriginWebMcpTool !== "function" ||
    typeof candidate.currentBrowserOrigin !== "function"
  ) {
    throw new Error("Browser controller does not expose the WebMCP adapter capability")
  }
  return candidate as WebMcpControllerSource
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function sanitizeInputSchema(value: unknown): WebMcpClosedInput | null {
  const root = record(value)
  if (!root || Object.keys(root).some((key) => !ROOT_SCHEMA_KEYS.has(key))) return null
  if (
    root.type !== "object" ||
    root.additionalProperties !== false ||
    !record(root.properties) ||
    (root.required !== undefined && !Array.isArray(root.required))
  ) {
    return null
  }

  const properties: Record<string, unknown> = {}
  for (const [name, rawProperty] of Object.entries(root.properties as Record<string, unknown>)) {
    const property = record(rawProperty)
    if (!property || Object.keys(property).some((key) => !PROPERTY_SCHEMA_KEYS.has(key))) {
      return null
    }
    properties[name] = property
  }
  const parsed = WebMcpToolDescriptorV1Schema.shape.inputSchema.safeParse({
    type: "object",
    properties,
    required: root.required ?? [],
    additionalProperties: false,
  })
  return parsed.success ? parsed.data : null
}

function declaredReadOnly(value: unknown): boolean {
  return record(value)?.readOnlyHint === true
}

function descriptorId(
  currentOrigin: PublicHttpsOrigin,
  tool: RawCurrentOriginWebMcpTool,
  inputSchema: WebMcpClosedInput,
): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([currentOrigin, tool.name, tool.description, inputSchema]))
    .digest("hex")
    .slice(0, 32)
  return `webmcp:${digest}`
}

function sanitizeTool(
  currentOrigin: PublicHttpsOrigin,
  tool: RawCurrentOriginWebMcpTool,
): WebMcpToolDescriptorV1 | null {
  if (!declaredReadOnly(tool.annotations)) return null
  const inputSchema = sanitizeInputSchema(tool.inputSchema)
  if (!inputSchema) return null
  const parsed = WebMcpToolDescriptorV1Schema.safeParse({
    schemaVersion: 1,
    id: descriptorId(currentOrigin, tool, inputSchema),
    name: tool.name,
    description: tool.description,
    inputSchema,
    currentOrigin,
    trust: "untrusted_page_capability",
    declaredReadOnly: true,
  })
  return parsed.success ? parsed.data : null
}

function inputMatchesSchema(
  input: Readonly<Record<string, string | number | boolean | null>>,
  schema: WebMcpClosedInput,
): boolean {
  const keys = Object.keys(input)
  if (keys.some((key) => !(key in schema.properties))) return false
  if (schema.required.some((key) => !(key in input))) return false
  for (const [key, value] of Object.entries(input)) {
    const property = schema.properties[key]
    if (!property || value === null) return false
    if (property.type === "string") {
      if (typeof value !== "string") return false
      if (property.enum && !property.enum.includes(value)) return false
      if (property.minLength !== undefined && value.length < property.minLength) return false
      if (property.maxLength !== undefined && value.length > property.maxLength) return false
    } else if (property.type === "boolean") {
      if (typeof value !== "boolean") return false
    } else {
      if (typeof value !== "number" || !Number.isFinite(value)) return false
      if (property.type === "integer" && !Number.isInteger(value)) return false
      if (property.minimum !== undefined && value < property.minimum) return false
      if (property.maximum !== undefined && value > property.maximum) return false
    }
  }
  return true
}

function boundedResult(raw: string): { value: unknown; truncated: boolean } {
  const bytes = Buffer.from(raw, "utf8")
  const truncated = bytes.length > MAX_RESULT_BYTES
  const text = (truncated ? bytes.subarray(0, MAX_RESULT_BYTES) : bytes).toString("utf8")
  if (!truncated) {
    try {
      return { value: JSON.parse(text), truncated: false }
    } catch {
      // Plain text is a permitted untrusted result shape.
    }
  }
  return { value: { text }, truncated }
}

export class SolariWebMcpReadOnlyAdapter implements WebMcpReadOnlyAdapterPort {
  readonly #catalogByController = new WeakMap<
    BrowserController,
    ReadonlyMap<string, WebMcpToolDescriptorV1>
  >()

  async discover(
    controller: BrowserController,
    currentOrigin: PublicHttpsOrigin,
    signal: AbortSignal,
  ): Promise<readonly WebMcpToolDescriptorV1[]> {
    if (signal.aborted) throw signal.reason
    const origin = PublicHttpsOriginSchema.parse(currentOrigin)
    const source = asSource(controller)
    if (source.currentBrowserOrigin() !== origin) {
      throw new Error("WebMCP discovery origin does not match the current page")
    }
    const raw = await source.currentOriginWebMcpTools(signal)
    const admitted: WebMcpToolDescriptorV1[] = []
    for (const tool of raw) {
      const descriptor = sanitizeTool(origin, tool)
      if (descriptor) admitted.push(descriptor)
      if (admitted.length === 10) break
    }
    const catalog = WebMcpToolCatalogV1Schema.parse(admitted)
    this.#catalogByController.set(
      controller,
      new Map(catalog.map((descriptor) => [descriptor.id, descriptor])),
    )
    return catalog
  }

  async invoke(
    controller: BrowserController,
    request: WebMcpInvocationRequest,
    signal: AbortSignal,
  ): Promise<UntrustedWebMcpResultV1> {
    if (signal.aborted) throw signal.reason
    const parsedRequest = WebMcpInvocationRequestSchema.parse(request)
    const previous = this.#catalogByController.get(controller)?.get(parsedRequest.toolId)

    // Re-discover immediately before dispatch. A page can unregister and
    // replace a tool between model proposal and execution.
    const currentCatalog = await this.discover(
      controller,
      parsedRequest.currentOrigin,
      signal,
    )
    const descriptor = currentCatalog.find(
      (candidate) => candidate.id === parsedRequest.toolId,
    )
    if (!descriptor || !previous || JSON.stringify(descriptor) !== JSON.stringify(previous)) {
      throw new Error("WebMCP descriptor changed before invocation")
    }
    if (!inputMatchesSchema(parsedRequest.input, descriptor.inputSchema)) {
      throw new Error("WebMCP input does not satisfy the admitted closed schema")
    }

    const raw = await asSource(controller).invokeCurrentOriginWebMcpTool(
      descriptor.name,
      parsedRequest.input,
      signal,
    )
    const output = boundedResult(raw)
    const redacted = redactJson(output.value, {
      maxStringLength: 2_000,
      maxDepth: 5,
      maxArrayLength: 50,
      maxObjectKeys: 50,
    })
    const safeOutput =
      typeof redacted === "object" && redacted !== null && !Array.isArray(redacted)
        ? redacted
        : { value: redacted }
    return UntrustedWebMcpResultV1Schema.parse({
      schemaVersion: 1,
      toolId: descriptor.id,
      trust: "untrusted_page_tool_result",
      summary: "WebMCP returned bounded untrusted current-origin data",
      output: safeOutput,
      truncated: output.truncated,
      redacted: true,
    })
  }
}
