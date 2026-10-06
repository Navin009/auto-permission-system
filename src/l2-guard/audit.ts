/**
 * Layer 2 audit log. Best-effort: a write failure never blocks a decision.
 */

import { appendFileSync } from "node:fs";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const AUDIT_PATH = `${getAgentDir()}/audit.log`;

export function audit(entry: Record<string, unknown>): void {
	try {
		appendFileSync(AUDIT_PATH, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`);
	} catch {
		/* best-effort */
	}
}
