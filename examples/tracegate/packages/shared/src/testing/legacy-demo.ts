import { z } from "zod";

/**
 * @internal Legacy deterministic fixture data only.
 * This module is intentionally absent from the package root export and contains no production target,
 * admin port, challenge navigation, or grading contract.
 */
export const LegacyDemoCartLineSchema = z.object({
  productSlug: z.string().trim().min(1).max(200),
  productName: z.string().trim().min(1).max(500),
  variant: z.record(z.string().max(100), z.string().max(500)),
  quantity: z.number().int().positive().max(100),
}).strict();

export const LegacyDemoFixtureDataSchema = z.object({
  scenario: z.literal("classic-tee-size-m-v1"),
  cart: z.array(LegacyDemoCartLineSchema).max(100),
}).strict();

export type LegacyDemoCartLine = z.infer<typeof LegacyDemoCartLineSchema>;
export type LegacyDemoFixtureData = z.infer<typeof LegacyDemoFixtureDataSchema>;
