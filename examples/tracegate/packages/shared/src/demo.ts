import { z } from "zod";

import { ScenarioIdSchema } from "./config.ts";
import { DemoGradeEvidenceSchema } from "./grading.ts";
import {
  ChallengeIdSchema,
  DemoMutationRevisionSchema,
  EvaluationIdSchema,
  RunIdSchema,
  UtcDateTimeSchema,
} from "./ids.ts";

export const SensitiveChallengeNavigationUrlSchema = z.url().superRefine((value, context) => {
  const url = new URL(value);
  if (url.protocol !== "https:") context.addIssue({ code: "custom", message: "challenge navigation must use HTTPS" });
  if (url.username || url.password) context.addIssue({ code: "custom", message: "challenge navigation credentials are forbidden" });
  if (value.includes("#")) context.addIssue({ code: "custom", message: "challenge navigation fragments are forbidden" });
}).brand<"SensitiveChallengeNavigationUrl">();

export const CreateDemoChallengeRequestSchema = z.object({
  schemaVersion: z.literal(1),
  evaluationId: EvaluationIdSchema,
  runId: RunIdSchema,
  challengeId: ChallengeIdSchema,
  scenarioId: ScenarioIdSchema,
});

export const DemoChallengeProvisionSchema = z.object({
  schemaVersion: z.literal(1),
  evaluationId: EvaluationIdSchema,
  runId: RunIdSchema,
  challengeId: ChallengeIdSchema,
  navigationUrl: SensitiveChallengeNavigationUrlSchema,
  initialMutationRevision: DemoMutationRevisionSchema,
  expiresAt: UtcDateTimeSchema,
});

export const GetDemoGradeEvidenceRequestSchema = z.object({
  schemaVersion: z.literal(1),
  runId: RunIdSchema,
  challengeId: ChallengeIdSchema,
});

export const DemoGradeEvidenceEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  runId: RunIdSchema,
  challengeId: ChallengeIdSchema,
  evidence: DemoGradeEvidenceSchema,
}).superRefine((value, context) => {
  if (value.challengeId !== value.evidence.challengeId) {
    context.addIssue({ code: "custom", path: ["evidence", "challengeId"], message: "evidence challengeId must match envelope" });
  }
});

export type SensitiveChallengeNavigationUrl = z.infer<typeof SensitiveChallengeNavigationUrlSchema>;
export type CreateDemoChallengeRequest = z.infer<typeof CreateDemoChallengeRequestSchema>;
export type DemoChallengeProvision = z.infer<typeof DemoChallengeProvisionSchema>;
export type GetDemoGradeEvidenceRequest = z.infer<typeof GetDemoGradeEvidenceRequestSchema>;
export type DemoGradeEvidenceEnvelope = z.infer<typeof DemoGradeEvidenceEnvelopeSchema>;
