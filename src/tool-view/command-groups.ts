import type { CommandGroupSummary, CommandSummary } from "../core/tool-view/command-group.ts";
import { ExpansionLevel, nextExpansionLevel } from "../core/tool-view/expansion-level.ts";
import { StatusMark } from "../core/tool-view/status.ts";

const TICK_INTERVAL_MILLISECONDS = 250;

export interface CommandMember {
	toolCallId: string;
	command: string;
	status: StatusMark;
	durationMilliseconds: number | undefined;
	startedAt: number;
	settledAt: number | undefined;
	invalidate: (() => void) | undefined;
}

export interface CommandGroup {
	members: CommandMember[];
	ticker: ReturnType<typeof setInterval> | undefined;
	expansionLevel: ExpansionLevel;
}

export interface GroupCallInput {
	toolCallId: string;
	command: string;
	invalidate: (() => void) | undefined;
}

export interface GroupSettleInput extends GroupCallInput {
	status: StatusMark;
	durationMilliseconds: number | undefined;
}

const openGroups = new Set<CommandGroup>();
const groupsByCall = new Map<string, CommandGroup>();
let currentGroup: CommandGroup | undefined;
let invalidating = false;

export function joinCommandGroup(input: GroupCallInput): CommandGroup {
	const group = currentGroup ?? createGroup();
	const member = ensureMember(group, input);

	member.command = input.command;
	member.invalidate = input.invalidate;

	startGroupTicker(group);
	invalidateDrawingMember(group, member);

	return group;
}

export function settleCommandGroup(input: GroupSettleInput): CommandGroup {
	const group = currentGroup ?? createGroup();
	const member = ensureMember(group, input);

	member.command = input.command;
	member.invalidate = input.invalidate;
	member.status = input.status;
	member.settledAt = member.settledAt ?? Date.now();

	if (input.durationMilliseconds !== undefined) {
		member.durationMilliseconds = input.durationMilliseconds;
		member.startedAt = member.settledAt - input.durationMilliseconds;
	}

	stopGroupTickerIfSettled(group);
	invalidateDrawingMember(group, member);

	return group;
}

export function closeCommandGroup(): void {
	currentGroup = undefined;
}

export function groupOfCall(toolCallId: string): CommandGroup | undefined {
	return groupsByCall.get(toolCallId);
}

export function advanceGroupExpansion(group: CommandGroup): void {
	group.expansionLevel = nextExpansionLevel(group.expansionLevel);

	for (const member of group.members) {
		safelyInvalidate(member);
	}
}

export function resetCommandGroups(): void {
	for (const group of openGroups) {
		stopGroupTicker(group);
	}

	openGroups.clear();
	groupsByCall.clear();
	currentGroup = undefined;
}

export function isGroupHead(group: CommandGroup, toolCallId: string): boolean {
	return group.members[0]?.toolCallId === toolCallId;
}

export function groupSummary(group: CommandGroup, hint: string | undefined): CommandGroupSummary {
	const head = group.members[0];
	const running = group.members.some((member) => member.status === StatusMark.Running);
	const endMilliseconds = running ? Date.now() : lastSettleMilliseconds(group);
	const totalDurationMilliseconds =
		head && endMilliseconds !== undefined ? Math.max(0, endMilliseconds - head.startedAt) : undefined;

	return {
		commands: group.members.map(commandSummary),
		totalDurationMilliseconds,
		hint,
	};
}

function createGroup(): CommandGroup {
	const group: CommandGroup = { members: [], ticker: undefined, expansionLevel: ExpansionLevel.Row };

	openGroups.add(group);
	currentGroup = group;

	return group;
}

function ensureMember(group: CommandGroup, input: GroupCallInput): CommandMember {
	const existing = group.members.find((member) => member.toolCallId === input.toolCallId);

	if (existing) {
		return existing;
	}

	const member: CommandMember = {
		toolCallId: input.toolCallId,
		command: input.command,
		status: StatusMark.Running,
		durationMilliseconds: undefined,
		startedAt: Date.now(),
		settledAt: undefined,
		invalidate: input.invalidate,
	};

	group.members.push(member);
	groupsByCall.set(member.toolCallId, group);

	return member;
}

function commandSummary(member: CommandMember): CommandSummary {
	const runningDuration =
		member.status === StatusMark.Running ? Date.now() - member.startedAt : undefined;

	return {
		command: member.command,
		status: member.status,
		durationMilliseconds: member.durationMilliseconds ?? runningDuration,
	};
}

function lastSettleMilliseconds(group: CommandGroup): number | undefined {
	return group.members.at(-1)?.settledAt;
}

function startGroupTicker(group: CommandGroup): void {
	if (group.ticker) {
		return;
	}

	const ticker = setInterval(() => tickGroup(group), TICK_INTERVAL_MILLISECONDS);
	ticker.unref?.();

	group.ticker = ticker;
}

function stopGroupTickerIfSettled(group: CommandGroup): void {
	if (group.members.some((member) => member.status === StatusMark.Running)) {
		return;
	}

	stopGroupTicker(group);
}

function stopGroupTicker(group: CommandGroup): void {
	if (group.ticker) {
		clearInterval(group.ticker);
	}

	group.ticker = undefined;
}

function tickGroup(group: CommandGroup): void {
	const head = group.members[0];

	if (head) {
		safelyInvalidate(head);
	}
}

function invalidateDrawingMember(group: CommandGroup, joining: CommandMember): void {
	const head = group.members[0];

	if (!head || head.toolCallId === joining.toolCallId) {
		return;
	}

	safelyInvalidate(head);
}

function safelyInvalidate(member: CommandMember): void {
	if (invalidating) {
		return;
	}

	invalidating = true;

	try {
		member.invalidate?.();
	} catch {
		return;
	} finally {
		invalidating = false;
	}
}
