import path from "node:path";

/**
 * Layer 0: filename classifier for the read gate.
 *
 * Pure string work, no filesystem access. Decides whether a read
 * request is even a candidate for scanning, and how risky the name
 * itself is.
 *
 * Design rules:
 *   - The filename is a PRIOR, not the whole decision. `scanFile` now
 *     content-scans all regular text files, so a source file with a
 *     hardcoded credential is still detected even when this classifier
 *     says `candidate: false`.
 *   - Generic keywords match WHOLE TOKENS, not substrings:
 *     `tokenizer.json` -> no, `secrets.json` -> yes.
 *   - A filename can only raise risk, never lower it.
 */

export type NameRisk = "none" | "weak" | "config" | "generic" | "strong";

export interface NameVerdict {
  candidate: boolean;
  risk: NameRisk;
  score: number;
  reasons: string[];
}

/**
 * Source-code extensions. Any file with one of these is excluded from
 * generic keyword matching (and therefore from scanning unless an
 * exact strong name matches).
 */
export const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".java",
  ".kt",
  ".kts",
  ".scala",
  ".go",
  ".rs",
  ".py",
  ".rb",
  ".php",
  ".c",
  ".cc",
  ".cpp",
  ".cxx",
  ".h",
  ".hpp",
  ".cs",
  ".swift",
  ".m",
  ".mm",
  ".dart",
  ".lua",
  ".pl",
  ".r",
  ".jl",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
]);

/** Data/config formats where a sensitive keyword is meaningful. */
const CONFIG_EXTENSIONS = new Set([
  ".json",
  ".json5",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".properties",
  ".conf",
  ".cfg",
  ".config",
  ".xml",
  ".cnf",
  ".env",
  ".tfvars",
  ".tfstate",
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".jks",
  ".keystore",
  ".crt",
  ".cer",
  ".der",
  ".ppk",
]);

/**
 * Private key / keystore / certificate artifacts.
 *
 * These ALWAYS ask by name, even when content scanning is skipped or
 * finds nothing: an agent could otherwise read a DER/PKCS#12/keystore
 * blob and convert it into a usable secret.
 */
const KEY_EXTENSIONS = new Set([
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".jks",
  ".keystore",
  ".ppk",
  ".crt",
  ".cer",
  ".der",
]);

/**
 * Credential-sounding stems that are strong regardless of the suffix.
 * `credentials.zip` / `secret.png` must not slip through as a binary
 * skip; source extensions are intentionally excluded so `secret.ts`
 * stays a normal module name.
 */
const STRONG_STEMS = new Set(["credentials", "credential", "secrets", "secret"]);

/**
 * Score contributed purely by the filename. All tiers except `weak`
 * meet the default ask threshold (30), so the name alone can force
 * "ask" even when the content looks clean.
 */
export const RISK_SCORES: Record<Exclude<NameRisk, "none">, number> = {
  weak: 15,
  config: 30,
  generic: 35,
  strong: 45,
};

/** Exact, high-confidence filenames (tested against the lowercased basename). */
const STRONG_NAME_REGEXES: Array<[RegExp, string]> = [
  [/^\.env(\..+)?$/, "environment file"],
  [/^\.envrc$/, "direnv environment file"],
  [/^\.(npmrc|yarnrc|pgpass|netrc)(\.ya?ml)?$/, "credential dotfile"],
  [/^\.git-credentials$/, "Git credential store"],
  [/^\.htpasswd$/, "HTTP password file"],
  [/^(authorized_keys|known_hosts|kubeconfig)$/, "SSH/Kubernetes file"],
  [/^id_(rsa|dsa|ecdsa|ed25519)$/, "SSH private key"],
  [
    /^credentials(\.(json|ya?ml|txt|ini))?(\.(bak|backup|old|orig|save|swp|tmp))?$/,
    "credentials file",
  ],
  [
    /^secrets?\.(json|ya?ml)(\.(bak|backup|old|orig|save|swp|tmp))?$/,
    "secrets file",
  ],
];

/** Exact, high-confidence paths (tested against the normalized path). */
const STRONG_PATH_REGEXES: Array<[RegExp, string]> = [
  [/(^|\/)\.aws\/(credentials|config)$/, "AWS credentials"],
  [/(^|\/)\.kube\/config$/, "Kubernetes config"],
  [/(^|\/)\.docker\/config\.json$/, "Docker registry credentials"],
  [
    /(^|\/)gcloud\/(credentials|application_default_credentials\.json)/,
    "GCloud credentials",
  ],
];

/**
 * Application/config files. These names are only a WEAK prior: a clean
 * config.json or CI workflow must not ask on its own. Content decides.
 */
const CONFIG_NAME_REGEXES: Array<[RegExp, string]> = [
  [
    /^(config|application)\.(json|json5|ya?ml|properties|conf|ini|xml|toml)$/,
    "application config",
  ],
  [/^(database|db)\.(json|ya?ml)$/, "database config"],
  [/^(mysql|my)\.cnf$/, "MySQL config"],
  [/^(settings\.xml|gradle\.properties)$/, "build/package config"],
  [
    /^(jenkinsfile|bitbucket-pipelines\.ya?ml|\.gitlab-ci\.ya?ml)$/,
    "CI config",
  ],
  [/^appsettings(\.[^./]+)?\.json$/, ".NET app settings"],
  [/^service-account(\.[^./]+)?\.json$/, "GCP service account"],
  [/^sa-key(\.[^./]+)?\.json$/, "GCP service account key"],
  [/(^|\/)\.github\/workflows\/[^/]+$/, "CI workflow"],
  [/(^|\/)\.circleci\/config\.ya?ml$/, "CI config"],
];

/**
 * Weak candidates: the filename is a hint, but the content scan decides.
 * Score stays below the default threshold.
 */
const WEAK_NAME_REGEXES: Array<[RegExp, string]> = [
  [/^docker-compose(\..+)?\.ya?ml$/, "docker-compose (content decides)"],
];

/** Whole-token generic keywords. Never matched as substrings. */
const NAME_TOKENS = new Set([
  "secret",
  "secrets",
  "credential",
  "credentials",
  "password",
  "passwd",
  "token",
  "tokens",
  "private",
  "auth",
  "oauth",
]);

/** Phrase keywords that tokenization would split apart. */
const NAME_PHRASES = ["api_key", "api-key", "apikey"];

/**
 * Tokens sensitive enough to flag as an exact source basename, e.g.
 * `secret.ts` or `credentials.py`.
 *
 * Concept/module words (`auth`, `oauth`, `token`, `private`) are
 * deliberately excluded here because `auth.ts` / `token.ts` are
 * overwhelmingly ordinary modules, not secret files.
 */
const SOURCE_EXACT_TOKENS = new Set([
  "secret",
  "secrets",
  "credential",
  "credentials",
  "password",
  "passwd",
]);

function tokensOf(value: string): Set<string> {
  return new Set(
    value
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
  );
}

function isExactSourceKeyword(stem: string, tokens: Set<string>): boolean {
  const lower = stem.toLowerCase();

  if (NAME_PHRASES.includes(lower)) {
    return true;
  }

  if (tokens.size !== 1) {
    return false;
  }

  const [only] = tokens;
  return SOURCE_EXACT_TOKENS.has(only);
}

function verdictOf(risk: Exclude<NameRisk, "none">, reason: string): NameVerdict {
  return {
    candidate: true,
    risk,
    score: RISK_SCORES[risk],
    reasons: [reason],
  };
}

const NOT_A_CANDIDATE: NameVerdict = {
  candidate: false,
  risk: "none",
  score: 0,
  reasons: [],
};

export function isSourceExtension(ext: string): boolean {
  return SOURCE_EXTENSIONS.has(ext.toLowerCase());
}

export function classifyFilename(filePath: string): NameVerdict {
  const normalized = filePath.replaceAll("\\", "/");
  const base = normalized.slice(normalized.lastIndexOf("/") + 1) || normalized;
  const lower = base.toLowerCase();
  const ext = path.extname(lower);

  // 1. Exact strong basenames.
  for (const [pattern, reason] of STRONG_NAME_REGEXES) {
    if (pattern.test(lower)) {
      return verdictOf("strong", reason);
    }
  }

  // 2. Strong path patterns.
  for (const [pattern, reason] of STRONG_PATH_REGEXES) {
    if (pattern.test(normalized)) {
      return verdictOf("strong", reason);
    }
  }

  // 3. Key/certificate extensions and credential stems. These always ask.
  if (KEY_EXTENSIONS.has(ext)) {
    return verdictOf("strong", `key/certificate file (${ext})`);
  }

  const stem = path.basename(base, path.extname(base));

  if (STRONG_STEMS.has(stem) && !isSourceExtension(ext)) {
    return verdictOf("strong", "credential filename stem");
  }

  if (/\.(tfvars|tfstate)(\.backup)?$/.test(lower)) {
    return verdictOf("config", "terraform vars/state");
  }

  // 4. Application config names: weak prior, content decides.
  for (const [pattern, reason] of CONFIG_NAME_REGEXES) {
    if (pattern.test(lower) || pattern.test(normalized)) {
      return verdictOf("weak", reason);
    }
  }

  // 5. Weak candidates (content decides).
  for (const [pattern, reason] of WEAK_NAME_REGEXES) {
    if (pattern.test(lower)) {
      return verdictOf("weak", reason);
    }
  }

  // 6. Source files: only exact value-keyword basenames match. Compound
  //    module names such as TokenService.java or authentication.ts stay
  //    excluded, as do concept names such as auth.ts or token.go.
  const tokens = tokensOf(stem);

  if (isSourceExtension(ext)) {
    if (isExactSourceKeyword(stem, tokens)) {
      return verdictOf("generic", "exact sensitive filename keyword");
    }

    return NOT_A_CANDIDATE;
  }
  // 7. Generic keyword for config-like names.
  const configLike =
    CONFIG_EXTENSIONS.has(ext) || lower.startsWith(".") || ext === "";

  if (!configLike) {
    return NOT_A_CANDIDATE;
  }

  if (NAME_PHRASES.some((phrase) => lower.includes(phrase))) {
    return verdictOf("generic", "sensitive keyword in config-like filename");
  }

  for (const token of tokens) {
    if (NAME_TOKENS.has(token)) {
      return verdictOf("generic", `sensitive filename keyword: ${token}`);
    }
  }

  return NOT_A_CANDIDATE;
}
