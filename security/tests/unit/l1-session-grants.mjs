// Layer 1 filesystem session grants (ADR-010, ADR-012): a session pick on the
// write/read prompt re-runs the blocked command, the grant covers later commands
// without re-prompting, askRead session grants are remembered, and
// session_start clears them.
//
// Runs `createSandboxedBashOps().exec` with a stubbed SandboxManager so the
// block/re-run/prompt flow is exercised without bubblewrap.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point pi's agent dir at a scratch dir BEFORE importing the sources: audit.ts
// captures AUDIT_PATH at import time, so the test never touches the real log.
const agentDir = mkdtempSync(join(tmpdir(), "aps-session-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");
const { clearFilesystemSessionGrants, createSandboxedBashOps, filesystemSessionGrantSummary } = await import("../../../src/l1-sandbox/bash-ops.ts");

let pass = 0;
let fail = 0;
const check = (name, cond, extra = "") => {
	if (cond) pass++;
	else {
		fail++;
		console.log("FAIL:", name, extra);
	}
};

const cwd = mkdtempSync(join(tmpdir(), "aps-session-cwd-"));
const outside = mkdtempSync(join(tmpdir(), "aps-session-out-"));
const target = join(outside, "blocked.txt");
const envFile = join(cwd, ".env");
writeFileSync(envFile, "SECRET=1\n");

// Stub the sandbox: the first wrapped command reports the OS write fence (the
// shape bubblewrap prints), later ones succeed and record the customConfig.
const customConfigs = [];
let callCount = 0;
SandboxManager.wrapWithSandbox = async (_command, _argv, custom) => {
	callCount++;
	customConfigs.push(custom);
	if (callCount === 1) return `printf '%s\\n' "touch: cannot touch '${target}': Read-only file system" >&2; exit 1`;
	return "printf 'RERUN-OK\\n'";
};
SandboxManager.cleanupAfterCommand = () => {};

const prompts = [];
const ctx = {
	cwd,
	hasUI: true,
	ui: {
		select: async (_title, options) => {
			prompts.push(options);
			return options.find((o) => o === "Yes, for this session");
		},
		notify: () => {},
	},
};
const onAlways = async () => {
	throw new Error("session grants must never persist");
};
const exec = createSandboxedBashOps({ ctx, onAlways, onAlwaysRead: onAlways });
const run = (command) => exec.exec(command, cwd, { onData: () => {}, signal: undefined, timeout: 10 });
const allowWriteOf = (custom) => custom?.filesystem?.allowWrite ?? [];
const allowReadOf = (custom) => custom?.filesystem?.allowRead ?? [];

// --- write: session pick re-runs and the grant survives the next command ---
const out1 = [];
const execOut = createSandboxedBashOps({ ctx, onAlways, onAlwaysRead: onAlways });
let r = await execOut.exec(`touch '${target}'`, cwd, { onData: (c) => out1.push(c.toString()), signal: undefined, timeout: 10 });
check("session write re-runs the command", r.exitCode === 0, `exit=${r.exitCode}`);
check("write prompt offered the session option", prompts[0]?.includes("Yes, for this session"));
check("no 'user denied' line on a session pick", !out1.join("").includes("user denied"), out1.join(""));
check("session grant announced", out1.join("").includes("for this session"), out1.join(""));
check("write grant is the parent folder", filesystemSessionGrantSummary().includes(`write:${outside}`), filesystemSessionGrantSummary());
check("re-run exposes the granted folder to allowWrite", allowWriteOf(customConfigs[1]).some((p) => p.includes(outside)), JSON.stringify(customConfigs[1]));

const promptsBefore = prompts.length;
const configsBefore = customConfigs.length;
r = await run(`touch '${target}'`);
check("later command does not re-prompt", prompts.length === promptsBefore, `${prompts.length} vs ${promptsBefore}`);
check("later command carries the session grant", allowWriteOf(customConfigs[configsBefore]).some((p) => p.includes(outside)), JSON.stringify(customConfigs[configsBefore]));
check("later command succeeds", r.exitCode === 0, `exit=${r.exitCode}`);

// --- askRead: session pick is remembered (not re-asked) -------------------
const promptsBeforeAsk = prompts.length;
r = await run("cat .env");
check("askRead prompt offered the session option", prompts[promptsBeforeAsk]?.includes("Yes, for this session"));
check("askRead session grant recorded", filesystemSessionGrantSummary().includes(`askRead:${envFile}`), filesystemSessionGrantSummary());
const promptsBeforeAsk2 = prompts.length;
r = await run("cat .env");
check("askRead is not re-asked in the session", prompts.length === promptsBeforeAsk2, `${prompts.length} vs ${promptsBeforeAsk2}`);
check("askRead session grant never leaks into allowRead", !allowReadOf(customConfigs[customConfigs.length - 1]).includes(envFile));

// --- audit log carries the decision, not a silent "no" --------------------
const auditLog = readFileSync(join(agentDir, "audit.log"), "utf8");
check("write session grant audited", auditLog.includes('"decision":"session"') && auditLog.includes('"note":"write-session"'), auditLog);
check("askRead session grant audited", auditLog.includes('"decision":"session"') && auditLog.includes('"note":"ask-read"'), auditLog);

// --- session_start clears the grants -------------------------------------
clearFilesystemSessionGrants();
check("clearFilesystemSessionGrants clears the summary", filesystemSessionGrantSummary() === "", filesystemSessionGrantSummary());

rmSync(cwd, { recursive: true, force: true });
rmSync(outside, { recursive: true, force: true });
rmSync(agentDir, { recursive: true, force: true });

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
