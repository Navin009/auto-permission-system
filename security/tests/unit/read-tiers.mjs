import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratchDirectory = mkdtempSync(join(tmpdir(), "pi-read-tiers-"));
process.env.PI_CODING_AGENT_DIR = join(scratchDirectory, "agent");

const { checkReadAccess } = await import("../../../src/l2-guard/tool-gates.ts");
const { ReadExposure } = await import("../../../src/core/index.ts");

let pass = 0;
let fail = 0;
const check = (name, condition, extra = "") => {
	if (condition) pass++;
	else {
		fail++;
		console.log("FAIL:", name, "→", extra);
	}
};

const base = join(scratchDirectory, "base");
const projectDirectory = join(base, "project");

for (const directory of ["denied", "allowed-write", "allowed-read", "override-read", "asked", "elsewhere", "project"]) {
	mkdirSync(join(base, directory), { recursive: true });
}

const policy = {
	enabled: true,
	network: { allowedDomains: [], deniedDomains: [] },
	filesystem: {
		denyRead: [join(base, "denied"), join(base, "denied-and-allowed")],
		modelDenyRead: [],
		denyWrite: [],
		askRead: [join(base, "asked")],
		allowRead: [join(base, "allowed-read")],
		allowWrite: [join(base, "allowed-write"), join(base, "denied-and-allowed")],
	},
	overrides: { allowRead: [join(base, "override-read")], allowWrite: [] },
};

const selectCalls = [];
const context = {
	cwd: projectDirectory,
	hasUI: true,
	mode: "rpc",
	ui: {
		select: async (_title, options) => {
			selectCalls.push(options);
			return undefined;
		},
		notify: () => {},
		input: async () => undefined,
		setStatus: () => {},
		theme: { fg: (_color, text) => text },
	},
};

async function read(path, exposure = ReadExposure.Content) {
	selectCalls.length = 0;
	const result = await checkReadAccess(path, "read", context, policy, exposure);
	return { result, prompts: selectCalls.length };
}

{
	const { result, prompts } = await read(join(base, "denied", "a.txt"));
	check("deny blocks", result?.block === true, JSON.stringify(result));
	check("deny does not ask", prompts === 0, String(prompts));
}

{
	const { result, prompts } = await read(join(base, "denied-and-allowed", "a.txt"));
	check("deny outranks an allow entry", result?.block === true, JSON.stringify(result));
	check("deny outranks an allow entry without asking", prompts === 0, String(prompts));
}

for (const [label, directory] of [
	["an allowWrite root allows", "allowed-write"],
	["an allowRead entry allows", "allowed-read"],
	["an allowRead override allows", "override-read"],
]) {
	const { result, prompts } = await read(join(base, directory, "a.txt"));
	check(label, result === undefined, JSON.stringify(result));
	check(`${label} without asking`, prompts === 0, String(prompts));
}

{
	const { result, prompts } = await read(join(projectDirectory, "notes.md"));
	check("the project itself allows", result === undefined, JSON.stringify(result));
	check("the project itself does not ask", prompts === 0, String(prompts));
}

{
	const { result, prompts } = await read(join(base, "asked", "a.txt"));
	check("an ask entry asks", prompts === 1, String(prompts));
	check("an unanswered ask blocks", result?.block === true);
}

{
	const { result, prompts } = await read(join(base, "elsewhere", "secret.txt"));
	check("a path in no list asks", prompts === 1, String(prompts));
	check("a path in no list blocks when unanswered", result?.block === true);
	check("the reason names the missing allow entry", String(result?.reason).includes("not in any allow list"), String(result?.reason));
}

{
	const { result, prompts } = await read(join(base, "elsewhere"), ReadExposure.Name);
	check("a name-only listing needs no allow entry", result === undefined, JSON.stringify(result));
	check("a name-only listing does not ask", prompts === 0, String(prompts));
}

rmSync(scratchDirectory, { recursive: true, force: true });

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
