/**
 * YOLO state (permission mode `yolo`), shared by every layer entrypoint (ADR-020).
 *
 * Two pi behaviors shape this module:
 *
 * 1. `pi.getFlag(name)` is **extension-scoped**: pi's loader returns
 *    `undefined` unless the calling extension is the one that registered
 *    `name`. `--yolo` was registered only by `sandbox.ts`, so `guard.ts`'s
 *    check read `undefined` and Layer 2 (including the Advanced Secure output
 *    gate) stayed active under `--yolo`. `sandbox.ts` is now the single flag
 *    owner and broadcasts the state; registering the same flag from every
 *    entrypoint would list it once per extension in `--help`.
 *
 * 2. The entrypoints share no memory (ADR-018), so both the runtime toggle and
 *    the startup value travel over pi's process-wide event bus via `emitYolo()`
 *    and `onYolo()`. `sandbox.ts` emits first thing in `session_start`; the
 *    other entrypoints only listen.
 *
 * The persisted half of YOLO is the `mode: "yolo"` value in the global
 * sandbox.json (written by `/permission-mode` through `setPolicyMode()`);
 * `sandbox.ts` reads it and broadcasts. `--yolo` is the per-run flag for the
 * same state and writes nothing.
 */

/** pi's shared event bus channel for the runtime toggle. */
export const YOLO_CHANNEL = "auto-permission-system:yolo";

/** Footer text shown while every layer is disabled. */
export const YOLO_STATUS = "⚠️  YOLO — all security layers disabled";

/** The pi APIs this module needs; kept structural so tests can fake them. */
export interface YoloFlagPI {
	registerFlag(
		name: string,
		options: { description: string; type: "boolean"; default: boolean },
	): void;
	getFlag(name: string): boolean | string | undefined;
}

export interface YoloBus {
	emit(channel: string, data: unknown): void;
	on(channel: string, handler: (data: unknown) => void): () => void;
}

/**
 * Register `--yolo` / `--no-sandbox` for the calling extension, so that
 * extension's `getFlag()` can actually read the CLI value. Call it from exactly
 * one entrypoint (`sandbox.ts`): pi prints every extension's flags in `--help`,
 * so a second registration shows the flag twice. The other entrypoints learn
 * the state from `emitYolo()` / `onYolo()` instead.
 */
export function registerYoloFlags(pi: YoloFlagPI): void {
	pi.registerFlag("yolo", {
		description: "Disable all pi security layers (no-sandbox, no in-process guard, no browser gate). Use with caution.",
		type: "boolean",
		default: false,
	});
	// Backwards compat alias
	pi.registerFlag("no-sandbox", {
		description: "(Deprecated) alias for --yolo. Use --yolo instead.",
		type: "boolean",
		default: false,
	});
}

/** Read the startup flags for this extension. Only true is truthy. */
export function yoloFromFlags(pi: YoloFlagPI): boolean {
	return pi.getFlag("yolo") === true || pi.getFlag("no-sandbox") === true;
}

/** Tell every layer whether YOLO is on. */
export function emitYolo(bus: YoloBus, enabled: boolean): void {
	bus.emit(YOLO_CHANNEL, { enabled });
}

/** Subscribe to the runtime toggle; ignores malformed payloads. Returns an unsubscribe. */
export function onYolo(bus: YoloBus, handler: (enabled: boolean) => void): () => void {
	return bus.on(YOLO_CHANNEL, (data) => {
		const enabled = (data as { enabled?: unknown } | null | undefined)?.enabled;
		if (typeof enabled === "boolean") handler(enabled);
	});
}
