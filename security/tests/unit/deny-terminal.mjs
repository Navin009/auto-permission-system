import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const scratchDirectory = mkdtempSync(join(tmpdir(), "pi-deny-terminal-"));
process.env.PI_CODING_AGENT_DIR = join(scratchDirectory, "agent");

const { checkReadAccess, checkWriteAccess } = await import("#l2-guard/tool-gates.ts");
const { ReadExposure } = await import("#core/index.ts");

let pass = 0;
let fail = 0;
const check = (name, condition, extra = "") => {
	if (condition) pass++;
	else {
		fail++;
		console.log("FAIL:", name, "→", extra);
	}
};

const home = homedir();
const selectCalls = [];

const context = {
	cwd: home,
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

const policy = {
	enabled: true,
	network: { allowedDomains: [], deniedDomains: [] },
	filesystem: {
		denyRead: [`${home}/deny-read`],
		modelDenyRead: [],
		denyWrite: [`${home}/deny-write`],
		askRead: [`${home}/ask-read`],
		askWrite: [`${home}/ask-write`],
		allowWrite: [home],
	},
	overrides: { allowRead: [], allowWrite: [] },
};

selectCalls.length = 0;
const deniedRead = await checkReadAccess(`${home}/deny-read/a.txt`, "read", context, policy);
check("a denyRead hit is blocked", deniedRead?.block === true, JSON.stringify(deniedRead));
check("a denyRead hit never prompts", selectCalls.length === 0, String(selectCalls.length));

selectCalls.length = 0;
const deniedModelRead = await checkReadAccess(`${home}/deny-read/b.txt`, "read", context, policy, ReadExposure.Content);
check("a denyRead hit is blocked for content reads too", deniedModelRead?.block === true);

selectCalls.length = 0;
const askedRead = await checkReadAccess(`${home}/ask-read/a.txt`, "read", context, policy);
check("an askRead hit still prompts", selectCalls.length === 1, String(selectCalls.length));
check("an unanswered askRead blocks", askedRead?.block === true);

selectCalls.length = 0;
const deniedWrite = await checkWriteAccess(`${home}/deny-write/a.txt`, "write", context, policy);
check("a denyWrite hit is blocked", deniedWrite?.block === true, JSON.stringify(deniedWrite));
check("a denyWrite hit never prompts", selectCalls.length === 0, String(selectCalls.length));

selectCalls.length = 0;
const askedWrite = await checkWriteAccess(`${home}/ask-write/a.txt`, "write", context, policy);
check("an askWrite hit still prompts", selectCalls.length === 1, String(selectCalls.length));
check("an unanswered askWrite blocks", askedWrite?.block === true);

selectCalls.length = 0;
const credentialRead = await checkReadAccess(join(home, ".ssh", "id_rsa"), "read", context, policy);
check("a credential keeps its prompt", selectCalls.length === 1, String(selectCalls.length));
check("a credential read is blocked when the prompt is unanswered", credentialRead?.block === true);

selectCalls.length = 0;
const allowedRead = await checkReadAccess(`${home}/notes/todo.md`, "read", context, policy);
check("an ordinary read is allowed", allowedRead === undefined, JSON.stringify(allowedRead));
check("an ordinary read never prompts", selectCalls.length === 0);

rmSync(scratchDirectory, { recursive: true, force: true });

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
