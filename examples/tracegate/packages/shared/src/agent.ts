import { z } from "zod";
import { ElementRefSchema, ObservationRevisionSchema } from "./ids.ts";
import { JsonObjectSchema } from "./json.ts";
import { RunWarningSchema } from "./errors.ts";

const boundedUrl = z.url().max(2_048);
const boundedText = z.string().max(4_000);

export const AgentActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("navigate"), url: boundedUrl }),
  z.object({ kind: z.literal("inspect") }),
  z.object({ kind: z.literal("click"), ref: ElementRefSchema }),
  z.object({ kind: z.literal("type"), ref: ElementRefSchema, text: boundedText, clearFirst: z.boolean().default(true) }),
  z.object({ kind: z.literal("select"), ref: ElementRefSchema, value: z.string().max(500) }),
  z.object({ kind: z.literal("pressKey"), key: z.enum(["Enter", "Escape", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Backspace"]) }),
  z.object({ kind: z.literal("scroll"), direction: z.enum(["up", "down"]), amount: z.number().int().min(1).max(5_000) }),
  z.object({ kind: z.literal("wait"), durationMs: z.number().int().min(0).max(15_000) }),
  z.object({ kind: z.literal("callNativeTool"), name: z.string().trim().min(1).max(128), arguments: JsonObjectSchema }),
  z.object({ kind: z.literal("finish"), completed: z.boolean(), summary: z.string().max(2_000) }),
]);

export const CompactElementSchema = z.object({
  ref: ElementRefSchema,
  role: z.string().trim().min(1).max(100),
  name: z.string().max(500),
  disabled: z.boolean().nullable(),
  checked: z.boolean().nullable(),
  selected: z.boolean().nullable(),
  expanded: z.boolean().nullable(),
  attributes: z.record(z.string().max(100), z.string().max(500)).default({}),
});

export const NativeToolSummarySchema = z.object({
  name: z.string().trim().min(1).max(128),
  description: z.string().max(1_000),
  invocable: z.boolean(),
});

export const AgentObservationSchema = z.object({
  schemaVersion: z.literal(1),
  revision: ObservationRevisionSchema,
  url: boundedUrl,
  title: z.string().max(500),
  visibleText: z.string().max(20_000),
  nativeTools: z.array(NativeToolSummarySchema).max(50),
  elements: z.array(CompactElementSchema).max(100),
  discoverySummary: z.string().max(2_000),
  truncated: z.boolean(),
}).superRefine((value, context) => {
  for (const [index, element] of value.elements.entries()) {
    const revision = Number(element.ref.split(":")[1]);
    if (revision !== value.revision) {
      context.addIssue({ code: "custom", path: ["elements", index, "ref"], message: "element ref revision must match observation" });
    }
  }
});

export const TokenUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative().nullable(),
  completionTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
});

export const AgentRunResultSchema = z.object({
  schemaVersion: z.literal(1),
  completedBelief: z.boolean(),
  summary: z.string().max(2_000),
  iterations: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  browserActions: z.number().int().nonnegative(),
  usage: TokenUsageSchema,
  resolvedProvider: z.string().min(1).max(200).nullable(),
  warnings: z.array(RunWarningSchema).max(50),
});

export type AgentAction = z.infer<typeof AgentActionSchema>;
export type CompactElement = z.infer<typeof CompactElementSchema>;
export type AgentObservation = z.infer<typeof AgentObservationSchema>;
export type TokenUsage = z.infer<typeof TokenUsageSchema>;
export type AgentRunResult = z.infer<typeof AgentRunResultSchema>;
