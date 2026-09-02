import { z } from "zod";

export const NetworkHostnameClassificationSchema = z.enum([
  "loopback_name",
  "public_dns_name",
  "forbidden_special_name",
  "ip_literal",
]);

export const ResolvedIpClassificationSchema = z.enum([
  "loopback",
  "public",
  "private_or_reserved",
  "invalid",
]);

export type NetworkHostnameClassification = z.infer<typeof NetworkHostnameClassificationSchema>;
export type ResolvedIpClassification = z.infer<typeof ResolvedIpClassificationSchema>;

function parseIpv4(value: string): readonly number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^(?:0|[1-9][0-9]{0,2})$/u.test(part)) return null;
    const byte = Number(part);
    if (!Number.isInteger(byte) || byte > 255) return null;
    bytes.push(byte);
  }
  return bytes;
}

function parseIpv6Part(part: string): number[] | null {
  if (part === "") return [];
  const tokens = part.split(":");
  const words: number[] = [];
  for (const [index, token] of tokens.entries()) {
    if (token.includes(".")) {
      if (index !== tokens.length - 1) return null;
      const ipv4 = parseIpv4(token);
      if (ipv4 === null) return null;
      words.push((ipv4[0]! << 8) | ipv4[1]!, (ipv4[2]! << 8) | ipv4[3]!);
      continue;
    }
    if (!/^[0-9a-f]{1,4}$/iu.test(token)) return null;
    words.push(Number.parseInt(token, 16));
  }
  return words;
}

function parseIpv6(value: string): readonly number[] | null {
  if (value.includes("%") || !value.includes(":")) return null;
  const compressionIndex = value.indexOf("::");
  if (compressionIndex !== -1 && compressionIndex !== value.lastIndexOf("::")) return null;

  const headText = compressionIndex === -1 ? value : value.slice(0, compressionIndex);
  const tailText = compressionIndex === -1 ? "" : value.slice(compressionIndex + 2);
  const head = parseIpv6Part(headText);
  const tail = parseIpv6Part(tailText);
  if (head === null || tail === null) return null;

  let words: number[];
  if (compressionIndex === -1) {
    if (head.length !== 8) return null;
    words = head;
  } else {
    if (head.length + tail.length >= 8) return null;
    words = [...head, ...new Array<number>(8 - head.length - tail.length).fill(0), ...tail];
  }

  return words.flatMap((word) => [word >>> 8, word & 0xff]);
}

function normalizedIpLiteral(address: string): string {
  const trimmed = address.trim().toLocaleLowerCase("en-US");
  return trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
}

function hasPrefix(bytes: readonly number[], prefix: readonly number[], bits: number): boolean {
  const wholeBytes = Math.floor(bits / 8);
  const remainingBits = bits % 8;
  for (let index = 0; index < wholeBytes; index += 1) {
    if (bytes[index] !== prefix[index]) return false;
  }
  if (remainingBits === 0) return true;
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return ((bytes[wholeBytes] ?? 0) & mask) === ((prefix[wholeBytes] ?? 0) & mask);
}

function classifyIpv4(bytes: readonly number[]): Exclude<ResolvedIpClassification, "invalid"> {
  if (bytes[0] === 127) return "loopback";
  const reserved =
    bytes[0] === 0
    || bytes[0] === 10
    || (bytes[0] === 100 && (bytes[1] ?? 0) >= 64 && (bytes[1] ?? 0) <= 127)
    || (bytes[0] === 169 && bytes[1] === 254)
    || (bytes[0] === 172 && (bytes[1] ?? 0) >= 16 && (bytes[1] ?? 0) <= 31)
    || (bytes[0] === 192 && bytes[1] === 0 && bytes[2] === 0)
    || (bytes[0] === 192 && bytes[1] === 0 && bytes[2] === 2)
    || (bytes[0] === 192 && bytes[1] === 88 && bytes[2] === 99)
    || (bytes[0] === 192 && bytes[1] === 168)
    || (bytes[0] === 198 && (bytes[1] === 18 || bytes[1] === 19))
    || (bytes[0] === 198 && bytes[1] === 51 && bytes[2] === 100)
    || (bytes[0] === 203 && bytes[1] === 0 && bytes[2] === 113)
    || (bytes[0] ?? 0) >= 224;
  return reserved ? "private_or_reserved" : "public";
}

function allZero(bytes: readonly number[], endExclusive: number): boolean {
  for (let index = 0; index < endExclusive; index += 1) {
    if (bytes[index] !== 0) return false;
  }
  return true;
}

function classifyIpv6(bytes: readonly number[]): Exclude<ResolvedIpClassification, "invalid"> {
  if (allZero(bytes, 15) && bytes[15] === 1) return "loopback";
  if (allZero(bytes, 10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return classifyIpv4(bytes.slice(12));
  }

  const reservedPrefixes: ReadonlyArray<readonly [readonly number[], number]> = [
    [[0x00], 8], // unspecified, IPv4-compatible, and other low special space
    [[0x00, 0x64, 0xff, 0x9b, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00], 96], // well-known NAT64
    [[0x00, 0x64, 0xff, 0x9b, 0x00, 0x01], 48], // local-use NAT64
    [[0x01, 0x00], 16], // discard-only
    [[0x20, 0x01, 0x00], 23], // IETF protocol assignments, Teredo, benchmarking, ORCHID
    [[0x20, 0x01, 0x0d, 0xb8], 32], // documentation
    [[0x20, 0x02], 16], // deprecated 6to4
    [[0x3f, 0xff], 20], // documentation
    [[0x5f, 0x00], 16], // segment-routing SIDs
    [[0xfc], 7], // unique local
    [[0xfe, 0x80], 10], // link-local
    [[0xfe, 0xc0], 10], // deprecated site-local
    [[0xff], 8], // multicast
  ];
  return reservedPrefixes.some(([prefix, bits]) => hasPrefix(bytes, prefix, bits))
    ? "private_or_reserved"
    : "public";
}

/** Pure address classification; no DNS lookup or platform networking API is used. */
export function classifyResolvedIp(address: string): ResolvedIpClassification {
  const normalized = normalizedIpLiteral(address);
  const ipv4 = parseIpv4(normalized);
  if (ipv4 !== null) return classifyIpv4(ipv4);
  const ipv6 = parseIpv6(normalized);
  if (ipv6 !== null) return classifyIpv6(ipv6);
  return "invalid";
}

const FORBIDDEN_EXACT_NAMES = new Set([
  "example",
  "example.com",
  "example.net",
  "example.org",
  "home.arpa",
  "internal",
  "invalid",
  "lan",
  "local",
  "onion",
  "test",
]);
const FORBIDDEN_SUFFIXES = [
  ".example",
  ".example.com",
  ".example.net",
  ".example.org",
  ".home.arpa",
  ".internal",
  ".invalid",
  ".lan",
  ".local",
  ".localhost",
  ".onion",
  ".test",
] as const;

/** Pure structural hostname classification; callers retain DNS and all-answer admission. */
export function classifyNetworkHostname(hostname: string): NetworkHostnameClassification {
  let normalized = hostname.trim().toLocaleLowerCase("en-US");
  const hasOpeningBracket = normalized.startsWith("[");
  const hasClosingBracket = normalized.endsWith("]");
  if (hasOpeningBracket || hasClosingBracket) {
    if (!hasOpeningBracket || !hasClosingBracket) return "forbidden_special_name";
    const bracketedAddress = normalized.slice(1, -1);
    return parseIpv6(bracketedAddress) === null ? "forbidden_special_name" : "ip_literal";
  }
  if (normalized === "localhost") return "loopback_name";
  if (classifyResolvedIp(normalized) !== "invalid") return "ip_literal";
  if (normalized.length < 1 || normalized.length > 253 || normalized.includes(":")) return "forbidden_special_name";
  if (normalized.endsWith(".")) normalized = normalized.slice(0, -1);
  if (/^[0-9.]+$/u.test(normalized)) return "forbidden_special_name";

  const labels = normalized.split(".");
  if (labels.length < 2 || labels.some((label) =>
    label.length < 1
    || label.length > 63
    || !/^[a-z0-9-]+$/u.test(label)
    || label.startsWith("-")
    || label.endsWith("-"),
  )) return "forbidden_special_name";

  if (FORBIDDEN_EXACT_NAMES.has(normalized) || FORBIDDEN_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
    return "forbidden_special_name";
  }
  return "public_dns_name";
}
