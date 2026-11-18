const notesByCall = new Map<string, string>();

let repaintRows: (() => void) | undefined;

export function setGateNoteRepaint(repaint: () => void): void {
	repaintRows = repaint;
}

export function rememberGateNote(toolCallId: string | undefined, note: string): void {
	if (!toolCallId) {
		return;
	}

	notesByCall.set(toolCallId, note);
	repaintRows?.();
}

export function gateNoteFor(toolCallId: string): string | undefined {
	return notesByCall.get(toolCallId);
}

export function clearGateNotes(): void {
	notesByCall.clear();
}
