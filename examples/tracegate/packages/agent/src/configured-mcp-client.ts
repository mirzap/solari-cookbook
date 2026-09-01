import {
  ConfiguredMcpEndpointV1Schema,
  ConfiguredMcpDiscoveryResultV1Schema,
  ConfiguredMcpInvocationRequestSchema,
  ConfiguredMcpToolCatalogV1Schema,
  UntrustedConfiguredMcpResultV1Schema,
  WebMcpClosedInputSchema,
  isTraceGateError,
  redactJson,
  type ConfiguredMcpClientPort,
  type ConfiguredMcpEndpointV1,
  type ConfiguredMcpDiscoveryResultV1,
  type ConfiguredMcpAdmissionDenyCode,
  type ConfiguredMcpInvocationRequest,
  type ConfiguredMcpToolDescriptorV1,
  type JsonObject,
  type UntrustedConfiguredMcpResultV1,
  type WebMcpClosedInput,
} from "@tracegate/shared";
import { terminalError, throwIfAborted } from "./errors.ts";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const MAX_RESPONSE_BYTES = 128 * 1_024;
const MAX_PAGES = 5;
const MAX_RESULT_BYTES = 15_000;
const SAFE_NAME = /^[A-Za-z][A-Za-z0-9_.-]*$/u;
const UNSAFE_CAPABILITY = /(?:auth|credential|password|token|secret|payment|purchase|checkout|message|publish|post|delete|destroy|upload|download|submit)/iu;
const UNSAFE_FIELD = /(?:url|uri|origin|host|endpoint|destination|auth|credential|password|token|secret|payment|card|purchase|message|recipient|publish|file|upload|download|submit)/iu;

interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: number;
  readonly result?: unknown;
  readonly error?: { readonly code?: unknown; readonly message?: unknown };
}

interface Session {
  readonly endpoint: ConfiguredMcpEndpointV1;
  readonly protocolVersion: string;
  readonly sessionId: string | null;
  readonly admitted: Map<string, { readonly name: string; readonly descriptor: ConfiguredMcpToolDescriptorV1 }>;
  nextId: number;
}

type Fetch = typeof fetch;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function boundedString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = String(redactJson(value, { maxStringLength: max }));
  return clean.trim() ? clean.slice(0, max) : undefined;
}

function sanitizeInputSchema(value: unknown): WebMcpClosedInput | null {
  const root = record(value);
  const rawProperties = record(root?.properties ?? {});
  if (root?.type !== "object" || rawProperties === null || Object.keys(rawProperties).length > 16) return null;
  const properties: Record<string, Record<string, unknown>> = {};
  for (const [name, candidate] of Object.entries(rawProperties)) {
    if (!SAFE_NAME.test(name) || name.length > 100 || UNSAFE_FIELD.test(name)) return null;
    const property = record(candidate);
    if (!property || !["string", "number", "integer", "boolean"].includes(String(property.type))) return null;
    const sanitized: Record<string, unknown> = { type: property.type };
    const description = boundedString(property.description, 500);
    if (description) sanitized.description = description;
    if (property.type === "string") {
      if (property.enum !== undefined) {
        if (!Array.isArray(property.enum) || property.enum.length < 1 || property.enum.length > 50 ||
            property.enum.some((item) => typeof item !== "string" || item.length > 1_000 || redactJson(item) !== item)) return null;
        sanitized.enum = property.enum;
      }
      for (const bound of ["minLength", "maxLength"] as const) {
        const raw = property[bound];
        if (raw !== undefined && (!Number.isInteger(raw) || Number(raw) < (bound === "maxLength" ? 1 : 0) || Number(raw) > 2_000)) return null;
        if (raw !== undefined) sanitized[bound] = raw;
      }
    } else if (property.type === "number" || property.type === "integer") {
      for (const bound of ["minimum", "maximum"] as const) {
        const raw = property[bound];
        if (raw !== undefined && (typeof raw !== "number" || !Number.isFinite(raw))) return null;
        if (raw !== undefined) sanitized[bound] = raw;
      }
    }
    properties[name] = sanitized;
  }
  const required = root?.required ?? [];
  if (!Array.isArray(required) || required.some((item) => typeof item !== "string" || !Object.hasOwn(properties, item))) return null;
  const parsed = WebMcpClosedInputSchema.safeParse({ type: "object", properties, required, additionalProperties: false });
  if (!parsed.success || Buffer.byteLength(JSON.stringify(parsed.data), "utf8") > 8_192) return null;
  return parsed.data;
}

function inputMatchesSchema(input: Readonly<Record<string, string | number | boolean | null>>, schema: WebMcpClosedInput): boolean {
  if (schema.required.some((name) => !Object.hasOwn(input, name))) return false;
  for (const [name, value] of Object.entries(input)) {
    const property = schema.properties[name];
    if (!property) return false;
    if (property.type === "string") {
      if (typeof value !== "string" || (property.enum && !property.enum.includes(value)) ||
          (property.minLength !== undefined && value.length < property.minLength) ||
          (property.maxLength !== undefined && value.length > property.maxLength)) return false;
    } else if (property.type === "boolean") {
      if (typeof value !== "boolean") return false;
    } else if (typeof value !== "number" || !Number.isFinite(value) ||
               (property.type === "integer" && !Number.isInteger(value)) ||
               (property.minimum !== undefined && value < property.minimum) ||
               (property.maximum !== undefined && value > property.maximum)) return false;
  }
  return true;
}

async function boundedBody(response: Response, signal: AbortSignal): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    throwIfAborted(signal, "agent.configured_mcp");
    const next = await reader.read();
    if (next.done) break;
    bytes += next.value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw terminalError("target_evidence_lost", "Configured MCP response exceeded its safe bound", "agent.configured_mcp");
    }
    chunks.push(next.value);
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(joined);
}

function parseResponse(text: string, id: number): JsonRpcResponse {
  const candidates: unknown[] = [];
  try {
    candidates.push(JSON.parse(text));
  } catch {
    throw terminalError("target_evidence_lost", "Configured MCP returned malformed protocol data", "agent.configured_mcp");
  }
  const match = candidates.map(record).find((item) => item?.jsonrpc === "2.0" && item.id === id);
  if (!match) throw terminalError("target_evidence_lost", "Configured MCP omitted the requested response", "agent.configured_mcp");
  return match as unknown as JsonRpcResponse;
}

async function readProtocolResponse(response: Response, id: number, signal: AbortSignal): Promise<JsonRpcResponse> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return parseResponse(await boundedBody(response, signal), id);
  if (!contentType.includes("text/event-stream") || !response.body) {
    throw terminalError("target_evidence_lost", "Configured MCP returned an unsupported content type", "agent.configured_mcp");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let bytes = 0;
  try {
    while (true) {
      throwIfAborted(signal, "agent.configured_mcp");
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw terminalError("target_evidence_lost", "Configured MCP response exceeded its safe bound", "agent.configured_mcp");
      buffer += decoder.decode(next.value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/u);
      buffer = events.pop() ?? "";
      for (const event of events) {
        const data = event.split(/\r?\n/u).filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart()).join("\n");
        if (!data) continue;
        try {
          const parsed = parseResponse(data, id);
          await reader.cancel();
          return parsed;
        } catch (error) {
          if (record(JSON.parse(data))?.id === id) throw error;
        }
      }
    }
  } catch (error) {
    if (signal.aborted) throwIfAborted(signal, "agent.configured_mcp");
    if (isTraceGateError(error)) throw error;
    throw terminalError("target_evidence_lost", "Configured MCP returned malformed protocol data", "agent.configured_mcp", { cause: error });
  } finally {
    try { reader.releaseLock(); } catch { /* bounded transport cleanup */ }
  }
  throw terminalError("target_evidence_lost", "Configured MCP omitted the requested response", "agent.configured_mcp");
}

function safeSessionId(value: string | null): string | null {
  return value !== null && /^[\x21-\x7e]{1,512}$/u.test(value) ? value : null;
}

function boundedOutput(result: Record<string, unknown>): { output: JsonObject; summary: string; truncated: boolean } {
  const source = record(result.structuredContent) ?? { content: result.content ?? [], isError: result.isError === true };
  let output = redactJson(source, { maxStringLength: 2_000, maxDepth: 6, maxArrayLength: 40, maxObjectKeys: 50 });
  if (!record(output)) output = { value: output };
  let truncated = JSON.stringify(output).length > MAX_RESULT_BYTES;
  if (truncated) output = { summary: "Configured MCP result exceeded the safe output bound" };
  const text = Array.isArray(result.content)
    ? result.content.map(record).map((item) => item?.type === "text" ? boundedString(item.text, 500) : undefined).filter(Boolean).join(" ")
    : "";
  const summary = boundedString(text || (result.isError === true ? "Configured MCP tool reported an error" : "Configured MCP tool completed"), 2_000)!;
  return { output: output as JsonObject, summary, truncated };
}

export class StreamableHttpConfiguredMcpClient implements ConfiguredMcpClientPort {
  readonly #fetch: Fetch;
  readonly #sessions = new Map<string, Promise<Session>>();

  constructor(fetchImplementation: Fetch = fetch) { this.#fetch = fetchImplementation; }

  async discover(endpointInput: ConfiguredMcpEndpointV1, signal: AbortSignal): Promise<ConfiguredMcpDiscoveryResultV1> {
    const endpoint = ConfiguredMcpEndpointV1Schema.parse(endpointInput);
    const session = await this.#session(endpoint, signal);
    const descriptors: ConfiguredMcpToolDescriptorV1[] = [];
    const denied = new Map<string, ConfiguredMcpAdmissionDenyCode>(
      endpoint.selectedTools.map((name) => [name, "not_found"]),
    );
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = record(await this.#request(session, "tools/list", cursor ? { cursor } : {}, signal));
      if (!result || !Array.isArray(result.tools)) throw terminalError("target_evidence_lost", "Configured MCP returned an invalid tool catalog", "agent.configured_mcp");
      for (const raw of result.tools) {
        const tool = record(raw);
        const annotations = record(tool?.annotations);
        const name = typeof tool?.name === "string" ? tool.name : "";
        if (!endpoint.selectedTools.includes(name) || !SAFE_NAME.test(name) || name.length > 100) continue;
        const description = boundedString(tool?.description, 1_000);
        const schema = sanitizeInputSchema(tool?.inputSchema);
        if (!description) { denied.set(name, "malformed_descriptor"); continue; }
        if (!schema) { denied.set(name, "unsupported_input_schema"); continue; }
        if (annotations?.readOnlyHint !== true || annotations.destructiveHint === true) {
          denied.set(name, "missing_read_only_declaration"); continue;
        }
        if (UNSAFE_CAPABILITY.test(`${name} ${description}`)) {
          denied.set(name, "sensitive_or_unsafe_capability"); continue;
        }
        const parsed = ConfiguredMcpToolCatalogV1Schema.element.safeParse({
          schemaVersion: 1,
          endpointId: endpoint.id,
          id: `${endpoint.id}:${name}`,
          name,
          description,
          inputSchema: schema,
          trust: "untrusted_configured_mcp_capability",
          serverDeclaredReadOnly: true,
          admission: "locally_admitted_read_only",
        });
        if (!parsed.success) { denied.set(name, "sensitive_or_unsafe_capability"); continue; }
        if (descriptors.some((item) => item.id === parsed.data.id)) continue;
        if (Buffer.byteLength(JSON.stringify([...descriptors, parsed.data]), "utf8") > 24_000) {
          denied.set(name, "tool_limit_exceeded"); continue;
        }
        descriptors.push(parsed.data);
        denied.delete(name);
      }
      cursor = typeof result.nextCursor === "string" && result.nextCursor.length <= 1_000 ? result.nextCursor : undefined;
      if (!cursor || descriptors.length >= endpoint.selectedTools.length) break;
    }
    const catalog = ConfiguredMcpToolCatalogV1Schema.parse(descriptors.slice(0, endpoint.selectedTools.length));
    session.admitted.clear();
    for (const descriptor of catalog) session.admitted.set(descriptor.id, { name: descriptor.name, descriptor });
    return ConfiguredMcpDiscoveryResultV1Schema.parse({
      schemaVersion: 1,
      readiness: {
        schemaVersion: 1,
        endpointId: endpoint.id,
        label: endpoint.label,
        transport: endpoint.transport,
        selectedTools: endpoint.selectedTools,
        admittedTools: catalog.map((tool) => tool.name),
        deniedTools: endpoint.selectedTools
          .filter((name) => denied.has(name))
          .map((name) => ({ name, code: denied.get(name)! })),
      },
      admittedTools: catalog,
    });
  }

  async invoke(endpointInput: ConfiguredMcpEndpointV1, requestInput: ConfiguredMcpInvocationRequest, signal: AbortSignal): Promise<UntrustedConfiguredMcpResultV1> {
    const endpoint = ConfiguredMcpEndpointV1Schema.parse(endpointInput);
    const request = ConfiguredMcpInvocationRequestSchema.parse(requestInput);
    if (request.endpointId !== endpoint.id) throw terminalError("unsafe_action_blocked", "Configured MCP endpoint identity changed after admission", "agent.configured_mcp", { policyCode: "native_tool_forbidden" });
    const session = await this.#session(endpoint, signal);
    const admitted = session.admitted.get(request.toolId);
    if (!admitted) throw terminalError("unsafe_action_blocked", "Configured MCP tool was not admitted by discovery", "agent.configured_mcp", { policyCode: "native_tool_forbidden" });
    if (!endpoint.selectedTools.includes(admitted.name) || !inputMatchesSchema(request.input, admitted.descriptor.inputSchema)) {
      throw terminalError("unsafe_action_blocked", "Configured MCP invocation no longer matches its admitted closed schema", "agent.configured_mcp", { policyCode: "native_tool_forbidden" });
    }
    const result = record(await this.#request(session, "tools/call", { name: admitted.name, arguments: request.input }, signal));
    if (!result) throw terminalError("target_evidence_lost", "Configured MCP returned an invalid tool result", "agent.configured_mcp");
    const bounded = boundedOutput(result);
    return UntrustedConfiguredMcpResultV1Schema.parse({
      schemaVersion: 1,
      endpointId: endpoint.id,
      toolId: request.toolId,
      trust: "untrusted_configured_mcp_result",
      summary: bounded.summary,
      output: bounded.output,
      truncated: bounded.truncated,
      redacted: true,
    });
  }

  async close(signal: AbortSignal): Promise<void> {
    throwIfAborted(signal, "agent.configured_mcp");
    const sessions = await Promise.allSettled(this.#sessions.values());
    for (const settled of sessions) {
      if (settled.status !== "fulfilled" || !settled.value.sessionId) continue;
      const session = settled.value;
      const response = await this.#fetch(session.endpoint.endpointUrl, {
        method: "DELETE", redirect: "error", signal,
        headers: this.#headers(session, "shutdown"),
      });
      if (!response.ok && response.status !== 405) {
        throw terminalError("target_evidence_lost", "Configured MCP session cleanup was not confirmed", "agent.configured_mcp");
      }
    }
    this.#sessions.clear();
  }

  async #session(endpoint: ConfiguredMcpEndpointV1, signal: AbortSignal): Promise<Session> {
    const key = `${endpoint.id}\u0000${endpoint.endpointUrl}\u0000${endpoint.selectedTools.join("\u0000")}`;
    const existing = this.#sessions.get(key);
    if (existing) {
      const session = await existing;
      if (session.endpoint.endpointUrl !== endpoint.endpointUrl) throw terminalError("unsafe_action_blocked", "Configured MCP endpoint ID was rebound", "agent.configured_mcp", { policyCode: "origin_not_admitted" });
      return session;
    }
    const pending = this.#initialize(endpoint, signal);
    this.#sessions.set(key, pending);
    try { return await pending; }
    catch (error) { this.#sessions.delete(key); throw error; }
  }

  async #initialize(endpoint: ConfiguredMcpEndpointV1, signal: AbortSignal): Promise<Session> {
    const response = await this.#post(endpoint, null, 1, "initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "tracegate", version: "0.0.0" },
    }, signal);
    const root = record(response.result);
    const protocolVersion = typeof root?.protocolVersion === "string" ? root.protocolVersion : "";
    if (protocolVersion !== MCP_PROTOCOL_VERSION) throw terminalError("target_evidence_lost", "Configured MCP negotiated an unsupported protocol version", "agent.configured_mcp");
    const session: Session = { endpoint, protocolVersion, sessionId: response.sessionId, admitted: new Map(), nextId: 2 };
    await this.#notification(session, "notifications/initialized", signal);
    return session;
  }

  async #request(session: Session, method: string, params: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    const id = session.nextId++;
    const response = await this.#post(session.endpoint, session, id, method, params, signal);
    if (response.response.error) throw terminalError("target_evidence_lost", "Configured MCP returned a protocol error", "agent.configured_mcp");
    return response.response.result;
  }

  async #notification(session: Session, method: string, signal: AbortSignal): Promise<void> {
    const response = await this.#fetch(session.endpoint.endpointUrl, {
      method: "POST", redirect: "error", signal,
      headers: this.#headers(session, method),
      body: JSON.stringify({ jsonrpc: "2.0", method }),
    });
    if (response.status !== 202 && !response.ok) throw terminalError("target_evidence_lost", "Configured MCP rejected lifecycle initialization", "agent.configured_mcp");
  }

  async #post(endpoint: ConfiguredMcpEndpointV1, session: Session | null, id: number, method: string, params: Record<string, unknown>, signal: AbortSignal): Promise<{ response: JsonRpcResponse; sessionId: string | null; result?: unknown }> {
    throwIfAborted(signal, "agent.configured_mcp");
    let response: Response;
    try {
      response = await this.#fetch(endpoint.endpointUrl, {
        method: "POST", redirect: "error", signal,
        headers: this.#headers(session, method, method === "tools/call" ? String(params.name ?? "") : undefined),
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      });
    } catch (error) {
      if (signal.aborted) throwIfAborted(signal, "agent.configured_mcp");
      throw terminalError("target_evidence_lost", "Configured MCP endpoint was unavailable", "agent.configured_mcp", { cause: error });
    }
    if (!response.ok) throw terminalError("target_evidence_lost", `Configured MCP returned HTTP ${response.status}`, "agent.configured_mcp");
    const parsed = await readProtocolResponse(response, id, signal);
    if (parsed.error) throw terminalError("target_evidence_lost", "Configured MCP returned a protocol error", "agent.configured_mcp");
    const sessionId = safeSessionId(response.headers.get("mcp-session-id"));
    return { response: parsed, sessionId, result: parsed.result };
  }

  #headers(session: Session | null, method: string, name?: string): Headers {
    const headers = new Headers({
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-method": method,
    });
    if (name) headers.set("mcp-name", name);
    if (session) {
      headers.set("mcp-protocol-version", session.protocolVersion);
      if (session.sessionId) headers.set("mcp-session-id", session.sessionId);
    }
    return headers;
  }
}

export function createConfiguredMcpClient(fetchImplementation: Fetch = fetch): ConfiguredMcpClientPort {
  return new StreamableHttpConfiguredMcpClient(fetchImplementation);
}
