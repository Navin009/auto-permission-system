import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratchDirectory = mkdtempSync(join(tmpdir(), "pi-fail-closed-"));
const agentDirectory = join(scratchDirectory, "agent");

mkdirSync(join(agentDirectory, "extensions"), { recursive: true });
writeFileSync(join(agentDirectory, "extensions", "sandbox.json"), JSON.stringify({ enabled: false }));
process.env.PI_CODING_AGENT_DIR = agentDirectory;

const { default: sandboxExtension } = await import("#extensions/sandbox.ts");

let pass = 0;
let fail = 0;
const check = (name, condition, extra = "") => {
	if (condition) pass++;
	else {
		fail++;
		console.log("FAIL:", name, "→", extra);
	}
};

function registerSandbox(getFlag) {
	const handlers = new Map();
	const pi = {
		on: (event, handler) => {
			handlers.set(event, handler);
			return () => {};
		},
		events: { emit: () => {}, on: () => () => {} },
		registerFlag: () => {},
		registerTool: () => {},
		registerCommand: () => {},
		getFlag,
	};

	sandboxExtension(pi);

	return handlers;
}

const projectDirectory = join(scratchDirectory, "project");
mkdirSync(projectDirectory, { recursive: true });

const context = {
	cwd: projectDirectory,
	hasUI: false,
	isProjectTrusted: () => true,
	ui: { notify: () => {}, setStatus: () => {}, theme: { fg: (_color, text) => text } },
};

const blockedHandlers = registerSandbox(() => undefined);
await blockedHandlers.get("session_start")({}, context);

const blockedBash = await blockedHandlers.get("tool_call")({ toolName: "bash", input: { command: "ls" } }, context);

check("bash is blocked while the sandbox is disabled", blockedBash?.block === true, JSON.stringify(blockedBash));
check("the block names the reason", String(blockedBash?.reason).includes("disabled in sandbox.json"), String(blockedBash?.reason));
check("the block says nothing ran", String(blockedBash?.reason).includes("Nothing was run"), String(blockedBash?.reason));

const otherTool = await blockedHandlers.get("tool_call")({ toolName: "read", input: { path: "notes.md" } }, context);

check("a non-bash tool is not gated here", otherTool === undefined, JSON.stringify(otherTool));

const yoloHandlers = registerSandbox((name) => (name === "yolo" ? true : undefined));
await yoloHandlers.get("session_start")({}, context);

const freeBash = await yoloHandlers.get("tool_call")({ toolName: "bash", input: { command: "ls" } }, context);

check("--yolo still runs bash", freeBash === undefined, JSON.stringify(freeBash));

rmSync(scratchDirectory, { recursive: true, force: true });

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
