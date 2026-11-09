import { isAbsolute, resolve } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	canonicalize,
	expandHome,
	isAbsoluteDeny,
	isAskRead,
	isDeniedRead,
	isDeniedWrite,
	outsideProjectReason,
} from "./matching.ts";
import { deniedUrlReason, hostnameOf, isAllowedUrl } from "./url.ts";
import { audit } from "../shared/audit.ts";
import { askOrBlock, type UICtx } from "./prompts.ts";
import { denyMessage } from "../ui/ask.ts";
import type { Policy } from "./policy.ts";

export async function checkReadAccess(
	rawPath: string,
	toolName: string,
	context: ExtensionContext,
	policy: Policy,
): Promise<{ block: true; reason: string } | undefined> {
	const canonicalPath = canonicalize(rawPath, context.cwd);

	let denialReason = isDeniedRead(rawPath, context.cwd, policy);
	let isAskReadHit = false;

	if (!denialReason) {
		denialReason = isAskRead(rawPath, context.cwd, policy);
		isAskReadHit = denialReason !== null;
	}

	let isOutsideProject = false;

	if (!denialReason) {
		denialReason = outsideProjectReason(canonicalPath, context.cwd, policy);
		isOutsideProject = denialReason !== null;
	}

	if (!denialReason) {
		return undefined;
	}

	if (isOutsideProject && policy.filesystem.outsideProject?.read === "deny") {
		audit({
			layer: 2,
			tool: toolName,
			subject: canonicalPath,
			reason: denialReason,
			decision: "no",
			note: "outside-project-deny",
			cwd: context.cwd,
		});

		return { block: true as const, reason: denyMessage("allowRead", denialReason) };
	}

	const expandedPath = expandHome(rawPath);
	const spelledPath = isAbsolute(expandedPath) ? expandedPath : resolve(context.cwd, expandedPath);

	const result = await askOrBlock(
		/* SAFETY: pi's ctx carries cwd/UI at runtime; local UICtx names the members used. */
		context as unknown as UICtx,
		{
			layer: 2,
			tool: toolName,
			subject: canonicalPath,
			reason: denialReason,
			overrideKind: "allowRead",
			overrideValue: canonicalPath,
			outside: isOutsideProject,
			spelled: spelledPath,
			credentialOnly: isAskReadHit,
		},
		isAbsoluteDeny(canonicalPath, context.cwd),
	);

	return result ?? undefined;
}

export async function checkWriteAccess(
	rawPath: string,
	toolName: string,
	context: ExtensionContext,
	policy: Policy,
): Promise<{ block: true; reason: string } | undefined> {
	const denialReason = isDeniedWrite(rawPath, context.cwd, policy);

	if (!denialReason) {
		return undefined;
	}

	const canonicalPath = canonicalize(rawPath, context.cwd);

	const result = await askOrBlock(
		/* SAFETY: pi's ctx carries cwd/UI at runtime. */
		context as unknown as UICtx,
		{
			layer: 2,
			tool: toolName,
			subject: canonicalPath,
			reason: denialReason,
			overrideKind: "allowWrite",
			overrideValue: canonicalPath,
		},
		isAbsoluteDeny(canonicalPath, context.cwd),
	);

	return result ?? undefined;
}

export function extractUrlsFromInput(input: Record<string, unknown> | undefined): string[] {
	if (!input) {
		return [];
	}

	const collectedUrls: string[] = [];

	if (typeof input.url === "string") {
		collectedUrls.push(input.url);
	}

	if (Array.isArray(input.urls)) {
		for (const candidateUrl of input.urls) {
			if (typeof candidateUrl === "string") {
				collectedUrls.push(candidateUrl);
			}
		}
	}

	return collectedUrls;
}

export async function checkNetworkAccess(
	urls: string[],
	toolName: string,
	context: ExtensionContext,
	policy: Policy,
	onDomainGrant: (domain: string) => void,
): Promise<{ block: true; reason: string } | undefined> {
	for (const targetUrl of urls) {
		const deniedReason = deniedUrlReason(targetUrl, policy);

		if (deniedReason) {
			audit({
				layer: 2,
				tool: toolName,
				subject: targetUrl,
				reason: deniedReason,
				decision: "no",
				note: "denied-domain",
				cwd: context.cwd,
			});

			return { block: true, reason: denyMessage("allowDomains", deniedReason) };
		}

		const allowedReason = isAllowedUrl(targetUrl, policy);

		if (!allowedReason) {
			continue;
		}

		const targetHostname = hostnameOf(targetUrl) ?? targetUrl;

		const result = await askOrBlock(
			/* SAFETY: pi's ctx carries cwd/UI at runtime. */
			context as unknown as UICtx,
			{
				layer: 2,
				tool: toolName,
				subject: targetUrl,
				reason: allowedReason,
				overrideKind: "allowDomains",
				overrideValue: targetHostname,
			},
			null,
			(kind, value) => {
				if (kind === "allowDomains") {
					onDomainGrant(value);
				}
			},
		);

		if (result) {
			return result;
		}
	}

	return undefined;
}
