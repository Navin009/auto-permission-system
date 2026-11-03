export const YOLO_CHANNEL = "auto-permission-system:yolo";
export const YOLO_STATUS = "🚨  YOLO — all security layers disabled";

export interface YoloFlagProvider {
	registerFlag(
		name: string,
		options: { description: string; type: "boolean"; default: boolean },
	): void;
	getFlag(name: string): boolean | string | undefined;
}

export type YoloFlagPI = YoloFlagProvider;

export interface YoloEventBus {
	emit(channel: string, data: unknown): void;
	on(channel: string, handler: (data: unknown) => void): () => void;
}

export type YoloBus = YoloEventBus;

export function registerYoloFlags(flagProvider: YoloFlagProvider): void {
	flagProvider.registerFlag("yolo", {
		description: "Disable all pi security layers (no-sandbox, no in-process guard, no browser gate). Use with caution.",
		type: "boolean",
		default: false,
	});

	flagProvider.registerFlag("no-sandbox", {
		description: "(Deprecated) alias for --yolo. Use --yolo instead.",
		type: "boolean",
		default: false,
	});
}

export function yoloFromFlags(flagProvider: YoloFlagProvider): boolean {
	const hasYoloFlag = flagProvider.getFlag("yolo") === true;
	const hasNoSandboxFlag = flagProvider.getFlag("no-sandbox") === true;

	return hasYoloFlag || hasNoSandboxFlag;
}

export function emitYolo(bus: YoloEventBus, isEnabled: boolean): void {
	bus.emit(YOLO_CHANNEL, { enabled: isEnabled });
}

export function onYolo(bus: YoloEventBus, handler: (isEnabled: boolean) => void): () => void {
	return bus.on(YOLO_CHANNEL, (data) => {
		const payload = data as { enabled?: unknown } | null | undefined;
		const isEnabled = payload?.enabled;

		if (typeof isEnabled === "boolean") {
			handler(isEnabled);
		}
	});
}
