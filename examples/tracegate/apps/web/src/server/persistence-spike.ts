import type {
  EvaluationId,
  EvaluationSnapshot,
  EventEnvelope,
} from "@tracegate/shared";
import {
  TracegateDatabase,
  type PersistRunMilestoneInput,
  type PersistedRunMilestone,
} from "@tracegate/db";

import {
  createMilestoneSseResponse,
  type MilestoneSubscriber,
  type MilestoneSubscriptionSource,
  type SseOptions,
} from "./sse.ts";

class PersistedMilestoneBus implements MilestoneSubscriptionSource {
  readonly #subscribers = new Map<EvaluationId, Set<MilestoneSubscriber>>();

  publish(event: EventEnvelope): void {
    const subscribers = this.#subscribers.get(event.evaluationId);
    if (subscribers === undefined) return;
    for (const subscriber of [...subscribers]) subscriber(event);
  }

  subscribe(evaluationId: EvaluationId, subscriber: MilestoneSubscriber): () => void {
    const subscribers = this.#subscribers.get(evaluationId) ?? new Set<MilestoneSubscriber>();
    subscribers.add(subscriber);
    this.#subscribers.set(evaluationId, subscribers);
    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0) this.#subscribers.delete(evaluationId);
    };
  }

  subscriberCount(evaluationId: EvaluationId): number {
    return this.#subscribers.get(evaluationId)?.size ?? 0;
  }
}

export class PersistenceSpikeServer {
  readonly #milestones = new PersistedMilestoneBus();
  readonly database: TracegateDatabase;

  constructor(database: TracegateDatabase) {
    this.database = database;
  }

  getSnapshot(evaluationId: EvaluationId, signal: AbortSignal): Promise<EvaluationSnapshot | null> {
    return this.database.getEvaluationSnapshot(evaluationId, signal);
  }

  async persistMilestone(input: PersistRunMilestoneInput, signal: AbortSignal): Promise<PersistedRunMilestone> {
    const persisted = await this.database.persistRunMilestone(input, signal);
    this.#milestones.publish(persisted.event);
    return persisted;
  }

  eventStream(evaluationId: EvaluationId, signal: AbortSignal, options?: SseOptions): Response {
    return createMilestoneSseResponse(this.#milestones, evaluationId, signal, options);
  }

  subscriberCount(evaluationId: EvaluationId): number {
    return this.#milestones.subscriberCount(evaluationId);
  }
}
