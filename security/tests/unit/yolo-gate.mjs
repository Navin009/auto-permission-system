import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const scratchDirectory = mkdtempSync(join(tmpdir(), "pi-yolo-gate-"));
const agentDirectory = join(scratchDirectory, "agent");

mkdirSync(join(agentDirectory, "extensions"), { recursive: true });
process.env.PI_CODING_AGENT_DIR = agentDirectory;

const { default: guardExtension } = await import("#extensions/guard.ts");
const { YOLO_CHANNEL } = await import("#shared/yolo.ts");

let pass = 0;
let fail = 0;
const check = (name, condition, extra = "") => {
	if (condition) pass++;
	else {
		fail++;
		console.log("FAIL:", name, "→", extra);
	}
};

function registerGuard(getFlag) {
	const eventHandlers = new Map();
	let yoloListener;

	const pi = {
		on: (event, handler) => {
			eventHandlers.set(event, handler);
			return () => {};
		},
		events: {
			emit: () => {},
			on: (channel, handler) => {
				if (channel === YOLO_CHANNEL) yoloListener = handler;
				return () => {};
			},
		},
		registerCommand: () => {},
		registerTool: () => {},
		registerFlag: () => {},
		getFlag,
	};

	guardExtension(pi);

	return { eventHandlers, emitYolo: (enabled) => yoloListener({ enabled }) };
}

const projectDirectory = join(scratchDirectory, "project");
mkdirSync(projectDirectory, { recursive: true });

const context = {
	cwd: projectDirectory,
	hasUI: false,
	isProjectTrusted: () => true,
	ui: { notify: () => {}, setStatus: () => {}, theme: { fg: (_color, text) => text } },
};

const deniedRead = { toolName: "read", toolCallId: "c1", input: { path: join(homedir(), ".gnupg", "x.key") } };

{
	const guard = registerGuard(() => undefined);
	await guard.eventHandlers.get("session_start")({}, context);

	const armedBlock = await guard.eventHandlers.get("tool_call")(deniedRead, context);
	check("the guard is armed before the emit", armedBlock?.block === true, JSON.stringify(armedBlock));

	guard.emitYolo(true);
	const afterStrayEmit = await guard.eventHandlers.get("tool_call")(deniedRead, context);
	check("a stray enable is ignored", afterStrayEmit?.block === true, JSON.stringify(afterStrayEmit));
}

{
	writeFileSync(join(agentDirectory, "extensions", "sandbox.json"), JSON.stringify({ mode: "yolo" }));

	const guard = registerGuard(() => undefined);
	await guard.eventHandlers.get("session_start")({}, context);
	guard.emitYolo(true);

	const yoloRead = await guard.eventHandlers.get("tool_call")(deniedRead, context);
	check("a configured yolo is honoured", yoloRead === undefined, JSON.stringify(yoloRead));

	guard.emitYolo(false);
	const restoredBlock = await guard.eventHandlers.get("tool_call")(deniedRead, context);
	check("disabling is always accepted", restoredBlock?.block === true, JSON.stringify(restoredBlock));
}

{
	writeFileSync(join(agentDirectory, "extensions", "sandbox.json"), JSON.stringify({ mode: "default" }));

	const flagGuard = registerGuard((name) => (name === "yolo" ? true : undefined));
	await flagGuard.eventHandlers.get("session_start")({}, context);

	const flagRead = await flagGuard.eventHandlers.get("tool_call")(deniedRead, context);
	check("the --yolo flag disarms the guard without an emit", flagRead === undefined, JSON.stringify(flagRead));
}

rmSync(scratchDirectory, { recursive: true, force: true });

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
