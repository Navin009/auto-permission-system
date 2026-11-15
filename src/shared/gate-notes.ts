const notesByCall = new Map<string, string>();

export function rememberGateNote(toolCallId: string | undefined, note: string): void {
	if (!toolCallId) {
		return;
	}

	notesByCall.set(toolCallId, note);
}

export function gateNoteFor(toolCallId: string): string | undefined {
	return notesByCall.get(toolCallId);
}

export function clearGateNotes(): void {
	notesByCall.clear();
}
