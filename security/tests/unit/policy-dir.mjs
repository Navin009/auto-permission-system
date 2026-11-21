// A policy path that is not a file must not disarm a layer (S7).
//
// `fileHash` used `existsSync` + `readFileSync`, so a *directory* named
// `.pi/sandbox.json` threw EISDIR. The throw escaped `session_start` before
// either layer was armed: the guard stayed inactive for the whole session and
// the bash sandbox never started. One `mkdir -p .pi/sandbox.json` in a cloned
// repository was a two-layer bypass on the next open.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const scratchDirectory = mkdtempSync(join(tmpdir(), "pi-policy-dir-"));

// `getAgentDir()` is read at module load by the audit log and both trust
// stores, so the environment has to be set before anything is imported.
process.env.PI_CODING_AGENT_DIR = join(scratchDirectory, "agent");

let pass = 0;
let fail = 0;
const check = (name, condition, extra = "") => {
	if (condition) pass++;
	else {
		fail++;
		console.log("FAIL:", name, "→", extra);
	}
};

const { fileHash, isProjectFileTrusted, createProjectTrust } = await import("../../../src/core/trust.ts");
const { policyFileError, projectPolicyPath } = await import("../../../src/core/index.ts");
const { loadConfig } = await import("../../../src/l1-sandbox/config.ts");
const { loadPolicy, untrustedProjectChanges, TRUST_STORE } = await import("../../../src/l2-guard/policy.ts");

const projectDirectory = mkdtempSync(join(scratchDirectory, "project-"));

mkdirSync(projectPolicyPath(projectDirectory), { recursive: true });

const policyPath = projectPolicyPath(projectDirectory);
const plainFile = join(scratchDirectory, "plain.json");
writeFileSync(plainFile, '{"enabled":true}\n');

// fileHash: missing and non-file are both "no hash", never a throw.
check("a directory has no hash", fileHash(policyPath) === null);
check("a missing path has no hash", fileHash(join(scratchDirectory, "absent.json")) === null);
check("a file still hashes", /^[0-9a-f]{64}$/.test(fileHash(plainFile) ?? ""));

// Trust: absent means "nothing to distrust"; present-but-unreadable must not.
check("a missing policy file is trusted (nothing to approve)", isProjectFileTrusted(join(scratchDirectory, "absent.json"), TRUST_STORE) === true);
check("a directory is not trusted", isProjectFileTrusted(policyPath, TRUST_STORE) === false);
check(
	"a directory does not become trusted through the project helper",
	createProjectTrust(join(scratchDirectory, "trust.json")).isTrusted(projectDirectory) === false,
);

// The message a user sees should name the real problem, not "syntax error".
check("the read error names a non-file", (policyFileError(policyPath) ?? "").includes("is not a file"), policyFileError(policyPath));

// Reading the policy must not throw anywhere a layer depends on it.
let loadConfigThrew = "";
let config;
try {
	config = loadConfig(projectDirectory);
} catch (error) {
	loadConfigThrew = String(error);
}
check("loadConfig does not throw", loadConfigThrew === "", loadConfigThrew);
check("loadConfig still yields the shipped policy", config?.enabled === true && (config?.filesystem?.denyRead ?? []).length > 0);

let loadPolicyThrew = "";
let policy;
try {
	policy = loadPolicy(projectDirectory);
} catch (error) {
	loadPolicyThrew = String(error);
}
check("loadPolicy does not throw", loadPolicyThrew === "", loadPolicyThrew);
check("loadPolicy stays enabled", policy?.enabled === true);

let changesThrew = "";
let changes;
try {
	changes = untrustedProjectChanges(projectDirectory);
} catch (error) {
	changesThrew = String(error);
}
check("untrustedProjectChanges does not throw", changesThrew === "", changesThrew);
check("a directory reports no loosening", Array.isArray(changes) && changes.length === 0, JSON.stringify(changes));

// Contract: the guard itself must still be armed after a session_start on that
// project. This is the assertion that fails without the fix -- the handler threw
// before `isPolicyEnabled = true`, and every later tool_call returned early.
const extension = await import("../../../extensions/guard.ts");

const handlers = new Map();
const pi = {
	on: (event, handler) => {
		handlers.set(event, handler);
		return () => {};
	},
	events: { emit: () => {}, on: () => () => {} },
	registerCommand: () => {},
	registerTool: () => {},
	registerFlag: () => {},
	getFlag: () => undefined,
};

extension.default(pi);

const notices = [];
const context = {
	cwd: projectDirectory,
	hasUI: false,
	isProjectTrusted: () => false,
	ui: {
		notify: (message) => notices.push(message),
		setStatus: () => {},
		theme: { fg: (_color, text) => text },
	},
};

let sessionStartThrew = "";
try {
	await handlers.get("session_start")({}, context);
} catch (error) {
	sessionStartThrew = String(error);
}
check("session_start does not throw on a policy directory", sessionStartThrew === "", sessionStartThrew);

const blockedRead = await handlers.get("tool_call")(
	{ toolName: "read", toolCallId: "call-1", input: { path: join(homedir(), ".gnupg", "private-keys-v1.d", "x.key") } },
	context,
);

check("the guard is still armed: a denied read is blocked", blockedRead?.block === true, JSON.stringify(blockedRead));
check("the block carries a reason", typeof blockedRead?.reason === "string" && blockedRead.reason.length > 0);

// And a normal read inside the project is still allowed (the guard is armed,
// not stuck in deny-everything).
const allowedRead = await handlers.get("tool_call")(
	{ toolName: "read", toolCallId: "call-2", input: { path: join(projectDirectory, "README.md") } },
	context,
);

check("a project read is not blocked", allowedRead === undefined, JSON.stringify(allowedRead));

rmSync(scratchDirectory, { recursive: true, force: true });

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
