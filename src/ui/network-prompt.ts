export const NETWORK_SESSION_LABEL = "Yes, all in group for this conversation";
export const NETWORK_REMEMBER_TITLE = "Always allow connecting \u2014 what, and where?";
export const NETWORK_ALLOWLIST_WHY = "this site isn't on your allowed list yet";
export const UNTRUSTED_PROJECT_NOTE = "this project isn't trusted — run /security trust to save rules here";

export function networkGroupRow(host: string, wildcard: string): string | null {
	if (wildcard === host.toLowerCase()) return null;

	const bare = wildcard.replace(/^\*\./, "");

	return `Group    ${wildcard}   (every ${bare} site)`;
}

export function networkPromptHeader(commandName: string, host: string): string {
	return `Let ${commandName} connect to ${host}?`;
}

export function networkPromptBody(options: { host: string; wildcard: string; command?: string; why: string }): string {
	const lines = [`Site     ${options.host}`];
	const group = networkGroupRow(options.host, options.wildcard);

	if (group) lines.push(group);
	if (options.command) lines.push(`Command  ${options.command}`);

	lines.push(`Why      ${options.why}`);

	return lines.join("\n");
}

export function networkRememberBody(options: {
	host: string;
	wildcard: string;
	commandName: string;
	untrusted: boolean;
}): string {
	const lines = [`Site     ${options.host}`];
	const group = networkGroupRow(options.host, options.wildcard);

	if (group) lines.push(group);

	lines.push(`Note     the rule works for any command, not just ${options.commandName}`);

	if (options.untrusted) lines.push(`Note     ${UNTRUSTED_PROJECT_NOTE}`);

	return lines.join("\n");
}
