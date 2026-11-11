import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_VIEW_MODE, normalizeViewMode, type ViewMode } from "./view-mode.ts";

export const TOOL_VIEW_SETTINGS_FILE_NAME = "tool-view.json";
const VIEW_MODE_KEY = "view";

export interface ToolViewSettings {
	viewMode: ViewMode;
}

export const DEFAULT_TOOL_VIEW_SETTINGS: ToolViewSettings = { viewMode: DEFAULT_VIEW_MODE };

export function normalizeToolViewSettings(value: unknown): ToolViewSettings {
	if (typeof value !== "object" || value === null) {
		return { ...DEFAULT_TOOL_VIEW_SETTINGS };
	}

	const storedSettings = value as Record<string, unknown>;

	return { viewMode: normalizeViewMode(storedSettings[VIEW_MODE_KEY]) };
}

export function readToolViewSettings(settingsFilePath: string): ToolViewSettings {
	if (!existsSync(settingsFilePath)) {
		return { ...DEFAULT_TOOL_VIEW_SETTINGS };
	}

	try {
		return normalizeToolViewSettings(JSON.parse(readFileSync(settingsFilePath, "utf-8")));
	} catch {
		return { ...DEFAULT_TOOL_VIEW_SETTINGS };
	}
}

export function writeToolViewMode(settingsFilePath: string, viewMode: ViewMode): string | null {
	const storedSettings = readStoredObject(settingsFilePath);
	storedSettings[VIEW_MODE_KEY] = normalizeViewMode(viewMode);

	try {
		mkdirSync(dirname(settingsFilePath), { recursive: true });
		writeFileSync(settingsFilePath, `${JSON.stringify(storedSettings, null, 2)}\n`);
		return null;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

function readStoredObject(settingsFilePath: string): Record<string, unknown> {
	if (!existsSync(settingsFilePath)) {
		return {};
	}

	try {
		const parsedSettings = JSON.parse(readFileSync(settingsFilePath, "utf-8"));

		return typeof parsedSettings === "object" && parsedSettings !== null ? parsedSettings : {};
	} catch {
		return {};
	}
}
