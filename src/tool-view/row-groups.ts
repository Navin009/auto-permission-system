import type { RowChild, RowGroupSummary, RowSummary, ThoughtSummary } from "../core/tool-view/row-group.ts";
import { ExpansionLevel, nextExpansionLevel } from "../core/tool-view/expansion-level.ts";
import { rowLabelOf, type RowKind } from "../core/tool-view/row-kind.ts";
import { ToolStatus } from "../core/tool-view/status.ts";
import { thinkingState } from "./thinking-clock.ts";

const TICK_INTERVAL_MILLISECONDS = 250;

export interface RowMember {
	toolCallId: string;
	target: string;
	status: ToolStatus;
	durationMilliseconds: number | undefined;
	startedAt: number;
	settledAt: number | undefined;
	invalidate: (() => void) | undefined;
}

export interface ThoughtMember {
	startedAt: number;
	settledAt: number | undefined;
	text: string;
	isExpanded: boolean;
}

export interface RowGroup {
	kind: RowKind;
	children: GroupChild[];
	ticker: ReturnType<typeof setInterval> | undefined;
	expansionLevel: ExpansionLevel;
	lastActivityAt: number;
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

type GroupChild =
	| { type: "command"; member: RowMember }
	| { type: "thought"; thought: ThoughtMember };

const openGroups = new Set<RowGroup>();
const groupsByCall = new Map<string, RowGroup>();
const pendingThoughts: GroupChild[] = [];
let currentGroup: RowGroup | undefined;
let newestGroup: RowGroup | undefined;
let liveThought: ThoughtMember | undefined;
let invalidating = false;
let presenceListener: (() => void) | undefined;
let lastPresence = false;

export function setRowPresenceListener(listener: (() => void) | undefined): void {
	presenceListener = listener;
}

export function hasLiveRow(): boolean {
	return currentGroup !== undefined;
}

export function hasAnyRowGroup(): boolean {
	return openGroups.size > 0;
}

export function joinRowGroup(input: RowCallInput): RowGroup {
	const group = groupForCall(input);
	const member = ensureMember(group, input);

	member.target = input.target;
	member.invalidate = input.invalidate;

	startGroupTicker(group);
	invalidateDrawingMember(group, member);

	return group;
}

export function settleRowGroup(input: RowSettleInput): RowGroup {
	const group = groupForCall(input);
	const member = ensureMember(group, input);

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
	invalidateDrawingMember(group, member);

	return group;
}

export function recordThought(text: string): void {
	if (!liveThought) {
		liveThought = { startedAt: Date.now(), settledAt: undefined, text, isExpanded: false };
		childrenForThought().push({ type: "thought", thought: liveThought });
	}
	liveThought.text = text;
	repaintCurrentRow();
}

export function settleThought(): void {
	if (!liveThought) {
		return;
	}

	liveThought.settledAt = Date.now();
	liveThought = undefined;
	repaintCurrentRow();
}

export function toggleThoughtAt(group: RowGroup, thoughtIndex: number): void {
	const thought = thoughtMembers(group)[thoughtIndex];

	if (!thought) {
		return;
	}

	thought.isExpanded = !thought.isExpanded;
	repaintGroups();
}

export function closeRowGroup(): void {
	const group = currentGroup;

	currentGroup = undefined;

	if (group) {
		foldGroup(group);
	}

	notifyPresence();
}

export function rowGroupOfCall(toolCallId: string): RowGroup | undefined {
	return groupsByCall.get(toolCallId);
}

export function advanceGroupExpansion(group: RowGroup): void {
	group.expansionLevel = nextExpansionLevel(group.expansionLevel, hasGroupStep(group));

	for (const member of commandMembers(group)) {
		safelyInvalidate(member);
	}
}

export function repaintCurrentRow(): void {
	const head = currentGroup ? headMember(currentGroup) : undefined;

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
	pendingThoughts.length = 0;
	currentGroup = undefined;
	newestGroup = undefined;
	liveThought = undefined;
	lastPresence = false;
	presenceListener?.();
}

export function isGroupHead(group: RowGroup, toolCallId: string): boolean {
	return headMember(group)?.toolCallId === toolCallId;
}

export function groupSummary(group: RowGroup, hint: string | undefined): RowGroupSummary {
	const head = headMember(group);
	const thinking = group === currentGroup ? thinkingState() : undefined;
	const isLive =
		thinking !== undefined ||
		commandMembers(group).some((member) => member.status === ToolStatus.Running);
	const endMilliseconds = liveEndMilliseconds(group, isLive);
	const durationMilliseconds =
		head && endMilliseconds !== undefined ? Math.max(0, endMilliseconds - head.startedAt) : undefined;

	return {
		kind: group.kind,
		children: group.children.map(childSummary),
		durationMilliseconds,
		folded: group !== currentGroup && group.expansionLevel === ExpansionLevel.Row,
		hint,
		thinking,
		isNewestGroup: group === newestGroup,
	};
}

export function thoughtOfChildAt(group: RowGroup, thoughtIndex: number): ThoughtMember | undefined {
	return thoughtMembers(group)[thoughtIndex];
}


function childSummary(child: GroupChild): RowChild {
	if (child.type === "thought") {
		return { type: "thought", thought: thoughtSummary(child.thought) };
	}

	return { type: "command", row: rowSummary(child.member) };
}

function thoughtSummary(thought: ThoughtMember): ThoughtSummary {
	return {
		text: thought.text,
		elapsedMilliseconds: thoughtElapsed(thought),
		isExpanded: thought.isExpanded,
	};
}

function thoughtElapsed(thought: ThoughtMember): number | undefined {
	if (thought.settledAt === undefined) {
		return undefined;
	}

	return Math.max(0, thought.settledAt - thought.startedAt);
}

function commandMembers(group: RowGroup): RowMember[] {
	return group.children.flatMap((child) => (child.type === "command" ? [child.member] : []));
}

function thoughtMembers(group: RowGroup): ThoughtMember[] {
	return group.children.flatMap((child) => (child.type === "thought" ? [child.thought] : []));
}

function headMember(group: RowGroup): RowMember | undefined {
	return group.children.find((child) => child.type === "command")?.member;
}

function childrenForThought(): GroupChild[] {
	return currentGroup ? currentGroup.children : pendingThoughts;
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
		children: adoptPendingThoughts(),
		ticker: undefined,
		expansionLevel: ExpansionLevel.Row,
		lastActivityAt: Date.now(),
	};

	openGroups.add(group);
	currentGroup = group;
	newestGroup = group;

	if (previousGroup) {
		foldGroup(previousGroup);
	}

	notifyPresence();

	return group;
}

function adoptPendingThoughts(): GroupChild[] {
	const adopted = [...pendingThoughts];

	pendingThoughts.length = 0;

	return adopted;
}

function notifyPresence(): void {
	const hasLive = hasLiveRow();

	if (hasLive === lastPresence) {
		return;
	}

	lastPresence = hasLive;
	presenceListener?.();
}

function foldGroup(group: RowGroup): void {
	group.expansionLevel = ExpansionLevel.Row;

	for (const member of commandMembers(group)) {
		safelyInvalidate(member);
	}
}

function ensureMember(group: RowGroup, input: RowCallInput): RowMember {
	const existing = commandMembers(group).find((member) => member.toolCallId === input.toolCallId);

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
	};

	group.children.push({ type: "command", member });
	groupsByCall.set(member.toolCallId, group);

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
	if (commandMembers(group).some((member) => member.status === ToolStatus.Running)) {
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
	const head = headMember(group);

	if (head) {
		safelyInvalidate(head);
	}
}

function invalidateDrawingMember(group: RowGroup, joining: RowMember): void {
	const head = headMember(group);

	if (!head || head.toolCallId === joining.toolCallId) {
		return;
	}

	safelyInvalidate(head);
}

function repaintGroups(): void {
	for (const group of openGroups) {
		const head = headMember(group);

		if (head) {
			safelyInvalidate(head);
		}
	}
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
