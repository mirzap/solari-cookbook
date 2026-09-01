import { randomBytes } from "node:crypto";

import {
  CreateAttemptCorrelationIdSchema,
  EvaluationIdSchema,
  EventIdSchema,
  RunIdSchema,
  type CreateAttemptCorrelationId,
  type EvaluationId,
  type EventId,
  type IdGenerator,
  type RunId,
} from "@tracegate/shared";

function uuidV7(now = Date.now()): string {
  const bytes = randomBytes(16);
  let timestamp = BigInt(now);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = 0x70 | (bytes[6]! & 0x0f);
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class UuidV7Generator implements IdGenerator {
  evaluationId(): EvaluationId {
    return EvaluationIdSchema.parse(uuidV7());
  }

  runId(): RunId {
    return RunIdSchema.parse(uuidV7());
  }

  eventId(): EventId {
    return EventIdSchema.parse(uuidV7());
  }

  createAttemptCorrelationId(): CreateAttemptCorrelationId {
    return CreateAttemptCorrelationIdSchema.parse(`create-${uuidV7()}`);
  }
}
