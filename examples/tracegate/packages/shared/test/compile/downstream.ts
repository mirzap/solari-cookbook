import type {
  AgentRunner,
  BrowserProvider,
  DiscoveryController,
  DemoAdminPort,
  EvaluationRepository,
  EventRepository,
  FailureAnalyzer,
  Grader,
  ReplayService,
  RunRepository,
} from "@tracegate/shared";
import { EvaluationConfigSchema } from "@tracegate/shared";
import { evaluationConfigFixture, type DeterministicClock } from "@tracegate/shared/testing";

export interface DownstreamComposition {
  browserProvider: BrowserProvider;
  discovery: DiscoveryController;
  demoAdmin: DemoAdminPort;
  agent: AgentRunner;
  grader: Grader;
  failureAnalyzer: FailureAnalyzer;
  evaluations: EvaluationRepository;
  runs: RunRepository;
  events: EventRepository;
  replay: ReplayService;
  clock: DeterministicClock;
}

export const downstreamConfig = EvaluationConfigSchema.parse(evaluationConfigFixture);
