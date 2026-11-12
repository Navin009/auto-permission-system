import type { Theme } from "@earendil-works/pi-coding-agent";
import { Box, type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";

const NO_PADDING = 0;
const EMPTY_LINE = "";
const CLICK_TYPE = "click";
const LEFT_BUTTON = "left";

export type ToolBackground = Parameters<Theme["bg"]>[0];
export type ToolBackgroundFunction = (text: string) => string;

export const ToolBackgroundByState = {
	Pending: "toolPendingBg",
	Failed: "toolErrorBg",
	Ok: "toolSuccessBg",
} as const satisfies Record<string, ToolBackground>;

export interface ToolState {
	isPartial: boolean;
	isError: boolean;
}

export function toolBackground(state: ToolState): ToolBackground {
	if (state.isPartial) {
		return ToolBackgroundByState.Pending;
	}

	if (state.isError) {
		return ToolBackgroundByState.Failed;
	}

	return ToolBackgroundByState.Ok;
}

export class PiBlockComponent implements Component {
	private readonly theme: Theme;
	private readonly box: Box;
	private background: ToolBackground;
	private call: Component | undefined;
	private result: Component | undefined;
	private readonly onClick: () => void;

	constructor(theme: Theme, outputPad: number, background: ToolBackground, onClick: () => void) {
		this.theme = theme;
		this.background = background;
		this.onClick = onClick;
		this.box = new Box(outputPad, NO_PADDING, this.backgroundFunction());
	}

	get callComponent(): Component | undefined {
		return this.call;
	}

	get resultComponent(): Component | undefined {
		return this.result;
	}

	setBackground(background: ToolBackground): void {
		if (background === this.background) {
			return;
		}

		this.background = background;
		this.box.setBgFn(this.backgroundFunction());
	}

	setCall(component: Component): void {
		if (component === this.call) {
			return;
		}

		this.call = component;
		this.layout();
	}

	setResult(component: Component): void {
		if (component === this.result) {
			return;
		}

		this.result = component;
		this.layout();
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== CLICK_TYPE || event.button !== LEFT_BUTTON) {
			return undefined;
		}

		this.onClick();

		return { handled: true };
	}

	render(width: number): string[] {
		return this.box.render(width);
	}

	invalidate(): void {
		this.box.invalidate();
	}

	private backgroundFunction(): ToolBackgroundFunction {
		return (text) => this.theme.bg(this.background, text);
	}

	private layout(): void {
		this.box.clear();

		if (!this.call) {
			return;
		}

		this.box.addChild(new BlankLine());
		this.box.addChild(this.call);

		if (this.result) {
			this.box.addChild(this.result);
		}

		this.box.addChild(new BlankLine());
	}
}

class BlankLine implements Component {
	render(): string[] {
		return [EMPTY_LINE];
	}

	invalidate(): void {}
}
