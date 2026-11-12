import type { Component } from "@earendil-works/pi-tui";
import type { RowGroupSummary, RowSummary } from "../core/tool-view/row-group.ts";
import { ExpansionLevel, nextExpansionLevel } from "../core/tool-view/expansion-level.ts";
import { rowLabelOf, type RowKind } from "../core/tool-view/row-kind.ts";
import { ToolStatus } from "../core/tool-view/status.ts";
import {
	thinkingState,
	thoughtRevision,
} from "./thinking-clock.ts";
import { suppressNativeThoughtsAfter } from "./native-thinking.ts";

const TICK_INTERVAL_MILLISECONDS = 250;

export interface RowMember {
	toolCallId: string;
	target: string;
	status: ToolStatus;
	durationMilliseconds: number | undefined;
	startedAt: number;
	settledAt: number | undefined;
	invalidate: (() => void) | undefined;
	nativeThoughts: Component[];
}

export interface RowGroup {
	kind: RowKind;
	members: RowMember[];
	ticker: ReturnType<typeof setInterval> | undefined;
	expansionLevel: ExpansionLevel;
	lastActivityAt: number;
	thoughtRevisionAtNewestMember: number;
}

export interface RowCallInput {
	toolCallId: string;
	kind: RowKind;
	target: string;
	invalidate: (() => void) | undefined;
}

export interface RowSettleInput extends RowCallInput {
	status: ToolStatus;
	durationMilliseconds: number | undefined;
}

interface RowGroupPlacement {
	group: RowGroup;
	nativeThoughts: readonly Component[];
}

const openGroups = new Set<RowGroup>();
const groupsByCall = new Map<string, RowGroup>();
let currentGroup: RowGroup | undefined;
let invalidating = false;

export function joinRowGroup(input: RowCallInput): RowGroup {
	const { group, nativeThoughts } = groupForCall(input);
	const member = ensureMember(group, input, nativeThoughts);

	member.target = input.target;
	member.invalidate = input.invalidate;

	startGroupTicker(group);
	invalidateFrame(group, member);

	return group;
}

export function settleRowGroup(input: RowSettleInput): RowGroup {
	const { group, nativeThoughts } = groupForCall(input);
	const member = ensureMember(group, input, nativeThoughts);

	member.target = input.target;
	member.invalidate = input.invalidate;
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

export function nativeThoughtsForCall(group: RowGroup, toolCallId: string): readonly Component[] {
	return group.members.find((member) => member.toolCallId === toolCallId)?.nativeThoughts ?? [];
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
		rows: group.members.map(rowSummary),
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

function groupForCall(input: RowCallInput): RowGroupPlacement {
	const existingGroup = rowGroupOfCall(input.toolCallId);

	if (existingGroup) {
		return { group: existingGroup, nativeThoughts: [] };
	}

	if (currentGroup?.kind === input.kind) {
		const thoughtArrived = thoughtRevision() > currentGroup.thoughtRevisionAtNewestMember;

		if (!thoughtArrived || hasRunningMember(currentGroup)) {
			return { group: currentGroup, nativeThoughts: [] };
		}

		const nativeThoughts = suppressNativeThoughtsAfter(
			currentGroup.thoughtRevisionAtNewestMember,
			thoughtRevision(),
		);

		if (nativeThoughts) {
			return { group: currentGroup, nativeThoughts };
		}
	}

	return { group: createGroup(input.kind), nativeThoughts: [] };
}

function hasRunningMember(group: RowGroup): boolean {
	return group.members.some((member) => member.status === ToolStatus.Running);
}

function createGroup(kind: RowKind): RowGroup {
	const previousGroup = currentGroup;
	const group: RowGroup = {
		kind,
		members: [],
		ticker: undefined,
		expansionLevel: ExpansionLevel.Row,
		lastActivityAt: Date.now(),
		thoughtRevisionAtNewestMember: thoughtRevision(),
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

function ensureMember(
	group: RowGroup,
	input: RowCallInput,
	nativeThoughts: readonly Component[],
): RowMember {
	const existing = group.members.find((member) => member.toolCallId === input.toolCallId);

	if (existing) {
		return existing;
	}

	const previousMember = group.members.at(-1);

	if (previousMember) {
		previousMember.nativeThoughts.push(...nativeThoughts);
	}

	const member: RowMember = {
		toolCallId: input.toolCallId,
		target: input.target,
		status: ToolStatus.Running,
		durationMilliseconds: undefined,
		startedAt: Date.now(),
		settledAt: undefined,
		invalidate: input.invalidate,
		nativeThoughts: [],
	};

	group.members.push(member);
	groupsByCall.set(member.toolCallId, group);
	group.thoughtRevisionAtNewestMember = thoughtRevision();

	return member;
}

function rowSummary(member: RowMember): RowSummary {
	const runningDuration =
		member.status === ToolStatus.Running ? Date.now() - member.startedAt : undefined;

	return {
		target: member.target,
		status: member.status,
		durationMilliseconds: member.durationMilliseconds ?? runningDuration,
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
