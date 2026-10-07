/**
 * MCP gate entrypoint.
 *
 * Layer 0: user policy (allow/ask lists, annotation trust).
 * Layer 1: tool identity (name/title + description) verb classification.
 * Layer 2: inputSchema shape (force/recursive/command/dry-run keys).
 * Layer 3: call arguments (recursive, depth/size bounded, decodes
 *          percent/base64 payloads once).
 * Layer 4: annotations (treated as untrusted hints by default).
 * Layer 5: scoring and decision, plus a human-readable summary.
 *
 * Design rule: unknown or ambiguous writes fail closed (ask). A tool
 * name that claims read-only is not trusted to lower risk unless the
 * policy explicitly opts in AND no destructive evidence exists.
 */

import { MCP_DEFAULT_ASK_THRESHOLD } from "./constants";
import {
  addFinding,
  analyzeSchema,
  containsProduction,
  createState,
  isSimpleChange,
  walkArguments,
} from "./signals";
import type {
  McpClassification,
  McpDecision,
  McpFinding,
  McpGateInput,
  McpGateResult,
} from "./types";
import {
  CLASSIFICATION_RANK,
  classifyDescription,
  collectVerbHits,
  strongestHit,
  tokenize,
} from "./verbs";

export function evaluateMcpCall(input: McpGateInput): McpGateResult {
  const policy = input.policy ?? {};
  const askThreshold = policy.askThreshold ?? MCP_DEFAULT_ASK_THRESHOLD;
  const toolName = input.call?.name ?? input.tool.name;
  const lowered = toolName.toLowerCase();

  const baseResult = (
    decision: McpDecision,
    classification: McpClassification,
    riskScore: number,
    reason: string,
    findings: McpFinding[],
    summary: string
  ): McpGateResult => ({
    decision,
    classification,
    riskScore,
    askThreshold,
    findings,
    reason,
    summary,
  });

  // Layer 0: explicit policy.
  if (
    policy.allowTools?.includes(toolName) ||
    policy.allowPrefixes?.some((prefix) =>
      lowered.startsWith(prefix.toLowerCase())
    )
  ) {
    return baseResult(
      "allow",
      "unknown",
      0,
      "POLICY_ALLOW",
      [],
      `${toolName} is explicitly allowed by policy`
    );
  }

  if (policy.askTools?.includes(toolName)) {
    return baseResult(
      "ask",
      "unknown",
      100,
      "POLICY_ASK",
      [],
      `${toolName} is explicitly ask-listed by policy`
    );
  }

  // Layer 1: name/title classification.
  const nameTokens = tokenize(`${input.tool.title ?? ""} ${input.tool.name}`);
  const nameHit = strongestHit(collectVerbHits(nameTokens));

  let classification: McpClassification = nameHit?.classification ?? "unknown";
  let baseScore = nameHit?.score ?? 45;

  const descriptionHit = classifyDescription(input.tool.description);

  if (
    descriptionHit &&
    (CLASSIFICATION_RANK[descriptionHit.classification] >
      CLASSIFICATION_RANK[classification] ||
      classification === "unknown")
  ) {
    classification = descriptionHit.classification;
    baseScore = Math.max(baseScore, descriptionHit.score);
  }

  // Layer 2+3: schema and arguments.
  const state = createState();

  if (containsProduction(`${input.tool.title ?? ""} ${input.tool.name}`)) {
    state.production = true;
    addFinding(state, "production-target", "tool name references production/live", 15);
  }

  analyzeSchema(input.tool.inputSchema, state);

  if (input.call?.arguments) {
    walkArguments(input.call.arguments, "arguments", state, 0);
  }

  // Layer 4: annotations (untrusted hints by default).
  const annotations = input.tool.annotations ?? {};
  let annotationScore = 0;

  if (annotations.idempotentHint === true) {
    annotationScore -= 5;
  }

  if (annotations.openWorldHint === true) {
    annotationScore += 10;
  }

  if (annotations.destructiveHint === true) {
    annotationScore += 20;
    if (CLASSIFICATION_RANK[classification] < CLASSIFICATION_RANK.mutating) {
      classification = "mutating";
      baseScore = Math.max(baseScore, 45);
    }
  }

  if (annotations.readOnlyHint === true) {
    const contradicted =
      classification === "destructive" ||
      classification === "mutating" ||
      state.destructiveArg ||
      state.exec;

    if (contradicted) {
      annotationScore += 15;
      addFinding(
        state,
        "annotation-conflict",
        "readOnlyHint contradicted by destructive evidence",
        15
      );
    } else if (policy.trustAnnotations) {
      return baseResult(
        "allow",
        "read",
        0,
        "READ_ONLY",
        state.findings,
        `${toolName} is marked read-only by the server and policy trusts annotations`
      );
    } else {
      annotationScore -= 10;
    }
  }

  const extras = state.findings.reduce((sum, finding) => sum + finding.score, 0);
  let score = baseScore + annotationScore + extras;
  let reason = "SENSITIVE_OPERATION";

  if (state.dryRun) {
    score -= 25;
    reason = "DRY_RUN";
  }

  const simpleChange =
    policy.allowSimpleUpdates !== false &&
    isSimpleChange(toolName, state, classification);

  if (simpleChange) {
    score -= 30;
    reason = "SIMPLE_UPDATE";
  }

  score = Math.min(100, Math.max(0, Math.round(score)));

  if (classification === "destructive") {
    reason = "DESTRUCTIVE_OPERATION";
  } else if (
    classification === "read" &&
    reason === "SENSITIVE_OPERATION" &&
    score < askThreshold
  ) {
    reason = "READ_ONLY";
  } else if (classification === "unknown" && reason === "SENSITIVE_OPERATION") {
    reason = "UNKNOWN_OPERATION";
  }

  const topLabels = state.findings
    .filter((finding) => finding.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((finding) => finding.label);

  const summaryParts = [`${toolName} (${classification})`];

  if (topLabels.length > 0) {
    summaryParts.push(topLabels.join("; "));
  } else if (nameHit) {
    summaryParts.push(`verb: ${nameHit.label}`);
  }

  if (state.dryRun) summaryParts.push("dry-run requested");
  if (simpleChange) summaryParts.push("narrow field update");
  if (state.truncated) summaryParts.push("arguments truncated at analysis limits");

  const decision =
    classification === "destructive" || score >= askThreshold ? "ask" : "allow";

  const resultReason =
    decision === "ask" ||
    reason === "SIMPLE_UPDATE" ||
    reason === "DRY_RUN" ||
    reason === "READ_ONLY"
      ? reason
      : "ALLOWED";

  return baseResult(
    decision,
    classification,
    score,
    resultReason,
    state.findings,
    summaryParts.join(": ")
  );
}
