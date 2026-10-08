/**
 * Layer 2 domain allow/deny matching for the URL tools.
 * Pure: no pi, no OS. Host/pattern primitives live in src/core (shared with
 * the Layer 1 network ask, ADR-023).
 */

import { domainMatches, hostnameOf } from "../core/policy/domains";
import type { Policy } from "./policy";

export { domainMatches, hostnameOf };

/** The hard-deny tier: a host on `deniedDomains` is never ask-able in either layer. */
export function deniedUrlReason(url: string, policy: Policy): string | null {
	const host = hostnameOf(url);
	if (!host) return null;
	if (policy.network.deniedDomains.some((p) => domainMatches(host, p))) return `denied domain: ${host}`;
	return null;
}

export function isAllowedUrl(url: string, policy: Policy): string | null {
	const host = hostnameOf(url);
	if (!host) return `not a valid URL: ${url}`;
	const denied = deniedUrlReason(url, policy);
	if (denied) return denied;
	if ((policy.overrides?.allowDomains ?? []).some((p) => domainMatches(host, p))) return null;
	if (policy.network.allowedDomains.length === 0) return null;
	if (policy.network.allowedDomains.some((p) => domainMatches(host, p))) return null;
	return `domain not in allowlist: ${host}`;
}
