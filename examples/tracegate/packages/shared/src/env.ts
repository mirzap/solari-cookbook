import { z } from "zod";

import { TraceGateError, createControlError, zodIssuesToFieldIssues } from "./errors.ts";

export const SecretStringSchema = z.string().min(1).refine((value) => value === value.trim(), "secret cannot have leading or trailing whitespace").brand<"SecretString">();
export type SecretString = z.infer<typeof SecretStringSchema>;

export const ServerEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  OPENROUTER_API_KEY: SecretStringSchema,
  SOLARI_API_KEY: SecretStringSchema,
  DATABASE_URL: z.string().trim().min(1).refine(
    (value) => value.startsWith("file:") || value.startsWith("libsql://") || value.startsWith("https://"),
    "DATABASE_URL must use file:, libsql://, or https://",
  ),
  DATABASE_AUTH_TOKEN: SecretStringSchema.optional(),
  TRACEGATE_PUBLIC_BASE_URL: z.url().superRefine((value, context) => {
    const url = new URL(value);
    if (url.protocol !== "https:") context.addIssue({ code: "custom", message: "must use HTTPS" });
    if (url.username || url.password) context.addIssue({ code: "custom", message: "credentials are forbidden" });
  }),
  TRACEGATE_ADMIN_BASE_URL: z.url().superRefine((value, context) => {
    const url = new URL(value);
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) context.addIssue({ code: "custom", message: "must use HTTPS or loopback HTTP" });
    if (url.username || url.password) context.addIssue({ code: "custom", message: "credentials are forbidden" });
  }),
  TRACEGATE_TUNNEL_COMMAND: z.string().trim().min(1).max(2_000).optional(),
  TRACEGATE_LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
}).superRefine((env, context) => {
  if (env.DATABASE_URL.startsWith("libsql://") && env.DATABASE_AUTH_TOKEN === undefined) {
    context.addIssue({ code: "custom", path: ["DATABASE_AUTH_TOKEN"], message: "required for libsql:// databases" });
  }
});

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
