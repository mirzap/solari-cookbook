import { z } from "zod";
import { TraceGateError, createControlError, zodIssuesToFieldIssues } from "./errors.ts";

export const SecretStringSchema = z.string().min(1).refine((value) => value === value.trim(), "secret cannot have leading or trailing whitespace").brand<"SecretString">();
export type SecretString = z.infer<typeof SecretStringSchema>;

export const LoopbackHostSchema = z.enum(["127.0.0.1", "::1"]);

export const ServerEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  OPENROUTER_API_KEY: SecretStringSchema,
  SOLARI_API_KEY: SecretStringSchema,
  DATABASE_URL: z.string().trim().min(1).refine((value) => value.startsWith("file:"), "P0 DATABASE_URL must be local file:"),
  TRACEGATE_BIND_HOST: LoopbackHostSchema.default("127.0.0.1"),
  TRACEGATE_PORT: z.coerce.number().int().min(1_024).max(65_535).default(3_000),
  TRACEGATE_LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
}).strict();

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

export const parseServerEnv = (input: Record<string, string | undefined>): ServerEnv => {
  const result = ServerEnvSchema.safeParse(input);
  if (result.success) return result.data;
  throw new TraceGateError(createControlError(
    "validation_failed",
    "Server environment validation failed",
    { category: "unknown", phase: "configuration", fieldIssues: zodIssuesToFieldIssues(result.error) },
  ));
};
