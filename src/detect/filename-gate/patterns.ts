/**
 * Filename tables: extension sets, name/path regexes and keyword tokens.
 * Pure data, no filesystem access.
 */

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
export const CONFIG_EXTENSIONS = new Set([
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
export const KEY_EXTENSIONS = new Set([
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
export const STRONG_STEMS = new Set([
  "credentials",
  "credential",
  "secrets",
  "secret",
]);

/** Exact, high-confidence filenames (tested against the lowercased basename). */
export const STRONG_NAME_REGEXES: Array<[RegExp, string]> = [
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
export const STRONG_PATH_REGEXES: Array<[RegExp, string]> = [
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
export const CONFIG_NAME_REGEXES: Array<[RegExp, string]> = [
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
export const WEAK_NAME_REGEXES: Array<[RegExp, string]> = [
  [/^docker-compose(\..+)?\.ya?ml$/, "docker-compose (content decides)"],
];

/** Whole-token generic keywords. Never matched as substrings. */
export const NAME_TOKENS = new Set([
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
export const NAME_PHRASES = ["api_key", "api-key", "apikey"];

/**
 * Tokens sensitive enough to flag as an exact source basename, e.g.
 * `secret.ts` or `credentials.py`.
 *
 * Concept/module words (`auth`, `oauth`, `token`, `private`) are
 * deliberately excluded here because `auth.ts` / `token.ts` are
 * overwhelmingly ordinary modules, not secret files.
 */
export const SOURCE_EXACT_TOKENS = new Set([
  "secret",
  "secrets",
  "credential",
  "credentials",
  "password",
  "passwd",
]);
