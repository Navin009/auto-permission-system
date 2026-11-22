import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const AUDIT_LOG_FILENAME = "audit.log";
const AUDIT_LOG_MAXIMUM_BYTES = 5 * 1024 * 1024;
const AUDIT_LOG_FILE_MODE = 0o600;

export const AUDIT_PATH = `${getAgentDir()}/${AUDIT_LOG_FILENAME}`;

/** Keep the log bounded: the previous file is replaced, not appended to. */
function rotateAuditLog(): void {
	try {
		if (statSync(AUDIT_PATH).size < AUDIT_LOG_MAXIMUM_BYTES) return;
		renameSync(AUDIT_PATH, `${AUDIT_PATH}.1`);
	} catch {
		// no log yet, or it cannot be rotated: keep writing
	}
}

export function audit(auditPayload: Record<string, unknown>): void {
	try {
		mkdirSync(dirname(AUDIT_PATH), { recursive: true });
		rotateAuditLog();

		const entryWithTimestamp = {
			timestamp: new Date().toISOString(),
			...auditPayload,
		};

		appendFileSync(AUDIT_PATH, `${JSON.stringify(entryWithTimestamp)}\n`, { mode: AUDIT_LOG_FILE_MODE });
	} catch {
		// safe fallback
	}
}
