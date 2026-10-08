/**
 * Domain pattern matching shared by both layers. Pure: no pi, no OS.
 *
 * `hostnameOf` parses a URL to its lowercase host; `domainMatches` implements
 * the allow-list syntax used by `allowedDomains` / `deniedDomains` / grants:
 * an exact host, or `*.domain` which also matches the apex. Port suffixes
 * (`host:443`) are a sandbox-runtime config feature only; this matcher is
 * hostname-only, which is what both layers store in policy.
 */

export function hostnameOf(url: string): string | null {
	try {
		return new URL(url).hostname.toLowerCase();
	} catch {
		return null;
	}
}

export function domainMatches(host: string, pattern: string): boolean {
	const p = pattern.toLowerCase();
	if (p.startsWith("*.")) {
		const suffix = p.slice(1); // ".npmjs.org"
		return host === p.slice(2) || host.endsWith(suffix);
	}
	return host === p;
}
