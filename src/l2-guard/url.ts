/**
 * Layer 2 domain allow/deny matching for the URL tools.
 * Pure: no pi, no OS.
 */

import type { Policy } from "./policy";

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

export function isAllowedUrl(url: string, policy: Policy): string | null {
	const host = hostnameOf(url);
	if (!host) return `not a valid URL: ${url}`;
	if (policy.network.deniedDomains.some((p) => domainMatches(host, p)))
		return `denied domain: ${host}`;
	if ((policy.overrides?.allowDomains ?? []).some((p) => domainMatches(host, p))) return null;
	if (policy.network.allowedDomains.length === 0) return null;
	if (policy.network.allowedDomains.some((p) => domainMatches(host, p))) return null;
	return `domain not in allowlist: ${host}`;
}
