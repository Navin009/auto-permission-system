/**
 * Tunable limits and scoring weights for the file scanner. Tune these,
 * not the detection logic.
 */

/** Hard cap. A caller may lower this but can never raise it. */
export const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;

export const DEFAULT_ASK_THRESHOLD = 30;

/**
 * Files that are never text. They are allowed without reading, because
 * decoding them cannot yield meaningful secret evidence.
 */
export const IGNORED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".tiff",
  ".tif",
  ".avif",
  ".heic",
  ".heif",
  ".ico",
  ".svgz",
  ".pdf",
  ".zip",
  ".gz",
  ".tgz",
  ".bz2",
  ".xz",
  ".rar",
  ".7z",
  ".tar",
  ".mp3",
  ".wav",
  ".ogg",
  ".flac",
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".webm",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".so",
  ".dll",
  ".dylib",
  ".exe",
  ".bin",
  ".dat",
  ".o",
  ".a",
  ".class",
  ".jar",
  ".war",
  ".pyc",
  ".pyo",
  ".wasm",
  ".node",
  ".iso",
  ".img",
  ".dmg",
]);

/**
 * Base weight per content finding type. Tune these, not the detection
 * logic.
 */
export const BASE_SCORES: Record<string, number> = {
  PRIVATE_KEY: 100,
  JWT: 100,
  AWS_ACCESS_KEY: 90,
  KNOWN_TOKEN: 85,
  BEARER_TOKEN: 90,
  DATABASE_CREDENTIAL: 80,
  URL_CREDENTIAL: 75,
  SECRET_ASSIGNMENT: 35,
};

/** Extra weight when an assigned value looks strongly random. */
export const HIGH_ENTROPY_BONUS = 20;

/** Penalty applied to lower-confidence findings in test/fixture files. */
export const TEST_CONTEXT_PENALTY = 30;
