import type { RowGroupSummary, RowSummary, SubLineSummary } from "../core/tool-view/row-group.ts";
import { ExpansionLevel, nextExpansionLevel } from "../core/tool-view/expansion-level.ts";
import { rowLabelOf, RowKind } from "../core/tool-view/row-kind.ts";
import { programHint } from "../core/tool-view/target-summary.ts";
import { ToolStatus } from "../core/tool-view/status.ts";
import { thinkingState, thinkingEpoch } from "./thinking-clock.ts";
import { thoughtsVisibleInTranscript } from "./session.ts";

const TICK_INTERVAL_MILLISECONDS = 250;

export interface RowMember {
	toolCallId: string;
	target: string;
	status: ToolStatus;
	durationMilliseconds: number | undefined;
	startedAt: number;
	settledAt: number | undefined;
	invalidate: (() => void) | undefined;
	segmentIndex: number;
	subLines: readonly SubLineSummary[];
}

export interface RowGroup {
	kind: RowKind;
	members: RowMember[];
	ticker: ReturnType<typeof setInterval> | undefined;
	expansionLevel: ExpansionLevel;
	lastActivityAt: number;
	epochAtNewestMember: number;
}

export interface RowCallInput {
	toolCallId: string;
	kind: RowKind;
	target: string;
	invalidate: (() => void) | undefined;
	subLines?: readonly SubLineSummary[];
}

export interface RowSettleInput extends RowCallInput {
	status: ToolStatus;
	durationMilliseconds: number | undefined;
}

const openGroups = new Set<RowGroup>();
const groupsByCall = new Map<string, RowGroup>();
let currentGroup: RowGroup | undefined;
let invalidating = false;

export function joinRowGroup(input: RowCallInput): RowGroup {
	const group = groupForCall(input);
	const member = ensureMember(group, input);

	member.target = input.target;
	member.invalidate = input.invalidate;

	if (input.subLines) {
		member.subLines = input.subLines;
	}

	startGroupTicker(group);
	invalidateFrame(group, member);

	return group;
}

export function settleRowGroup(input: RowSettleInput): RowGroup {
	const group = groupForCall(input);
	const member = ensureMember(group, input);

	member.target = input.target;
	member.invalidate = input.invalidate;

	if (input.subLines) {
		member.subLines = input.subLines;
	}

	member.status = input.status;
	member.settledAt = member.settledAt ?? Date.now();

	if (input.durationMilliseconds !== undefined) {
		member.durationMilliseconds = input.durationMilliseconds;
		member.startedAt = member.settledAt - input.durationMilliseconds;
	}

	stopGroupTickerIfSettled(group);
	group.lastActivityAt = Math.max(group.lastActivityAt, member.settledAt);
	invalidateFrame(group, member);

	return group;
}

export function closeRowGroup(): void {
	const group = currentGroup;

	currentGroup = undefined;

	if (group) {
		foldGroup(group);
	}
}

export function rowGroupOfCall(toolCallId: string): RowGroup | undefined {
	return groupsByCall.get(toolCallId);
}

export function advanceGroupExpansion(group: RowGroup): void {
	group.expansionLevel = nextExpansionLevel(group.expansionLevel, hasGroupStep(group));

	for (const member of group.members) {
		safelyInvalidate(member);
	}
}

export function repaintCurrentRow(): void {
	const head = currentGroup ? frameMember(currentGroup) : undefined;

	if (head) {
		safelyInvalidate(head);
	}
}

export function repaintCurrentGroup(): void {
	if (!currentGroup) {
		return;
	}

	for (const member of currentGroup.members) {
		safelyInvalidate(member);
	}
}

export function resetRowGroups(): void {
	for (const group of openGroups) {
		stopGroupTicker(group);
	}

	openGroups.clear();
	groupsByCall.clear();
	currentGroup = undefined;
}

export function drawsFrame(group: RowGroup, toolCallId: string): boolean {
	return frameMember(group)?.toolCallId === toolCallId;
}

export function memberIndexOf(group: RowGroup, toolCallId: string): number | undefined {
	const index = group.members.findIndex((member) => member.toolCallId === toolCallId);

	return index === -1 ? undefined : index;
}

export function segmentOfCall(group: RowGroup, toolCallId: string): number | undefined {
	return group.members.find((member) => member.toolCallId === toolCallId)?.segmentIndex;
}

export function drawsSegment(group: RowGroup, toolCallId: string): boolean {
	const index = group.members.findIndex((member) => member.toolCallId === toolCallId);

	if (index < 0) {
		return false;
	}

	return index === 0 || group.members[index - 1].segmentIndex !== group.members[index].segmentIndex;
}

function nextSegmentIndex(group: RowGroup): number {
	const previous = group.members.at(-1);

	if (!previous || !thoughtsVisibleInTranscript()) {
		return 0;
	}

	return thinkingEpoch() > group.epochAtNewestMember
		? previous.segmentIndex + 1
		: previous.segmentIndex;
}

export function groupSummary(group: RowGroup, hint: string | undefined): RowGroupSummary {
	const first = frameMember(group);
	const thinking = group === currentGroup ? thinkingState() : undefined;
	const isLive =
		thinking !== undefined ||
		group.members.some((member) => member.status === ToolStatus.Running);
	const endMilliseconds = liveEndMilliseconds(group, isLive);
	const durationMilliseconds =
		first && endMilliseconds !== undefined ? Math.max(0, endMilliseconds - first.startedAt) : undefined;

	return {
		kind: group.kind,
		rows: group.members.map((member) => rowSummary(group.kind, member)),
		durationMilliseconds,
		folded: group !== currentGroup && group.expansionLevel === ExpansionLevel.Row,
		hint,
		thinking,
	};
}

function frameMember(group: RowGroup): RowMember | undefined {
	return group.members[0];
}

function hasGroupStep(group: RowGroup): boolean {
	return group !== currentGroup && rowLabelOf(group.kind).showsChildLines;
}

function liveEndMilliseconds(group: RowGroup, isLive: boolean): number | undefined {
	if (isLive) {
		group.lastActivityAt = Date.now();
	}

	return group.lastActivityAt;
}

function groupForCall(input: RowCallInput): RowGroup {
	const existingGroup = rowGroupOfCall(input.toolCallId);

	if (existingGroup) {
		return existingGroup;
	}

	if (currentGroup?.kind === input.kind) {
		return currentGroup;
	}

	return createGroup(input.kind);
}

function createGroup(kind: RowKind): RowGroup {
	const previousGroup = currentGroup;
	const group: RowGroup = {
		kind,
		members: [],
		ticker: undefined,
		expansionLevel: ExpansionLevel.Row,
		lastActivityAt: Date.now(),
		epochAtNewestMember: thinkingEpoch(),
	};

	openGroups.add(group);
	currentGroup = group;

	if (previousGroup) {
		foldGroup(previousGroup);
	}

	return group;
}

function foldGroup(group: RowGroup): void {
	group.expansionLevel = ExpansionLevel.Row;

	for (const member of group.members) {
		safelyInvalidate(member);
	}
}

function ensureMember(group: RowGroup, input: RowCallInput): RowMember {
	const existing = group.members.find((member) => member.toolCallId === input.toolCallId);

	if (existing) {
		return existing;
	}

	const member: RowMember = {
		toolCallId: input.toolCallId,
		target: input.target,
		status: ToolStatus.Running,
		durationMilliseconds: undefined,
		startedAt: Date.now(),
		settledAt: undefined,
		invalidate: input.invalidate,
		segmentIndex: nextSegmentIndex(group),
		subLines: input.subLines ?? [],
	};

	group.members.push(member);
	groupsByCall.set(member.toolCallId, group);
	group.epochAtNewestMember = thinkingEpoch();

	return member;
}

function rowSummary(kind: RowKind, member: RowMember): RowSummary {
	const runningDuration =
		member.status === ToolStatus.Running ? Date.now() - member.startedAt : undefined;

	return {
		target: member.target,
		hint: kind === RowKind.Shell ? programHint(member.target) : undefined,
		status: member.status,
		durationMilliseconds: member.durationMilliseconds ?? runningDuration,
		segmentIndex: member.segmentIndex,
		subLines: member.subLines.length > 0 ? member.subLines : undefined,
	};
}

function startGroupTicker(group: RowGroup): void {
	if (group.ticker) {
		return;
	}

	const ticker = setInterval(() => tickGroup(group), TICK_INTERVAL_MILLISECONDS);
	ticker.unref?.();

	group.ticker = ticker;
}

function stopGroupTickerIfSettled(group: RowGroup): void {
	if (group.members.some((member) => member.status === ToolStatus.Running)) {
		return;
	}

	stopGroupTicker(group);
}

function stopGroupTicker(group: RowGroup): void {
	if (group.ticker) {
		clearInterval(group.ticker);
	}

	group.ticker = undefined;
}

function tickGroup(group: RowGroup): void {
	const drawer = frameMember(group);

	if (drawer) {
		safelyInvalidate(drawer);
	}
}

function invalidateFrame(group: RowGroup, updated: RowMember): void {
	const drawer = frameMember(group);

	if (!drawer || drawer.toolCallId === updated.toolCallId) {
		return;
	}

	safelyInvalidate(drawer);
}

function safelyInvalidate(member: RowMember): void {
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
