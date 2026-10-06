/**
 * MCP tool-call permission gate.
 *
 * Purpose: given an MCP tool definition (name, title, description,
 * inputSchema, annotations) and optionally a concrete call (name,
 * arguments), decide whether the agent may run it:
 *
 *   "allow" -> execute directly
 *   "ask"   -> ask the user for confirmation first
 *
 * Pipeline:
 *
 *   Layer 0: user policy (allow/ask lists, annotation trust).
 *   Layer 1: tool identity (name/title + description) verb classification.
 *   Layer 2: inputSchema shape (force/recursive/command/dry-run keys).
 *   Layer 3: call arguments (recursive, depth/size bounded, decodes
 *            percent/base64 payloads once).
 *   Layer 4: annotations (treated as untrusted hints by default).
 *   Layer 5: scoring and decision, plus a human-readable summary.
 *
 * Design rule: unknown or ambiguous writes fail closed (ask). A tool
 * name that claims read-only is not trusted to lower risk unless the
 * policy explicitly opts in AND no destructive evidence exists.
 */

export type McpDecision = "allow" | "ask";

export type McpClassification =
  | "read"
  | "additive"
  | "operational"
  | "mutating"
  | "destructive"
  | "unknown";

export type McpSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface McpToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface JsonSchemaLike {
  type?: string;
  properties?: Record<string, JsonSchemaLike>;
  items?: JsonSchemaLike;
  enum?: unknown[];
  default?: unknown;
  [key: string]: unknown;
}

export interface McpToolDefinition {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: JsonSchemaLike;
  annotations?: McpToolAnnotations;
}

export interface McpToolCall {
  name?: string;
  arguments?: Record<string, unknown>;
}

export interface McpPolicy {
  /** Exact tool names always allowed. */
  allowTools?: string[];
  /** Exact tool names always asked. */
  askTools?: string[];
  /** Prefix matches against the tool name (case-insensitive). */
  allowPrefixes?: string[];
  /** Trust server-provided readOnlyHint enough to allow. */
  trustAnnotations?: boolean;
  /** Allow narrowly-scoped field updates without asking. Default true. */
  allowSimpleUpdates?: boolean;
  /** Score at (or above) which the gate asks. Default 30. */
  askThreshold?: number;
}

export interface McpGateInput {
  tool: McpToolDefinition;
  call?: McpToolCall;
  policy?: McpPolicy;
}

export interface McpFinding {
  type: string;
  label: string;
  severity: McpSeverity;
  score: number;
  path?: string;
}

export interface McpGateResult {
  decision: McpDecision;
  classification: McpClassification;
  riskScore: number;
  askThreshold: number;
  findings: McpFinding[];
  reason: string;
  /** One-line explanation suitable for a confirmation prompt. */
  summary: string;
}

export const MCP_DEFAULT_ASK_THRESHOLD = 30;
export const MCP_MAX_DEPTH = 8;
export const MCP_MAX_NODES = 2000;
const MAX_STRING_SCAN = 64 * 1024;

type VerbForm = "exact" | "third" | "gerund" | "past";

interface VerbEntry {
  verb: string;
  classification: McpClassification;
  score: number;
  label: string;
}

function verb(
  name: string,
  classification: McpClassification,
  score: number,
  label: string
): VerbEntry {
  return { verb: name, classification, score, label };
}

const VERB_ENTRIES: VerbEntry[] = [
  // Read
  verb("get", "read", 0, "get"),
  verb("list", "read", 0, "list"),
  verb("read", "read", 0, "read"),
  verb("search", "read", 0, "search"),
  verb("find", "read", 0, "find"),
  verb("lookup", "read", 0, "lookup"),
  verb("fetch", "read", 0, "fetch"),
  verb("describe", "read", 0, "describe"),
  verb("inspect", "read", 0, "inspect"),
  verb("show", "read", 0, "show"),
  verb("view", "read", 0, "view"),
  verb("count", "read", 0, "count"),
  verb("exists", "read", 0, "exists"),
  verb("stat", "read", 0, "stat"),
  verb("health", "read", 0, "health"),
  verb("ping", "read", 0, "ping"),
  verb("status", "read", 0, "status"),
  verb("diff", "read", 0, "diff"),
  verb("preview", "read", 0, "preview"),
  verb("validate", "read", 0, "validate"),
  verb("lint", "read", 0, "lint"),
  verb("plan", "read", 0, "plan"),

  // Additive
  verb("create", "additive", 30, "create"),
  verb("add", "additive", 30, "add"),
  verb("insert", "additive", 30, "insert"),
  verb("append", "additive", 30, "append"),
  verb("upload", "additive", 30, "upload"),
  verb("publish", "additive", 35, "publish"),
  verb("register", "additive", 30, "register"),
  verb("provision", "additive", 35, "provision"),
  verb("deploy", "additive", 40, "deploy"),
  verb("clone", "additive", 25, "clone"),
  verb("copy", "additive", 30, "copy"),
  verb("install", "additive", 35, "install"),
  verb("post", "additive", 30, "post"),
  verb("send", "additive", 30, "send"),
  verb("notify", "additive", 25, "notify"),
  verb("invite", "additive", 30, "invite"),
  verb("schedule", "additive", 25, "schedule"),
  verb("open", "additive", 20, "open"),

  // Operational (reversible service state)
  verb("enable", "operational", 25, "enable"),
  verb("disable", "operational", 25, "disable"),
  verb("start", "operational", 25, "start"),
  verb("stop", "operational", 30, "stop"),
  verb("restart", "operational", 30, "restart"),
  verb("pause", "operational", 25, "pause"),
  verb("resume", "operational", 20, "resume"),
  verb("suspend", "operational", 30, "suspend"),
  verb("mute", "operational", 20, "mute"),
  verb("unmute", "operational", 20, "unmute"),
  verb("activate", "operational", 25, "activate"),
  verb("deactivate", "operational", 30, "deactivate"),
  verb("scale", "operational", 30, "scale"),
  verb("drain", "operational", 35, "drain"),
  verb("cordon", "operational", 30, "cordon"),
  verb("uncordon", "operational", 25, "uncordon"),
  verb("renew", "operational", 25, "renew"),

  // Mutating
  verb("update", "mutating", 35, "update"),
  verb("edit", "mutating", 35, "edit"),
  verb("modify", "mutating", 35, "modify"),
  verb("set", "mutating", 35, "set"),
  verb("patch", "mutating", 35, "patch"),
  verb("change", "mutating", 35, "change"),
  verb("rename", "mutating", 35, "rename"),
  verb("move", "mutating", 40, "move"),
  verb("replace", "mutating", 40, "replace"),
  verb("write", "mutating", 40, "write"),
  verb("save", "mutating", 40, "save"),
  verb("upsert", "mutating", 40, "upsert"),
  verb("configure", "mutating", 35, "configure"),
  verb("assign", "mutating", 35, "assign"),
  verb("tag", "mutating", 30, "tag"),
  verb("label", "mutating", 30, "label"),
  verb("archive", "mutating", 35, "archive"),
  verb("restore", "mutating", 35, "restore"),
  verb("rollback", "mutating", 45, "rollback"),
  verb("revert", "mutating", 45, "revert"),
  verb("reset", "mutating", 45, "reset"),
  verb("rotate", "mutating", 40, "rotate"),
  verb("attach", "mutating", 30, "attach"),
  verb("detach", "mutating", 35, "detach"),
  verb("link", "mutating", 30, "link"),
  verb("sync", "mutating", 35, "sync"),
  verb("refresh", "mutating", 25, "refresh"),
  verb("merge", "mutating", 40, "merge"),
  verb("commit", "mutating", 35, "commit"),

  // Destructive
  verb("delete", "destructive", 80, "delete"),
  verb("remove", "destructive", 70, "remove"),
  verb("destroy", "destructive", 85, "destroy"),
  verb("drop", "destructive", 80, "drop"),
  verb("truncate", "destructive", 80, "truncate"),
  verb("purge", "destructive", 75, "purge"),
  verb("wipe", "destructive", 85, "wipe"),
  verb("erase", "destructive", 70, "erase"),
  verb("expunge", "destructive", 75, "expunge"),
  verb("shred", "destructive", 85, "shred"),
  verb("rm", "destructive", 75, "rm"),
  verb("rmdir", "destructive", 70, "rmdir"),
  verb("kill", "destructive", 70, "kill"),
  verb("terminate", "destructive", 75, "terminate"),
  verb("revoke", "destructive", 70, "revoke"),
  verb("uninstall", "destructive", 75, "uninstall"),
  verb("deregister", "destructive", 70, "deregister"),
  verb("deprovision", "destructive", 75, "deprovision"),
  verb("deallocate", "destructive", 70, "deallocate"),
  verb("flush", "destructive", 55, "flush"),
  verb("clear", "destructive", 50, "clear"),
  verb("empty", "destructive", 55, "empty"),
  verb("format", "destructive", 80, "format"),
  verb("overwrite", "destructive", 65, "overwrite"),
  verb("unlink", "destructive", 60, "unlink"),
];

const CLASSIFICATION_RANK: Record<McpClassification, number> = {
  read: 0,
  additive: 1,
  operational: 2,
  mutating: 3,
  destructive: 4,
  unknown: 5,
};

const FORCE_KEYS =
  /^(?:force|hard|recursive|recurse|cascade|purge|permanent|overwrite|skiptrash|no.?backup)$/;
const DRY_RUN_KEYS =
  /^(?:dry.?run|plan|simulate|validate|preview|check.?only)$/;
const BULK_KEYS =
  /^(?:all|everything|wildcard|bulk|batch|filter|filters|ids|names|paths|files|resources|targets|items|records|keys)$/;
const EXEC_KEYS =
  /^(?:command|cmd|script|shell|exec|execute|code|sql|statement|expression|eval)$/;
const CONTENT_KEYS =
  /^(?:content|body|data|file|filename|path|url|uri|endpoint|host|source|destination|folder|directory)$/;
const TARGET_KEYS =
  /^(?:id|key|name|identifier|resourceid|userid|accountid|projectid|tenantid|reposlug|slug)$/;
const METHOD_KEYS = /^(?:method|httpmethod|verb)$/;
const PROD_TOKENS = new Set(["prod", "production", "prd", "live"]);

function containsProduction(value: string): boolean {
  return tokenize(value).some((token) => PROD_TOKENS.has(token));
}

const NEGATED_READ_ONLY =
  /read[- ]?only|non[- ]?destructive|does\s*(?:not|n't)\s*(?:modify|delete|change|write)|no\s+side\s*effects|without\s+modifying|never\s+(?:deletes|modifies)/i;

const SQL_DESTRUCTIVE =
  /\b(?:drop\s+(?:table|database|schema|index|view)|truncate\s+table|truncate\s+\w+|delete\s+from|alter\s+table|alter\s+database|grant\s|revoke\s|create\s+or\s+replace)\b/i;
const SQL_UPDATE = /\bupdate\s+[\w."`[\]]+\s+set\b/i;
const SQL_SELECT = /^\s*(?:select|show|describe|explain|with)\b/i;
const SQL_WRITE =
  /^\s*(?:insert|update|delete|drop|truncate|alter|create|replace|grant|revoke|merge|call|exec)\b/i;

const SHELL_DESTRUCTIVE =
  /\brm\s+-(?:[a-z]*r[a-z]*f|[a-z]*f[a-z]*r)\b|\brm\s+-rf\b|\bdd\s+if=|\bmkfs(?:\.\w+)?\b|\bchmod\s+-R\b|\bchown\s+-R\b|\bgit\s+reset\s+--hard\b|\bgit\s+clean\s+-[a-z]*f|\bgit\s+push\b[^\n]*--force|\bkubectl\s+delete\b|\bterraform\s+destroy\b|\bdocker\s+(?:rm|rmi|volume\s+rm|system\s+prune)\b|\baws\s+\S+\s+(?:delete|terminate|deregister)\b|\bsystemctl\s+(?:stop|disable|mask)\b|\biptables\s+-F\b|\btruncate\s+-s\s+0\b/i;

const WILDCARD_VALUES = new Set([
  "*",
  "**",
  "all",
  "everything",
  "%",
  "-1",
  "0.0.0.0/0",
  "::/0",
  "/",
  "/*",
]);

function tokenize(value: string): string[] {
  return value
    .normalize("NFKC")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function verbForm(token: string, base: string): VerbForm | null {
  if (token === base) return "exact";
  if (token === `${base}s` || token === `${base}es`) return "third";
  if (base.endsWith("e") && token === `${base.slice(0, -1)}ing`) return "gerund";
  if (token === `${base}ing`) return "gerund";
  if (token === `${base}d` || token === `${base}ed`) return "past";
  return null;
}

interface VerbHit {
  classification: McpClassification;
  score: number;
  label: string;
  index: number;
  form: VerbForm;
}

function collectVerbHits(tokens: string[]): VerbHit[] {
  const hits: VerbHit[] = [];

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];

    for (const entry of VERB_ENTRIES) {
      const form = verbForm(token, entry.verb);

      if (!form) continue;

      // Past-tense/adjective usage ("deleted users") does not make the
      // operation destructive; only a head/imperative position does.
      if (form === "past" && index > 0) break;

      hits.push({
        classification: entry.classification,
        score: entry.score,
        label: entry.label,
        index,
        form,
      });
      break;
    }
  }

  return hits;
}

function strongestHit(hits: VerbHit[]): VerbHit | null {
  let best: VerbHit | null = null;

  for (const hit of hits) {
    if (
      !best ||
      hit.score > best.score ||
      (hit.score === best.score && hit.index < best.index)
    ) {
      best = hit;
    }
  }

  return best;
}

function classifyDescription(
  description: string | undefined
): { classification: McpClassification; score: number } | null {
  if (!description || NEGATED_READ_ONLY.test(description)) {
    return null;
  }

  const hit = strongestHit(collectVerbHits(tokenize(description)));

  if (!hit || hit.classification === "read") {
    return null;
  }

  return {
    classification: hit.classification,
    score: Math.round(hit.score * 0.7),
  };
}

interface SignalState {
  findings: McpFinding[];
  dryRun: boolean;
  force: boolean;
  bulk: boolean;
  production: boolean;
  exec: boolean;
  destructiveArg: boolean;
  contentTarget: boolean;
  targeted: boolean;
  truncated: boolean;
  nodes: number;
}

function createState(): SignalState {
  return {
    findings: [],
    dryRun: false,
    force: false,
    bulk: false,
    production: false,
    exec: false,
    destructiveArg: false,
    contentTarget: false,
    targeted: false,
    truncated: false,
    nodes: 0,
  };
}

function severityForScore(score: number): McpSeverity {
  if (score >= 60) return "CRITICAL";
  if (score >= 30) return "HIGH";
  if (score >= 15) return "MEDIUM";
  return "LOW";
}

function addFinding(
  state: SignalState,
  type: string,
  label: string,
  score: number,
  path?: string
): void {
  const key = `${type}:${path ?? ""}`;

  if (state.findings.some((finding) => `${finding.type}:${finding.path ?? ""}` === key)) {
    return;
  }

  state.findings.push({
    type,
    label,
    severity: severityForScore(score),
    score,
    path,
  });
}

function analyzeKey(
  rawKey: string,
  value: unknown,
  path: string,
  state: SignalState,
  fromSchema = false
): void {
  const key = rawKey.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");

  const truthy =
    value === true ||
    (typeof value === "number" && value !== 0) ||
    (typeof value === "string" && value.length > 0) ||
    (Array.isArray(value) && value.length > 0);

  // A schema property without a default still declares the capability.
  const capability = fromSchema && value === undefined;

  if (FORCE_KEYS.test(key) && (truthy || capability)) {
    state.force = true;
    addFinding(
      state,
      "force-argument",
      `${rawKey} enables force/recursive behavior`,
      capability ? 10 : 15,
      path
    );
  }

  if (DRY_RUN_KEYS.test(key) && truthy) {
    state.dryRun = true;
    addFinding(state, "dry-run", `${rawKey} requests a dry run`, 0, path);
  }

  if (BULK_KEYS.test(key) && (truthy || capability)) {
    const size = Array.isArray(value) ? value.length : null;

    if (capability || size === null || size > 1) {
      state.bulk = true;
      addFinding(
        state,
        "bulk-target",
        size === null ? `${rawKey} selects a bulk scope` : `${rawKey} selects ${size} targets`,
        capability ? 5 : 15,
        path
      );
    }
  }

  if (EXEC_KEYS.test(key) && (truthy || capability)) {
    state.exec = true;
    addFinding(
      state,
      "exec-argument",
      `${rawKey} can execute code/commands/SQL`,
      capability ? 12 : 20,
      path
    );
  }

  if (CONTENT_KEYS.test(key) && (truthy || capability)) {
    state.contentTarget = true;
  }

  if (TARGET_KEYS.test(key) && (typeof value === "string" || typeof value === "number")) {
    state.targeted = true;
  }

  if (METHOD_KEYS.test(key) && typeof value === "string") {
    const method = value.trim().toUpperCase();

    if (method === "DELETE") {
      state.destructiveArg = true;
      addFinding(state, "http-delete", `HTTP ${method} method`, 25, path);
    } else if (method === "PUT" || method === "PATCH") {
      addFinding(state, "http-write", `HTTP ${method} method`, 12, path);
    }
  }
}

function decodePossiblyEncoded(value: string): string | null {
  if (value.length < 24 || value.length > 8192) {
    return null;
  }

  if (/^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length % 4 === 0) {
    try {
      return Buffer.from(value, "base64").toString("utf8");
    } catch {
      return null;
    }
  }

  return null;
}

function analyzeString(value: string, path: string, state: SignalState): void {
  if (value.length > MAX_STRING_SCAN) {
    state.truncated = true;
    return;
  }

  let decoded: string | null = null;

  if (value.includes("%") && value.length < 4096) {
    try {
      decoded = decodeURIComponent(value);
    } catch {
      decoded = null;
    }
  }

  decoded ??= decodePossiblyEncoded(value);

  const candidates = decoded && decoded !== value ? [value, decoded] : [value];

  for (const candidate of candidates) {
    const normalized = candidate.normalize("NFKC");
    const lower = normalized.toLowerCase();

    if (WILDCARD_VALUES.has(lower.trim())) {
      state.bulk = true;
      state.destructiveArg = true;
      addFinding(state, "wildcard-target", `wildcard/bulk target "${normalized.trim()}"`, 25, path);
    }

    if (containsProduction(normalized)) {
      state.production = true;
      addFinding(state, "production-target", "target references production/live", 15, path);
    }

    if (SQL_DESTRUCTIVE.test(normalized)) {
      state.destructiveArg = true;
      addFinding(state, "sql-destructive", "SQL contains a destructive statement", 30, path);
    } else if (SQL_UPDATE.test(normalized) && !/\bwhere\b/i.test(normalized)) {
      state.destructiveArg = true;
      addFinding(state, "sql-update-without-where", "UPDATE without WHERE", 30, path);
    } else if (SQL_WRITE.test(normalized)) {
      addFinding(state, "sql-write", "SQL contains a write statement", 20, path);
    } else if (SQL_SELECT.test(normalized)) {
      addFinding(state, "sql-select", "SQL statement is read-only", 0, path);
    }

    if (SHELL_DESTRUCTIVE.test(normalized)) {
      state.destructiveArg = true;
      state.exec = true;
      addFinding(state, "shell-destructive", "destructive shell command", 30, path);
    }

    if (/&&|\|\||;|`|\$\(/.test(normalized) && state.exec) {
      state.destructiveArg = true;
      addFinding(state, "shell-chaining", "command chaining/expansion", 15, path);
    }
  }
}

function analyzeSchema(schema: JsonSchemaLike | undefined, state: SignalState): void {
  if (!schema || typeof schema !== "object") {
    return;
  }

  const properties = schema.properties;

  if (properties && typeof properties === "object") {
    for (const [key, sub] of Object.entries(properties)) {
      const path = `inputSchema.${key}`;
      analyzeKey(key, sub?.default, path, state, true);

      if (sub?.enum) {
        for (const member of sub.enum) {
          if (typeof member === "string") {
            analyzeString(member, `${path}.enum`, state);
          }
        }
      }
    }
  }

  if (schema.items?.properties) {
    for (const [key, sub] of Object.entries(schema.items.properties)) {
      analyzeKey(key, sub?.default, `inputSchema.items.${key}`, state, true);
    }
  }
}

function walkArguments(
  value: unknown,
  path: string,
  state: SignalState,
  depth: number
): void {
  state.nodes++;

  if (depth > MCP_MAX_DEPTH || state.nodes > MCP_MAX_NODES) {
    state.truncated = true;
    return;
  }

  if (typeof value === "string") {
    analyzeString(value, path, state);
    return;
  }

  if (Array.isArray(value)) {
    if (value.length > 10) {
      state.bulk = true;
      addFinding(state, "bulk-array", `array with ${value.length} items`, 15, path);
    }

    const limit = Math.min(value.length, 100);

    for (let i = 0; i < limit; i++) {
      walkArguments(value[i], `${path}[${i}]`, state, depth + 1);
    }

    return;
  }

  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      analyzeKey(key, child, childPath, state);
      walkArguments(child, childPath, state, depth + 1);
    }
  }
}

function isSimpleChange(
  toolName: string,
  state: SignalState,
  classification: McpClassification
): boolean {
  if (classification !== "mutating") return false;
  if (
    state.bulk ||
    state.force ||
    state.production ||
    state.exec ||
    state.destructiveArg ||
    state.contentTarget ||
    !state.targeted
  ) {
    return false;
  }

  const simpleVerbs = new Set(["update", "edit", "set", "patch", "configure", "tag", "label"]);

  return tokenize(toolName).some((token) => simpleVerbs.has(token));
}

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
    policy.allowPrefixes?.some((prefix) => lowered.startsWith(prefix.toLowerCase()))
  ) {
    return baseResult("allow", "unknown", 0, "POLICY_ALLOW", [], `${toolName} is explicitly allowed by policy`);
  }

  if (policy.askTools?.includes(toolName)) {
    return baseResult("ask", "unknown", 100, "POLICY_ASK", [], `${toolName} is explicitly ask-listed by policy`);
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
      addFinding(state, "annotation-conflict", "readOnlyHint contradicted by destructive evidence", 15);
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
    policy.allowSimpleUpdates !== false && isSimpleChange(toolName, state, classification);

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
    decision === "ask" || reason === "SIMPLE_UPDATE" || reason === "DRY_RUN" || reason === "READ_ONLY"
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
