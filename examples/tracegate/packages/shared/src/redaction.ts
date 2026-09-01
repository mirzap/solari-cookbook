import type { JsonValue } from "./json.ts";

export const REDACTED_VALUE = "[REDACTED]" as const;
export const TRUNCATED_VALUE = "[TRUNCATED]" as const;

export const SENSITIVE_KEY_PATTERN = /(?:authorization|api[-_]?key|token|secret|password|cookie|cdp|websocket|replay[-_]?url|challenge)/i;
export const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /\bBasic\s+[A-Za-z0-9+/]+=*/gi,
  /\b(?:sk|or|solari)[-_][A-Za-z0-9_-]{12,}\b/g,
  /\b(?:wss?|https?):\/\/[^\s"']*(?:token|secret|key|signature|sig|challenge)=[^\s&"']+/gi,
] as const;

export interface RedactionOptions {
  readonly knownSecrets?: readonly string[];
  readonly maxStringLength?: number;
  readonly maxDepth?: number;
  readonly maxArrayLength?: number;
  readonly maxObjectKeys?: number;
}

const redactText = (value: string, options: Required<RedactionOptions>): string => {
  let redacted = value;
  for (const secret of options.knownSecrets) {
    if (secret.length > 0) redacted = redacted.replaceAll(secret, REDACTED_VALUE);
  }
  for (const pattern of SECRET_PATTERNS) redacted = redacted.replace(pattern, REDACTED_VALUE);
  try {
    const parsed = new URL(redacted);
    if (parsed.protocol === "ws:" || parsed.protocol === "wss:" || parsed.username || parsed.password) {
      redacted = REDACTED_VALUE;
    } else if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      for (const key of [...parsed.searchParams.keys()]) {
        if (SENSITIVE_KEY_PATTERN.test(key) || /^(?:sig|signature|credential|auth|expires)$/i.test(key)) {
          parsed.searchParams.set(key, REDACTED_VALUE);
        }
      }
      redacted = parsed.toString();
    }
  } catch {
    // Non-URL text continues through bounded redaction.
  }
  return redacted.length <= options.maxStringLength
    ? redacted
    : `${redacted.slice(0, options.maxStringLength)}${TRUNCATED_VALUE}`;
};

export const redactJson = (value: unknown, input: RedactionOptions = {}): JsonValue => {
  const options: Required<RedactionOptions> = {
    knownSecrets: input.knownSecrets ?? [],
    maxStringLength: input.maxStringLength ?? 4_000,
    maxDepth: input.maxDepth ?? 8,
    maxArrayLength: input.maxArrayLength ?? 100,
    maxObjectKeys: input.maxObjectKeys ?? 100,
  };
  const visit = (candidate: unknown, depth: number): JsonValue => {
    if (depth > options.maxDepth) return TRUNCATED_VALUE;
    if (candidate === null || typeof candidate === "boolean") return candidate;
    if (typeof candidate === "number") return Number.isFinite(candidate) ? candidate : String(candidate);
    if (typeof candidate === "string") return redactText(candidate, options);
    if (Array.isArray(candidate)) return candidate.slice(0, options.maxArrayLength).map((item) => visit(item, depth + 1));
    if (typeof candidate === "object") {
      const output: Record<string, JsonValue> = {};
      const entries = Object.entries(candidate as Record<string, unknown>).slice(0, options.maxObjectKeys);
      for (const [key, nested] of entries) output[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED_VALUE : visit(nested, depth + 1);
      return output;
    }
    return redactText(String(candidate), options);
  };
  return visit(value, 0);
};

export const redactError = (error: unknown, options?: RedactionOptions): { name: string; message: string } => {
  if (error instanceof Error) {
    return { name: error.name, message: String(redactJson(error.message, options)) };
  }
  return { name: "Error", message: String(redactJson(error, options)) };
};
