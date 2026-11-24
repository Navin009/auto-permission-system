import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { createProjectTrust, trustStorePath } from "#core/index.ts";

export const TRUST_STORE = trustStorePath(getAgentDir());

const projectTrust = createProjectTrust(TRUST_STORE);

/** Set at session_start: the user declined pi's own project-trust prompt. */
export function setPiDeclinedTrust(declined: boolean): void {
	projectTrust.setDeclined(declined);
}

/** A project sandbox.json applies in full only when its content was trusted (ADR-013). */
export function projectTrusted(cwd: string): boolean {
	return projectTrust.isTrusted(cwd);
}
