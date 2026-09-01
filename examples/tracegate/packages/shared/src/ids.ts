import { z } from "zod";

const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuidV7<T extends string>(name: T) {
  return z.string().regex(uuidV7Pattern, `${name} must be a UUIDv7`).brand<T>();
}

export const EvaluationIdSchema = uuidV7("EvaluationId");
export const RunIdSchema = uuidV7("RunId");
export const EventIdSchema = uuidV7("EventId");
export const ToolCallIdSchema = z.string().trim().min(1).max(128).brand<"ToolCallId">();
export const BrowserSessionIdSchema = z.string().trim().min(1).max(256).brand<"BrowserSessionId">();
export const ChallengeIdSchema = z.string().trim().min(16).max(256).brand<"ChallengeId">();
export const RequestIdSchema = z.string().trim().min(1).max(128).brand<"RequestId">();

export const UtcDateTimeSchema = z.iso.datetime({ offset: false });
export const EventCursorSchema = z.string().regex(/^[1-9][0-9]*$/, "cursor must be a positive canonical decimal string");
export const RunSequenceSchema = z.number().int().safe().nonnegative();
export const ObservationRevisionSchema = z.number().int().safe().positive();
export const DemoMutationRevisionSchema = z.number().int().safe().nonnegative().brand<"DemoMutationRevision">();
export const ElementRefSchema = z.string().regex(/^e:[1-9][0-9]*:[0-9]+$/);

export type EvaluationId = z.infer<typeof EvaluationIdSchema>;
export type RunId = z.infer<typeof RunIdSchema>;
export type EventId = z.infer<typeof EventIdSchema>;
export type ToolCallId = z.infer<typeof ToolCallIdSchema>;
export type BrowserSessionId = z.infer<typeof BrowserSessionIdSchema>;
export type ChallengeId = z.infer<typeof ChallengeIdSchema>;
export type RequestId = z.infer<typeof RequestIdSchema>;
export type UtcDateTime = z.infer<typeof UtcDateTimeSchema>;
export type EventCursor = z.infer<typeof EventCursorSchema>;
export type RunSequence = z.infer<typeof RunSequenceSchema>;
export type ObservationRevision = z.infer<typeof ObservationRevisionSchema>;
export type DemoMutationRevision = z.infer<typeof DemoMutationRevisionSchema>;
export type ElementRef = z.infer<typeof ElementRefSchema>;
