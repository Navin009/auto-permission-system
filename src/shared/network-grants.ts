/**
 * Cross-layer network grant notification (ADR-023), shared by every layer
 * entrypoint.
 *
 * Layer 2's "Allow and remember" writes `overrides.allowDomains`; Layer 1's
 * running proxy only learns about it on reload. The entrypoints share no
 * memory (ADR-018/020), so the grant travels over pi's process-wide event bus:
 * guard.ts emits, sandbox.ts applies it live with SandboxManager.updateConfig.
 */

/** pi's shared event bus channel for persisted domain grants. */
export const DOMAIN_GRANT_CHANNEL = "auto-permission-system:domain-grant";

/** The pi bus APIs this module needs; kept structural so tests can fake them. */
export interface DomainGrantBus {
	emit(channel: string, data: unknown): void;
	on(channel: string, handler: (data: unknown) => void): () => void;
}

/** Announce that `host` was persisted into overrides.allowDomains. */
export function emitDomainGrant(bus: DomainGrantBus, host: string): void {
	bus.emit(DOMAIN_GRANT_CHANNEL, { host });
}

/** Subscribe to persisted domain grants; ignores malformed payloads. Returns an unsubscribe. */
export function onDomainGrant(bus: DomainGrantBus, handler: (host: string) => void): () => void {
	return bus.on(DOMAIN_GRANT_CHANNEL, (data) => {
		const host = (data as { host?: unknown } | null | undefined)?.host;
		if (typeof host === "string" && host) handler(host);
	});
}
