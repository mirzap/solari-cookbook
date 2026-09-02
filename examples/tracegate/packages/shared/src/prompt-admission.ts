import { z } from "zod";

export const MAX_ADMISSION_PROMPT_CHARACTERS = 1_000;

export const PromptAdmissionRejectCodeSchema = z.enum([
  "prompt_out_of_bounds",
  "messaging_or_submission_requested",
  "authentication_or_account_creation_requested",
  "financial_transaction_requested",
  "destructive_action_requested",
  "file_transfer_or_permission_requested",
  "sensitive_data_requested",
]);

export const PromptAdmissionCodeSchema = z.union([
  z.literal("admitted_read_only_task"),
  PromptAdmissionRejectCodeSchema,
]);

export const PromptAdmissionDecisionSchema = z.discriminatedUnion("decision", [
  z.object({
    schemaVersion: z.literal(1),
    decision: z.literal("admit"),
    code: z.literal("admitted_read_only_task"),
    message: z.literal("This task is within the read-only public evaluation boundary."),
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    decision: z.literal("reject"),
    code: PromptAdmissionRejectCodeSchema,
    message: z.string().min(1).max(240),
  }).strict(),
]);

export type PromptAdmissionRejectCode = z.infer<typeof PromptAdmissionRejectCodeSchema>;
export type PromptAdmissionCode = z.infer<typeof PromptAdmissionCodeSchema>;
export type PromptAdmissionDecision = z.infer<typeof PromptAdmissionDecisionSchema>;

const REJECTION_MESSAGES: Readonly<Record<PromptAdmissionRejectCode, string>> = {
  prompt_out_of_bounds: "Enter a task between 1 and 1,000 characters.",
  messaging_or_submission_requested: "TraceGate can inspect communication surfaces, but it cannot send, submit, or publish content.",
  authentication_or_account_creation_requested: "TraceGate can inspect account-access surfaces, but it cannot create accounts, sign in, or authenticate.",
  financial_transaction_requested: "TraceGate can inspect transaction surfaces, but it cannot make purchases, payments, bookings, trades, or donations.",
  destructive_action_requested: "TraceGate can inspect controls, but it cannot perform destructive or account-changing actions.",
  file_transfer_or_permission_requested: "TraceGate can inspect file and permission surfaces, but it cannot transfer files or change device permissions.",
  sensitive_data_requested: "TraceGate cannot enter, collect, or expose credentials or sensitive personal data.",
};

type EffectPattern = Readonly<{
  code: Exclude<PromptAdmissionRejectCode, "prompt_out_of_bounds">;
  expressions: readonly RegExp[];
}>;

const EFFECT_PATTERNS: readonly EffectPattern[] = [
  {
    code: "messaging_or_submission_requested",
    expressions: [
      /\b(?:send|sending|sent|submit|submitting|submitted|publish|publishing|published|reply|respond)\b/iu,
      /\b(?:message|email|text)\s+(?:me|us|them|him|her|someone|support|a\s+(?:user|person|contact)|the\s+(?:team|owner|seller|recipient))\b/iu,
      /\bpost\s+(?:a|an|the|this|that|my|our)\b/iu,
      /\b(?:leave|add|write|compose|deliver)\s+(?:a\s+)?(?:comment|review|reply|message|email|text)\b/iu,
    ],
  },
  {
    code: "authentication_or_account_creation_requested",
    expressions: [
      /\bsign[-\s]*(?:up|in)\b/iu,
      /\b(?:log|logging|logged)[-\s]+in\b/iu,
      /\blogin\b/iu,
      /\b(?:register|registering|registered|authenticate|authenticating|authenticated)\b/iu,
      /\b(?:complete|perform|start)\s+(?:the\s+)?authentication\b/iu,
      /\b(?:complete|fill|use)\s+(?:a|an|the)?\s*registration\s+form\b/iu,
      /\b(?:create|activate)\s+(?:a|an|the|my|new)?\s*(?:account|profile)\b/iu,
      /\b(?:change|reset)\s+(?:a|the|my)?\s*password\b/iu,
    ],
  },
  {
    code: "financial_transaction_requested",
    expressions: [
      /\b(?:buy|buying|bought|purchase|purchasing|purchased|pay|paying|paid|checkout|book|booking|booked|reserve|reserving|reserved|trade|trading|traded|donate|donating|donated|subscribe|subscribing|subscribed)\b/iu,
      /\b(?:make|start|place|complete|confirm|schedule)\s+(?:a|an|the|my)?\s*(?:order|purchase|payment|booking|reservation|trade|trading|donation|appointment)\b/iu,
    ],
  },
  {
    code: "destructive_action_requested",
    expressions: [
      /\b(?:delete|deleting|deleted|erase|erasing|erased|destroy|destroying|destroyed|cancel|cancelling|canceling|cancelled|canceled|unsubscribe|unsubscribing|unsubscribed|deactivate|deactivating|deactivated)\b/iu,
      /\b(?:remove|close|reset)\s+(?:a|an|the|my|this|that)?\s*(?:account|profile|order|booking|reservation|subscription|record|data|content)\b/iu,
    ],
  },
  {
    code: "file_transfer_or_permission_requested",
    expressions: [
      /\b(?:upload|uploading|uploaded|download|downloading|downloaded|install|installing|installed|import|importing|imported|export|exporting|exported)\b/iu,
      /\b(?:grant|give|approve|change|request)\s+(?:a|an|the|device|browser|site|location|camera|microphone)?\s*permissions?\b/iu,
      /\b(?:enable|allow|share)\s+(?:the\s+)?(?:camera|microphone|location|notifications?|screen|clipboard)\b/iu,
      /\b(?:grant|give|approve|allow)\s+(?:the\s+)?(?:site|browser|app)?\s*(?:camera|microphone|location|notification|screen|clipboard)?\s*access\b/iu,
    ],
  },
  {
    code: "sensitive_data_requested",
    expressions: [
      /\b(?:enter|type|fill|provide|collect|capture|request|ask\s+for|paste|use|save|store|record|copy|extract)\b.{0,48}\b(?:password|passcode|pin|otp|one[- ]time\s+(?:code|password)|credit\s*card|card\s*number|cvv|cvc|social\s+security|ssn|passport|driver(?:'s)?\s+licen[cs]e|date\s+of\s+birth|bank\s+account|api\s*key|access\s*token|private\s*key|seed\s+phrase|secret|email\s+address|phone\s+number)\b/iu,
    ],
  },
] as const;

const SAFE_SURFACE_REFERENCE = /\b(?:open|visit|view|inspect|check|read|find|locate|navigate\s+to|go\s+to)\s+(?:the\s+|a\s+|an\s+)?(?:contact|registration|sign[-\s]?up|log[-\s]?in|login|authentication|account|checkout|payment|booking|purchase|download|upload|permission|permissions)\s+(?:page|screen|form|link|section|button|control|status|details|history)\b/giu;
const SAFE_READ_ONLY_CLAUSE = /\b(?:view|inspect|check|read|find|locate|verify|observe)\b(?:(?!\b(?:and|but|then|by|using|via|while|after|before|whether|to|can|could|will|would)\b|[.;,]).){0,120}/giu;
const IMMEDIATE_NEGATION = /(?:without|do\s+not|don't|never|not)\s+(?:(?:actually|ever|attempt(?:ing)?\s+to|trying\s+to)\s+)?$/iu;

function normalizePrompt(prompt: string): string {
  return prompt
    .normalize("NFKC")
    .replace(/[\u2018\u2019]/gu, "'")
    .replace(/[\u2010-\u2015]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function maskSafeSurfaceReferences(prompt: string): string {
  return prompt
    .replace(SAFE_SURFACE_REFERENCE, (match) => " ".repeat(match.length))
    .replace(SAFE_READ_ONLY_CLAUSE, (match) => " ".repeat(match.length));
}

function isImmediatelyNegated(prompt: string, start: number): boolean {
  return IMMEDIATE_NEGATION.test(prompt.slice(Math.max(0, start - 48), start));
}

function rejected(code: PromptAdmissionRejectCode): PromptAdmissionDecision {
  return {
    schemaVersion: 1,
    decision: "reject",
    code,
    message: REJECTION_MESSAGES[code],
  };
}

/**
 * Pure, model-independent prompt admission. It inspects at most the public
 * prompt bound, returns only closed codes/static messages, and never includes
 * prompt text in its decision.
 */
export function classifyPromptAdmission(prompt: string): PromptAdmissionDecision {
  const normalized = normalizePrompt(prompt);
  if (normalized.length < 1 || prompt.length > MAX_ADMISSION_PROMPT_CHARACTERS) {
    return rejected("prompt_out_of_bounds");
  }

  const candidate = maskSafeSurfaceReferences(normalized);
  let firstMatch: { readonly index: number; readonly order: number; readonly code: EffectPattern["code"] } | null = null;
  let order = 0;

  for (const group of EFFECT_PATTERNS) {
    for (const expression of group.expressions) {
      const match = expression.exec(candidate);
      if (match?.index !== undefined && !isImmediatelyNegated(candidate, match.index)) {
        const current = { index: match.index, order, code: group.code };
        if (firstMatch === null || current.index < firstMatch.index || (current.index === firstMatch.index && current.order < firstMatch.order)) {
          firstMatch = current;
        }
      }
      order += 1;
    }
  }

  return firstMatch === null
    ? {
        schemaVersion: 1,
        decision: "admit",
        code: "admitted_read_only_task",
        message: "This task is within the read-only public evaluation boundary.",
      }
    : rejected(firstMatch.code);
}
