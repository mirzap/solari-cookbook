import { createHash } from "node:crypto"

import {
  DiscoveryEvidenceSchema,
  PublicHttpsOriginSchema,
  RunWarningSchema,
  type BrowserController,
  type DiscoveryContext,
  type DiscoveryController,
  type DiscoveryEvidence,
  type ObservationRevision,
  type WebMcpReadOnlyAdapterPort,
  type WebMcpToolDescriptorV1,
} from "@tracegate/shared"

const MAX_DISCOVERY_BYTES = 65_536
const MAX_PREVIEW_CHARS = 4_096

export interface BrowserDiscoverySource {
  currentPageDiscoverySnapshot(signal: AbortSignal): Promise<{
    observationRevision: ObservationRevision
    jsonLdTexts: readonly string[]
    jsonLdTruncated?: boolean
    webMcpPresent: boolean
  }>
  readCurrentOriginText(
    path: string,
    maxBytes: number,
    signal: AbortSignal,
  ): Promise<{
    status: number
    finalUrl: string
    text: string
    truncated: boolean
  }>
}

export interface TraceGateDiscoveryControllerOptions {
  readonly source: BrowserDiscoverySource
  readonly now?: () => Date
  readonly webMcp?: {
    readonly enabled: boolean
    readonly adapter: WebMcpReadOnlyAdapterPort
    readonly controller: BrowserController
  }
}

interface JsonLdTraversalState {
  nodes: number
  truncated: boolean
}

function collectJsonLdTypes(
  value: unknown,
  output: Set<string>,
  state: JsonLdTraversalState,
  depth = 0,
): void {
  if (value === null || typeof value !== "object") return
  if (output.size >= 100 || state.nodes >= 1_000 || depth > 8) {
    state.truncated = true
    return
  }
  state.nodes += 1
  if (Array.isArray(value)) {
    for (const item of value) {
      if (output.size >= 100 || state.nodes >= 1_000) {
        state.truncated = true
        break
      }
      collectJsonLdTypes(item, output, state, depth + 1)
    }
    return
  }
  const record = value as Record<string, unknown>
  const type = record["@type"]
  if (typeof type === "string" && type.trim() && output.size < 100) {
    output.add(type.trim().slice(0, 200))
  }
  if (Array.isArray(type)) {
    for (const item of type) {
      if (output.size >= 100) {
        state.truncated = true
        break
      }
      if (typeof item === "string" && item.trim()) output.add(item.trim().slice(0, 200))
    }
  }
  for (const nested of Object.values(record)) {
    if (output.size >= 100 || state.nodes >= 1_000) {
      state.truncated = true
      break
    }
    collectJsonLdTypes(nested, output, state, depth + 1)
  }
}

export class TraceGateDiscoveryController implements DiscoveryController {
  readonly #source: BrowserDiscoverySource
  readonly #now: () => Date
  readonly #webMcp: TraceGateDiscoveryControllerOptions["webMcp"]
  #lastWebMcpTools: readonly WebMcpToolDescriptorV1[] = []

  constructor(options: TraceGateDiscoveryControllerOptions) {
    this.#source = options.source
    this.#now = options.now ?? (() => new Date())
    this.#webMcp = options.webMcp
  }

  get lastAdmittedWebMcpTools(): readonly WebMcpToolDescriptorV1[] {
    return this.#lastWebMcpTools
  }

  async discover(
    context: DiscoveryContext,
    signal: AbortSignal,
  ): Promise<DiscoveryEvidence> {
    if (signal.aborted) throw signal.reason
    this.#lastWebMcpTools = []
    const currentOrigin = PublicHttpsOriginSchema.parse(
      new URL(context.observation.url).origin,
    )
    if (!context.admittedTarget.allowedNavigationOrigins.includes(currentOrigin)) {
      throw new Error("Discovery observation origin is not admitted")
    }

    const snapshot = await this.#source.currentPageDiscoverySnapshot(signal)
    if (snapshot.observationRevision !== context.observation.revision) {
      throw new Error("Discovery source revision does not match observation")
    }

    const discoveredAt = this.#now().toISOString()
    const interfaces: Array<{
      schemaVersion: 1
      kind: "semantic" | "llms_txt" | "json_ld" | "webmcp"
      name: string
      metadata: Record<string, string | number | boolean | null>
      discoveredAt: string
    }> = [
      {
        schemaVersion: 1,
        kind: "semantic",
        name: "semantic-controls",
        metadata: { count: context.observation.elements.length },
        discoveredAt,
      },
    ]

    const llms = await this.#discoverLlmsTxt(currentOrigin, signal)
    if (llms.status === "available") {
      interfaces.push({
        schemaVersion: 1,
        kind: "llms_txt",
        name: "llms.txt",
        metadata: {
          sizeBytes: llms.sizeBytes,
          sha256: llms.sha256,
          truncated: llms.truncated,
        },
        discoveredAt,
      })
    }

    const jsonLdTypes = new Set<string>()
    const jsonLdTraversal: JsonLdTraversalState = { nodes: 0, truncated: false }
    let jsonLdTruncated = snapshot.jsonLdTruncated === true
    let jsonLdBytes = 0
    for (const text of snapshot.jsonLdTexts) {
      jsonLdBytes += Buffer.byteLength(text, "utf8")
      if (jsonLdBytes > MAX_DISCOVERY_BYTES) {
        jsonLdTruncated = true
        break
      }
      try {
        collectJsonLdTypes(JSON.parse(text), jsonLdTypes, jsonLdTraversal)
      } catch {
        // Invalid page metadata is untrusted and ignored.
      }
    }
    jsonLdTruncated ||= jsonLdTraversal.truncated
    for (const type of jsonLdTypes) {
      interfaces.push({
        schemaVersion: 1,
        kind: "json_ld",
        name: type,
        metadata: { type },
        discoveredAt,
      })
    }

    let webMcpDiscoveryFailed = false
    let webMcpGate: "unavailable" | "available_disabled" | "discover_only" | "admitted_read_only" = "unavailable"
    if (snapshot.webMcpPresent) {
      if (context.interfaceMode === "semantic-only" || !this.#webMcp?.enabled) {
        webMcpGate = "available_disabled"
      } else {
        try {
          this.#lastWebMcpTools = await this.#webMcp.adapter.discover(
            this.#webMcp.controller,
            currentOrigin,
            signal,
          )
          webMcpGate = this.#lastWebMcpTools.length > 0
            ? "admitted_read_only"
            : "discover_only"
        } catch (error) {
          if (signal.aborted) throw error
          this.#lastWebMcpTools = []
          webMcpDiscoveryFailed = true
          webMcpGate = "discover_only"
        }
      }
      interfaces.push({
        schemaVersion: 1,
        kind: "webmcp",
        name: "document.modelContext",
        metadata: {
          gate: webMcpGate,
          admittedToolCount: this.#lastWebMcpTools.length,
        },
        discoveredAt,
      })
    }

    const warnings: ReturnType<typeof RunWarningSchema.parse>[] = []
    if (
      snapshot.webMcpPresent &&
      context.interfaceMode !== "semantic-only" &&
      this.#webMcp?.enabled &&
      webMcpGate !== "admitted_read_only"
    ) {
      warnings.push(
        RunWarningSchema.parse({
          schemaVersion: 1,
          category: "unsupported_interface",
          code: "webmcp_degraded",
          phase: "discovery",
          retryable: false,
          message: webMcpDiscoveryFailed
            ? "WebMCP discovery failed; semantic browser controls remain available"
            : "No page-provided WebMCP tool passed read-only admission",
          fieldIssues: [],
          causeChain: [],
        }),
      )
    }

    return DiscoveryEvidenceSchema.parse({
      schemaVersion: 1,
      observationRevision: context.observation.revision,
      semanticControlCount: context.observation.elements.length,
      llmsTxt: llms,
      jsonLdTypes: [...jsonLdTypes],
      webMcpGate,
      interfaces,
      warnings,
      truncated: context.observation.truncated || llms.truncated || jsonLdTruncated,
    })
  }

  async #discoverLlmsTxt(currentOrigin: string, signal: AbortSignal) {
    const response = await this.#source.readCurrentOriginText(
      "/llms.txt",
      MAX_DISCOVERY_BYTES,
      signal,
    )
    if (response.status === 404) {
      return {
        status: "not_found" as const,
        sha256: null,
        sizeBytes: null,
        preview: null,
        truncated: false,
      }
    }
    let finalOrigin: string | null = null
    try {
      finalOrigin = new URL(response.finalUrl).origin
    } catch {
      // A malformed final URL is blocked evidence.
    }
    if (response.status < 200 || response.status >= 300 || finalOrigin !== currentOrigin) {
      return {
        status: "blocked" as const,
        sha256: null,
        sizeBytes: null,
        preview: null,
        truncated: false,
      }
    }
    const bytes = Buffer.from(response.text, "utf8")
    return {
      status: "available" as const,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      sizeBytes: bytes.byteLength,
      preview: response.text.slice(0, MAX_PREVIEW_CHARS),
      truncated: response.truncated,
    }
  }
}
