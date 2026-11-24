const ADVANCED_SECURE_MODE = "advanced-secure";
const SECURE_ICON = "🧠";
const DEFAULT_ICON = "🔒";
const CHIP_PREFIX = "Sandbox:";
const ALL_DOMAINS_LABEL = "all domains";
const STRICT_EMPTY_DOMAINS_LABEL = "0 domains (strict)";
const DOMAIN_SINGULAR = "domain";
const DOMAIN_PLURAL = "domains";
const PATH_SINGULAR = "path";
const PATH_PLURAL = "paths";
const SESSION_SINGULAR = "session grant";
const SESSION_PLURAL = "session grants";

export interface SandboxChipConfig {
	mode?: unknown;
	network?: {
		allowedDomains?: readonly unknown[];
		strictAllowlist?: boolean;
	};
	filesystem?: {
		allowWrite?: readonly unknown[];
	};
	sessionGrantCount?: number;
}

export interface SandboxChip {
	color: "success" | "accent";
	text: string;
}

export function sandboxStatusChip(config: SandboxChipConfig): SandboxChip {
	const isSecureMode = config.mode === ADVANCED_SECURE_MODE;
	const modeIcon = isSecureMode ? SECURE_ICON : DEFAULT_ICON;
	const color = isSecureMode ? "success" : "accent";
	const domains = formatDomainCount(
		config.network?.allowedDomains?.length ?? 0,
		config.network?.strictAllowlist === true,
	);
	const paths = formatPathCount(config.filesystem?.allowWrite?.length ?? 0);
	const grants = formatSessionGrants(config.sessionGrantCount ?? 0);

	return {
		color,
		text: `${CHIP_PREFIX} ${modeIcon}  ${domains}, ${paths}${grants}`,
	};
}

function formatDomainCount(count: number, strictAllowlist: boolean): string {
	if (count === 0) {
		return strictAllowlist ? STRICT_EMPTY_DOMAINS_LABEL : ALL_DOMAINS_LABEL;
	}

	return `${count} ${count === 1 ? DOMAIN_SINGULAR : DOMAIN_PLURAL}`;
}

function formatPathCount(count: number): string {
	return `${count} ${count === 1 ? PATH_SINGULAR : PATH_PLURAL}`;
}

function formatSessionGrants(count: number): string {
	if (count <= 0) {
		return "";
	}

	return ` · ${count} ${count === 1 ? SESSION_SINGULAR : SESSION_PLURAL}`;
}
