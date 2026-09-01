import type {
  AgentRunner,
  AssertionEvidenceCapture,
  BrowserControllerFactory,
  BrowserProvider,
  DiscoveryController,
  EvaluationRepository,
  EvaluationSubmissionRepository,
  EventRepository,
  FailureAnalyzer,
  Grader,
  ProviderCapacityPort,
  ProviderSessionReconciliationPort,
  ReplayService,
  RunRepository,
  RunTransitionRepository,
  SafeAgentToolPort,
  TargetAdmissionPort,
} from "@tracegate/shared";
import { PublicEvaluationConfigV2Schema } from "@tracegate/shared";
import { evaluationConfigFixture, type DeterministicClock } from "@tracegate/shared/testing";

export interface DownstreamCompositionV2 {
  admission: TargetAdmissionPort;
  browserProvider: BrowserProvider;
  browserControllerFactory: BrowserControllerFactory;
  providerReconciliation: ProviderSessionReconciliationPort;
  providerCapacity: ProviderCapacityPort;
  discovery: DiscoveryController;
  agent: AgentRunner;
  safeTools: SafeAgentToolPort;
  capture: AssertionEvidenceCapture;
  grader: Grader;
  failureAnalyzer: FailureAnalyzer;
  submissions: EvaluationSubmissionRepository;
  evaluations: EvaluationRepository;
  runs: RunRepository;
  runTransitions: RunTransitionRepository;
  events: EventRepository;
  replay: ReplayService;
  clock: DeterministicClock;
}

export const downstreamConfigV2 = PublicEvaluationConfigV2Schema.parse(evaluationConfigFixture);
