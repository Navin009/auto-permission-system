const notesByCall = new Map<string, string>();
const nativeNotesByCall = new Map<string, string[]>();

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

export function rememberNativeNote(toolCallId: string | undefined, note: string): void {
	if (!toolCallId || !note.trim()) {
		return;
	}

	const existing = nativeNotesByCall.get(toolCallId) ?? [];

	if (!existing.includes(note)) {
		existing.push(note);
		nativeNotesByCall.set(toolCallId, existing);
	}

	repaintRows?.();
}

export function gateNoteFor(toolCallId: string): string | undefined {
	return notesByCall.get(toolCallId);
}

export function nativeBottomNoteFor(toolCallId: string): string | undefined {
	const nativeNotes = nativeNotesByCall.get(toolCallId) ?? [];
	const gateNote = notesByCall.get(toolCallId);
	const combined = gateNote && !nativeNotes.includes(gateNote) ? [...nativeNotes, gateNote] : nativeNotes;

	return combined.length > 0 ? combined.join(" · ") : undefined;
}

export function clearGateNotes(): void {
	notesByCall.clear();
	nativeNotesByCall.clear();
}
