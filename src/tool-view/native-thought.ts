import {
	AssistantMessageComponent,
	initTheme,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { thoughtForCall, type MessageContent } from "./thought-store.ts";

const COLLAPSED_THINKING_BLOCK = true;
const THINKING_LABEL = "Thinking...";
const LEADING_SPACER_INDEX = 0;

type AssistantMessage = NonNullable<
	ConstructorParameters<typeof AssistantMessageComponent>[0]
>;

interface ComponentInternals {
	contentContainer?: { children: Component[] };
}

let isThemeReady = false;
let componentByCall = new Map<string, Component>();

export function prepareNativeThoughts(): void {
	if (isThemeReady) {
		return;
	}

	try {
		initTheme();
		isThemeReady = true;
	} catch {
		isThemeReady = false;
	}
}

export function nativeThoughtForCall(toolCallId: string): Component | undefined {
	const cached = componentByCall.get(toolCallId);

	if (cached) {
		return cached;
	}

	prepareNativeThoughts();

	const message = thoughtForCall(toolCallId);

	if (!message) {
		return undefined;
	}

	const component = new AssistantMessageComponent(
		// SAFETY: the stored message is the assistant message the call came from; only its content
		// was reduced to its thinking blocks, every other field is unchanged.
		message as unknown as AssistantMessage,
		COLLAPSED_THINKING_BLOCK,
		undefined,
		THINKING_LABEL,
	);

	componentByCall.set(toolCallId, dropLeadingSpacer(component));

	return componentByCall.get(toolCallId);
}

function dropLeadingSpacer(component: AssistantMessageComponent): AssistantMessageComponent {
	// SAFETY: this component is one we built, and Pi always starts its content with one Spacer; the
	// optional lookup keeps the extra blank line rather than crashing if that shape ever changes.
	const internals = component as unknown as ComponentInternals;
	const first = internals.contentContainer?.children[LEADING_SPACER_INDEX];

	if (first && first.render(1).every((line) => line.trim() === "")) {
		internals.contentContainer?.children.shift();
	}

	return component;
}

export function resetNativeThoughts(): void {
	componentByCall = new Map<string, Component>();
}

export type { MessageContent };
