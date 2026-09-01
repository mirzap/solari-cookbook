import {
  CreateEvaluationRequestSchema,
  type CreateEvaluationRequest,
  type InterfaceMode,
  type ModelId,
} from "@tracegate/shared";

export type AssertionKind = "url" | "text" | "semantic" | "state";

export interface AssertionDraft {
  readonly key: number;
  readonly kind: AssertionKind;
  readonly value: string;
  readonly name: string;
}

export interface EvaluationFormDraft {
  readonly startUrl: string;
  readonly allowedOriginsText: string;
  readonly prompt: string;
  readonly assertions: readonly AssertionDraft[];
  readonly modelIds: readonly ModelId[];
  readonly runsPerModel: number;
  readonly concurrency: number;
  readonly recordingRequested: boolean;
  readonly interfaceMode?: InterfaceMode;
  readonly webMcpReadOnlyEnabled: boolean;
  readonly configuredMcpEnabled?: boolean;
  readonly configuredMcpLabel?: string;
  readonly configuredMcpEndpointUrl?: string;
  readonly configuredMcpSelectedToolsText?: string;
}

export function assertionFromDraft(draft: AssertionDraft, index: number) {
  const id = `assertion-${index + 1}`;
  if (draft.kind === "url") return {
    schemaVersion: 1, id, kind: "url", operator: "origin_and_path_equals", expectedUrl: draft.value,
  } as const;
  if (draft.kind === "text") return {
    schemaVersion: 1, id, kind: "text", scope: "document_visible_text", operator: "contains", expected: draft.value, caseSensitive: false,
  } as const;
  const locator = {
    role: draft.value || "heading",
    accessibleName: { operator: "contains", value: draft.name, caseSensitive: false },
  } as const;
  if (draft.kind === "semantic") return {
    schemaVersion: 1, id, kind: "semantic", locator, count: { operator: "at_least", value: 1 },
  } as const;
  return {
    schemaVersion: 1, id, kind: "state", locator, property: "selected", expected: true,
  } as const;
}

export function createEvaluationRequestFromDraft(draft: EvaluationFormDraft): CreateEvaluationRequest {
  return CreateEvaluationRequestSchema.parse({
    schemaVersion: 2,
    target: {
      kind: "public-web",
      startUrl: draft.startUrl,
      allowedNavigationOrigins: draft.allowedOriginsText.split(/[\n,]/).map((origin) => origin.trim()).filter(Boolean),
    },
    prompt: draft.prompt,
    assertions: draft.assertions.map(assertionFromDraft),
    safetyPolicyVersion: "public-safe-v1",
    modelIds: draft.modelIds,
    requestedRunsPerModel: draft.runsPerModel,
    requestedConcurrency: draft.concurrency,
    interfaceMode: draft.interfaceMode ?? "auto",
    webMcpReadOnlyEnabled: draft.webMcpReadOnlyEnabled,
    configuredMcpEndpoints: draft.configuredMcpEnabled === true ? [{
      schemaVersion: 1,
      id: "developer-mcp",
      label: draft.configuredMcpLabel ?? "Configured MCP",
      endpointUrl: draft.configuredMcpEndpointUrl ?? "",
      transport: "streamable-http",
      authentication: "none",
      selectedTools: (draft.configuredMcpSelectedToolsText ?? "").split(/[\n,]/).map((name) => name.trim()).filter(Boolean),
    }] : undefined,
    recordingRequested: draft.recordingRequested,
  });
}
