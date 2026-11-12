import { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

export type NativeThoughtMessage = NonNullable<
	ConstructorParameters<typeof AssistantMessageComponent>[0]
>;

type UpdateContent = AssistantMessageComponent["updateContent"];
type ComponentSettings = ConstructorParameters<typeof AssistantMessageComponent>;

interface NativeComponentState {
	hideThinkingBlock: boolean;
	hiddenThinkingLabel: string;
	markdownTheme: ComponentSettings[2];
	outputPad: number;
	markdownTransformers: ComponentSettings[5];
	messageId: string | undefined;
	timestamp: string | undefined;
}

interface NativeThought {
	revision: number;
	message: NativeThoughtMessage;
	component: AssistantMessageComponent;
	restoration: Pick<NativeComponentState, "hideThinkingBlock" | "hiddenThinkingLabel"> | undefined;
}

interface CapturablePrototype {
	updateContent: UpdateContent;
	[CAPTURE_ORIGINAL]?: UpdateContent;
}

const THINKING_BLOCK_TYPE = "thinking";
const STOPPED_REASON = "stop";
const SUPPRESSED_LABEL = "";
const SUPPRESSION_PROBE_WIDTH = 80;
const CAPTURE_ORIGINAL = Symbol.for("auto-permission-system/native-thinking-capture");

let componentsByMessage = new WeakMap<NativeThoughtMessage, AssistantMessageComponent>();
let thoughts: NativeThought[] = [];

export function installNativeThinkingCapture(): void {
	const prototype = AssistantMessageComponent.prototype as CapturablePrototype;

	if (prototype[CAPTURE_ORIGINAL]) {
		return;
	}

	const originalUpdate = prototype.updateContent;

	prototype.updateContent = function (this: AssistantMessageComponent, message, isStreaming) {
		originalUpdate.call(this, message, isStreaming);
		componentsByMessage.set(message, this);

		for (const thought of thoughts) {
			if (thought.component === this) {
				thought.message = message;
			}
		}
	};
	prototype[CAPTURE_ORIGINAL] = originalUpdate;
}

export function trackNativeThought(message: NativeThoughtMessage, revision: number): void {
	const component = componentsByMessage.get(message);

	if (!component) {
		return;
	}

	const existing = thoughts.find((thought) => thought.revision === revision);

	if (existing) {
		existing.message = message;
		existing.component = component;
		return;
	}

	thoughts.push({ revision, message, component, restoration: undefined });
}

export function suppressNativeThoughtsAfter(
	afterRevision: number,
	beforeRevision: number,
): Component[] | undefined {
	const matching = thoughts.filter(
		(thought) => thought.revision > afterRevision && thought.revision <= beforeRevision,
	);

	if (matching.length !== beforeRevision - afterRevision) {
		return undefined;
	}

	const nativeViews: Component[] = [];

	for (const thought of matching) {
		const view = suppressNativeThought(thought);

		if (!view) {
			restoreSuppressedThoughts();
			return undefined;
		}

		nativeViews.push(view);
	}

	return nativeViews;
}

export function resetNativeThinking(): void {
	restoreSuppressedThoughts();

	thoughts = [];
	componentsByMessage = new WeakMap<NativeThoughtMessage, AssistantMessageComponent>();
}

function suppressNativeThought(thought: NativeThought): Component | undefined {
	if (thought.restoration) {
		return createNativeThoughtView(thought);
	}

	const state = readComponentState(thought.component);

	thought.restoration = {
		hideThinkingBlock: state.hideThinkingBlock,
		hiddenThinkingLabel: state.hiddenThinkingLabel,
	};
	state.hideThinkingBlock = true;
	state.hiddenThinkingLabel = SUPPRESSED_LABEL;
	thought.component.updateContent(thought.message, false);

	if (thought.component.render(SUPPRESSION_PROBE_WIDTH).length > 0) {
		restoreNativeThought(thought);
		return undefined;
	}

	return createNativeThoughtView(thought);
}

function createNativeThoughtView(thought: NativeThought): AssistantMessageComponent {
	const state = readComponentState(thought.component);
	const message = thoughtOnlyMessage(thought.message);
	const nativeLabel = thought.restoration?.hiddenThinkingLabel ?? state.hiddenThinkingLabel;

	return new AssistantMessageComponent(
		message,
		true,
		state.markdownTheme,
		nativeLabel || undefined,
		state.outputPad,
		state.markdownTransformers,
		state.messageId,
		state.timestamp,
	);
}

function thoughtOnlyMessage(message: NativeThoughtMessage): NativeThoughtMessage {
	return {
		...message,
		content: message.content.filter((block) => block.type === THINKING_BLOCK_TYPE),
		stopReason: STOPPED_REASON,
		errorMessage: undefined,
	};
}

function restoreSuppressedThoughts(): void {
	for (const thought of thoughts) {
		if (thought.restoration) {
			restoreNativeThought(thought);
		}
	}
}

function restoreNativeThought(thought: NativeThought): void {
	if (!thought.restoration) {
		return;
	}

	Object.assign(readComponentState(thought.component), thought.restoration);
	thought.component.updateContent(thought.message, false);
	thought.restoration = undefined;
}

function readComponentState(component: AssistantMessageComponent): NativeComponentState {
	// SAFETY: Pi's runtime component has these private display fields.
	return component as unknown as NativeComponentState;
}
