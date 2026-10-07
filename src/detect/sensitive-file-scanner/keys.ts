/**
 * Sensitive key vocabulary.
 *
 * Keys are normalized by lowercasing and stripping [-_. ] so camelCase,
 * snake_case and kebab-case all match.
 */

/** Normalized key names that are sensitive on their own. */
export const SENSITIVE_KEYS = new Set([
  "password",
  "passwd",
  "passphrase",
  "secret",
  "secretkey",
  "clientsecret",
  "jwtsecret",
  "webhooksecret",
  "secretaccesskey",
  "apikey",
  "accesskey",
  "accesskeyid",
  "privatekey",
  "signingkey",
  "encryptionkey",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "authtoken",
  "bearertoken",
  "credential",
  "credentials",
  "authorization",
  "auth",
  "serviceaccount",
  "connectionstring",
  "databaseurl",
  "accountkey",
  "smtppassword",
  "dbpassword",
  "key",
]);

/**
 * Suffixes that make a compound key sensitive (GITHUB_TOKEN,
 * AWS_SECRET_ACCESS_KEY, ...).
 */
const SENSITIVE_KEY_SUFFIXES = [
  "password",
  "passwd",
  "passphrase",
  "secret",
  "secretkey",
  "clientsecret",
  "jwtsecret",
  "webhooksecret",
  "secretaccesskey",
  "apikey",
  "accesskey",
  "accesskeyid",
  "privatekey",
  "signingkey",
  "encryptionkey",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "authtoken",
  "bearertoken",
  "credential",
  "credentials",
  "authorization",
  "auth",
  "accountkey",
  "smtppassword",
  "dbpassword",
];

/** Keys whose value is a password: weaker entropy/length rules apply. */
export const PASSWORD_KEY_REGEX = /(?:password|passwd|passphrase)$/;

export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_.\s]/g, "");
}

export function isSensitiveKey(normalized: string): boolean {
  if (SENSITIVE_KEYS.has(normalized)) {
    return true;
  }

  for (const suffix of SENSITIVE_KEY_SUFFIXES) {
    if (normalized.length > suffix.length && normalized.endsWith(suffix)) {
      return true;
    }
  }

  return false;
}
