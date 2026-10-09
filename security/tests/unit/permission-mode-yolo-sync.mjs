// `/permission-mode` must reconcile a persisted mode with the running session's
// runtime state: another session can write mode=yolo to the global sandbox.json
// after this session started, so picking YOLO here has to emit the toggle even
// though the persisted mode already reads as yolo.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const agentDir = mkdtempSync(join(tmpdir(), "aps-mode-sync-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const cwd = mkdtempSync(join(tmpdir(), "aps-mode-sync-cwd-"));
mkdirSync(join(agentDir, "extensions"), { recursive: true });
writeFileSync(join(agentDir, "extensions", "sandbox.json"), JSON.stringify({ enabled: true, mode: "yolo" }));

const { default: register } = await import("../../../extensions/permission-mode.ts");
const { YOLO_CHANNEL } = await import("../../../src/shared/yolo.ts");

let pass = 0;
let fail = 0;
const check = (name, cond) => {
	if (cond) pass++;
	else {
		fail++;
		console.log("FAIL:", name);
	}
};

const handlers = new Map();
const emitted = [];
const events = {
	emit: (channel, data) => {
		emitted.push({ channel, data });
		for (const h of handlers.get(channel) ?? []) h(data);
	},
	on: (channel, handler) => {
		const list = handlers.get(channel) ?? [];
		list.push(handler);
		handlers.set(channel, list);
		return () => {};
	},
};

let command;
const pi = { events, registerCommand: (_name, def) => (command = def) };
register(pi);

const notices = [];
const ctx = {
	cwd,
	ui: {
		select: async (_title, options) => options.find((o) => o.includes("YOLO")),
		notify: (message, level) => notices.push({ message, level }),
		setStatus: () => {},
		theme: { fg: (_color, text) => text },
	},
};

// Persisted yolo, runtime not yolo: the pick must turn the layers off.
await command.handler("", ctx);
check("picking YOLO emits the toggle", emitted.some((e) => e.channel === YOLO_CHANNEL && e.data.enabled === true));
check("the notice does not claim it was already on", notices.some((n) => n.message.includes("YOLO") && !n.message.includes("already")));

// Runtime already yolo (bus listener synced it): a second pick is a no-op.
const before = emitted.filter((e) => e.channel === YOLO_CHANNEL).length;
await command.handler("", ctx);
check("a no-op pick emits nothing new", emitted.filter((e) => e.channel === YOLO_CHANNEL).length === before);
check("a no-op pick says it is already YOLO", notices.some((n) => n.message.includes("already")));

rmSync(cwd, { recursive: true, force: true });
rmSync(agentDir, { recursive: true, force: true });

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
