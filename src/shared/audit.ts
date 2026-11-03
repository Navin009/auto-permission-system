import { appendFileSync } from "node:fs";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const AUDIT_LOG_FILENAME = "audit.log";

export const AUDIT_PATH = `${getAgentDir()}/${AUDIT_LOG_FILENAME}`;

export function audit(
	auditPayload: Record<string, unknown>,
): void {
	try {
		const entryWithTimestamp = {
			timestamp: new Date().toISOString(),
			...auditPayload,
		};

		appendFileSync(AUDIT_PATH, `${JSON.stringify(entryWithTimestamp)}\n`);
	} catch {
		// safe fallback
	}
}
