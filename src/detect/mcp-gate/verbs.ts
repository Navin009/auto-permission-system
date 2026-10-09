/**
 * Verb vocabulary and classification.
 *
 * Tokenizes tool names/titles/descriptions and maps the strongest verb to
 * a classification. Past-tense/adjective usage ("deleted users") does not
 * make the operation destructive; only a head/imperative position does.
 */

import type { McpClassification } from "./types";

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
  verb("discover", "read", 0, "discover"),

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
  verb("cancel", "operational", 25, "cancel"),
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
  verb("run", "mutating", 30, "run"),
  verb("execute", "mutating", 30, "execute"),
  verb("evaluate", "mutating", 30, "evaluate"),
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

export const CLASSIFICATION_RANK: Record<McpClassification, number> = {
  read: 0,
  additive: 1,
  operational: 2,
  mutating: 3,
  destructive: 4,
  unknown: 5,
};

export function tokenize(value: string): string[] {
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

export interface VerbHit {
  classification: McpClassification;
  score: number;
  label: string;
  index: number;
  form: VerbForm;
}

export function collectVerbHits(tokens: string[]): VerbHit[] {
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

export function strongestHit(hits: VerbHit[]): VerbHit | null {
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

const NAME_HEAD_WINDOW = 3;

export function classifyName(tokens: string[]): VerbHit | null {
  const hits = collectVerbHits(tokens);
  const destructive = strongestHit(
    hits.filter((hit) => hit.classification === "destructive")
  );

  if (destructive) {
    return destructive;
  }

  return hits.find((hit) => hit.index <= NAME_HEAD_WINDOW) ?? null;
}

const NEGATED_READ_ONLY =
  /read[- ]?only|non[- ]?destructive|does\s*(?:not|n't)\s*(?:modify|delete|change|write)|no\s+side\s*effects|without\s+modifying|never\s+(?:deletes|modifies)/i;

export function stripServerPrefix(name: string): string {
  const match = /^mcp__(.+?)__(.+)$/.exec(name);
  return match ? match[2] : name;
}

const DESCRIPTION_HEAD_WINDOW = 5;

export function classifyDescription(
  description: string | undefined
): { classification: McpClassification; score: number } | null {
  if (!description || NEGATED_READ_ONLY.test(description)) {
    return null;
  }

  const hit = collectVerbHits(tokenize(description)).find(
    (candidate) => candidate.index <= DESCRIPTION_HEAD_WINDOW
  );

  if (!hit) {
    return null;
  }

  return {
    classification: hit.classification,
    score: Math.round(hit.score * 0.7),
  };
}
