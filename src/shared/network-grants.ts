export const DOMAIN_GRANT_CHANNEL = "auto-permission-system:domain-grant";

export interface DomainGrantBus {
	emit(channel: string, data: unknown): void;
	on(channel: string, handler: (data: unknown) => void): () => void;
}

export function emitDomainGrant(bus: DomainGrantBus, grantedHostname: string): void {
	bus.emit(DOMAIN_GRANT_CHANNEL, { host: grantedHostname });
}

export function onDomainGrant(
	bus: DomainGrantBus,
	handler: (grantedHostname: string) => void,
): () => void {
	return bus.on(DOMAIN_GRANT_CHANNEL, (data) => {
		const payload = data as { host?: unknown } | null | undefined;
		const hostname = payload?.host;

		if (typeof hostname === "string" && hostname.length > 0) {
			handler(hostname);
		}
	});
}
