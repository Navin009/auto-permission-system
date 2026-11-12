import {
	AssistantMessageComponent,
	initTheme,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { thoughtForCall, type MessageContent } from "./thought-store.ts";

const VISIBLE_THINKING_BLOCK = false;

type AssistantMessage = NonNullable<
	ConstructorParameters<typeof AssistantMessageComponent>[0]
>;

let isThemeReady = false;

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
	prepareNativeThoughts();

	const message = thoughtForCall(toolCallId);

	if (!message) {
		return undefined;
	}

	return new AssistantMessageComponent(
		// SAFETY: the stored message is the assistant message the call came from; only its content
		// was reduced to its thinking blocks, every other field is unchanged.
		message as unknown as AssistantMessage,
		VISIBLE_THINKING_BLOCK,
	);
}

export type { MessageContent };
