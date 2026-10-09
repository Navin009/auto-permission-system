/**
 * Schema and argument signal analysis.
 *
 * Walks a tool's inputSchema and a concrete call's arguments (recursive,
 * depth/size bounded), decoding percent/base64 payloads once, and records
 * every signal that raises or lowers risk.
 */

import { MAX_STRING_SCAN, MCP_MAX_DEPTH, MCP_MAX_NODES } from "./constants";
import type {
  JsonSchemaLike,
  McpClassification,
  McpFinding,
  McpSeverity,
} from "./types";
import { tokenize } from "./verbs";

const FORCE_KEYS =
  /^(?:force|hard|recursive|recurse|cascade|purge|permanent|overwrite|skiptrash|no.?backup)$/;
const DRY_RUN_KEYS =
  /^(?:dry.?run|plan|simulate|validate|preview|check.?only)$/;
const BULK_KEYS =
  /^(?:all|everything|wildcard|bulk|batch|ids|names|paths|files|resources|targets|items|records|keys)$/;
const EXEC_KEYS =
  /^(?:command|cmd|script|shell|exec|execute|code|sql|statement|expression|eval)$/;
const CONTENT_KEYS =
  /^(?:content|body|data|file|filename|path|url|uri|endpoint|host|source|destination|folder|directory)$/;
const TARGET_KEYS =
  /^(?:id|key|name|identifier|resourceid|userid|accountid|projectid|tenantid|reposlug|slug)$/;
const METHOD_KEYS = /^(?:method|httpmethod|verb)$/;
const PROD_TOKENS = new Set(["prod", "production", "prd"]);

export function containsProduction(value: string): boolean {
  return tokenize(value).some((token) => PROD_TOKENS.has(token));
}

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
  "everything",
  "%",
  "0.0.0.0/0",
  "::/0",
  "/",
  "/*",
]);

export interface SignalState {
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

export function createState(): SignalState {
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

export function addFinding(
  state: SignalState,
  type: string,
  label: string,
  score: number,
  path?: string
): void {
  const key = `${type}:${path ?? ""}`;

  if (
    state.findings.some(
      (finding) => `${finding.type}:${finding.path ?? ""}` === key
    )
  ) {
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
        size === null
          ? `${rawKey} selects a bulk scope`
          : `${rawKey} selects ${size} targets`,
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

  if (
    TARGET_KEYS.test(key) &&
    (typeof value === "string" || typeof value === "number")
  ) {
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
      addFinding(
        state,
        "wildcard-target",
        `wildcard/bulk target "${normalized.trim()}"`,
        25,
        path
      );
    }

    if (containsProduction(normalized)) {
      state.production = true;
      addFinding(
        state,
        "production-target",
        "target references production/live",
        15,
        path
      );
    }

    if (SQL_DESTRUCTIVE.test(normalized)) {
      state.destructiveArg = true;
      addFinding(
        state,
        "sql-destructive",
        "SQL contains a destructive statement",
        30,
        path
      );
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

function analyzeSchema(
  schema: JsonSchemaLike | undefined,
  state: SignalState
): void {
  if (!schema || typeof schema !== "object") {
    return;
  }

  const properties = schema.properties;

  if (properties && typeof properties === "object") {
    for (const [key, sub] of Object.entries(properties)) {
      const path = `inputSchema.${key}`;
      analyzeKey(key, sub?.default, path, state, true);
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

export { analyzeSchema, walkArguments };

export function isSimpleChange(
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

  const simpleVerbs = new Set([
    "update",
    "edit",
    "set",
    "patch",
    "configure",
    "tag",
    "label",
  ]);

  return tokenize(toolName).some((token) => simpleVerbs.has(token));
}
