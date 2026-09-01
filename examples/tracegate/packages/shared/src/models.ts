import { z } from "zod";
import { ControlErrorSchema } from "./errors.ts";
import { UtcDateTimeSchema } from "./ids.ts";

export const ModelIdSchema = z.enum([
  "deepseek/deepseek-v4-flash-0731",
  "mistralai/mistral-small-2603",
  "openai/gpt-5-mini",
]);

export const ModelCapabilityStatusSchema = z.enum([
  "pending",
  "verified",
  "failed",
  "not_configured",
]);

export const ModelDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  id: ModelIdSchema,
  displayName: z.string().trim().min(1).max(100),
  enabled: z.boolean(),
  capabilityStatus: ModelCapabilityStatusSchema,
  checkedAt: UtcDateTimeSchema.nullable(),
  resolvedProvider: z.string().trim().min(1).max(200).nullable(),
  safeFailure: ControlErrorSchema.nullable(),
});

export const ModelCapabilityCheckSchema = ModelDefinitionSchema.pick({
  id: true,
  capabilityStatus: true,
  checkedAt: true,
  resolvedProvider: true,
  safeFailure: true,
});

export type ModelId = z.infer<typeof ModelIdSchema>;
export type ModelDefinition = z.infer<typeof ModelDefinitionSchema>;
export type ModelCapabilityCheck = z.infer<typeof ModelCapabilityCheckSchema>;
