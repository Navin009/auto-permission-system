// Layer 1 filesystem session grants (ADR-010, ADR-012): a session pick on the
// write/read prompt re-runs the blocked command, the grant covers later commands
// without re-prompting, askRead session grants are remembered, and
// session_start clears them.
//
// Runs `createSandboxedBashOps().exec` with a stubbed SandboxManager so the
// block/re-run/prompt flow is exercised without bubblewrap.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
const freshDir = mkdtempSync(join(tmpdir(), "aps-session-fresh-"));
const target = join(outside, "blocked.txt");
const envFile = join(cwd, ".env");
writeFileSync(envFile, "SECRET=1\n");

// Stub the sandbox: the first wrapped command reports the OS write fence (the
// shape bubblewrap prints), later ones succeed and record the customConfig.
const customConfigs = [];
let callCount = 0;
let rememberProbeFenced = false;
let symlinkProbeFenced = false;
// Paths the probe commands report as fenced; set by the tests that use them.
let symlinkFencePath = "";
let denyFencePath = "";
let stubbornFencePath = "";
let bwrapFencePath = "";
const fence = (p) => `printf '%s\\n' "touch: cannot touch '${p}': Read-only file system" >&2; exit 1`;
SandboxManager.wrapWithSandbox = async (command, _argv, custom) => {
	callCount++;
	customConfigs.push(custom);
	const text = String(command);
	if (text.includes("STUBBORN-PROBE")) return fence(stubbornFencePath);
	if (text.includes("BWRAP-PROBE")) return `printf '%s\\n' "bwrap: Can't create file ${bwrapFencePath}: Read-only file system" >&2; exit 1`;
	if (text.includes("DENY-PROBE")) return fence(denyFencePath);
	if (text.includes("SYMLINK-PROBE")) {
		if (!symlinkProbeFenced) {
			symlinkProbeFenced = true;
			return fence(symlinkFencePath);
		}
		return "printf 'RERUN-OK\\n'";
	}
	if (callCount === 1 || text.includes("FORCE-FENCE") || (text.includes("REMEMBER-PROBE") && !rememberProbeFenced)) {
		if (text.includes("REMEMBER-PROBE")) rememberProbeFenced = true;
		return fence(target);
	}
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
check("session pick hides the stale block hint", !out1.join("").includes("filesystem access blocked") && !out1.join("").includes("Waiting for your decision"), out1.join(""));
check("session pick states the outcome, not a retry", out1.join("").includes("Command output with the new permission follows") && !/retry the bash command|re-running the command/i.test(out1.join("")), out1.join(""));
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

// --- a policy write from the other layer is visible on the next command -----
{
	const globalDir = join(agentDir, "extensions");
	mkdirSync(globalDir, { recursive: true });
	writeFileSync(join(globalDir, "sandbox.json"), JSON.stringify({ overrides: { allowWrite: [freshDir] } }));
	const before = customConfigs.length;
	r = await run("true");
	const fresh = customConfigs[before];
	check("next command re-reads a policy written after init", allowWriteOf(fresh).some((p) => p.includes(freshDir)), JSON.stringify(fresh));
}

// --- an explicit No is audited with a note, never a bare "no" --------------
{
	const noCtx = { cwd, hasUI: true, ui: { select: async (_title, options) => options[0], notify: () => {} } };
	const noOutput = [];
	const execNo = createSandboxedBashOps({ ctx: noCtx, onAlways, onAlwaysRead: onAlways });
	r = await execNo.exec("touch FORCE-FENCE", cwd, { onData: (chunk) => noOutput.push(chunk.toString()), signal: undefined, timeout: 10 });
	const auditAfterNo = readFileSync(join(agentDir, "audit.log"), "utf8");
	check("explicit No audited with a note", auditAfterNo.includes('"decision":"no"') && auditAfterNo.includes('"note":"user-denied"'), auditAfterNo);
	check("denied command still explains the block", noOutput.join("").includes("filesystem access blocked"), noOutput.join(""));
}

// --- remember: persist and re-run, like once and session -------------------
{
	const rememberCtx = { cwd, hasUI: true, ui: { select: async (_title, options) => options.find((option) => option === "Yes, always\u2026") ?? options[0], notify: () => {} } };
	const persisted = [];
	const execRemember = createSandboxedBashOps({
		ctx: rememberCtx,
		onAlways: async (absPath, scope) => {
			persisted.push([absPath, scope]);
			return "/tmp/sandbox.json";
		},
		onAlwaysRead: async (absPath, scope) => {
			persisted.push([absPath, scope]);
			return "/tmp/sandbox.json";
		},
	});
	const output = [];
	r = await execRemember.exec("touch REMEMBER-PROBE", cwd, { onData: (chunk) => output.push(chunk.toString()), signal: undefined, timeout: 10 });
	check("remember re-runs the command", r.exitCode === 0, `exit=${r.exitCode}`);
	check("remember persisted one grant", persisted.length === 1, JSON.stringify(persisted));
	check("remember announces the outcome, not a retry", output.join("").includes("Command output with the new permission follows") && !/retry the bash command|re-running the command/i.test(output.join("")), output.join(""));
	check("remember hides the stale block hint", !output.join("").includes("filesystem access blocked"), output.join(""));
}

// --- a path the OS reports through a symlink is granted at its canonical
// target (ADR-035): sandbox-runtime silently skips a write root whose realpath
// escapes the spelling, so a spelled grant re-runs into the same fence. ---
{
	const real = mkdtempSync(join(tmpdir(), "aps-session-real-"));
	const link = join(cwd, "linked");
	try { rmSync(link, { force: true }); } catch { /* absent */ }
	symlinkSync(real, link);
	symlinkFencePath = join(link, "file.txt");
	const symlinkCtx = { cwd, hasUI: true, ui: { select: async (_title, options) => options.find((o) => o === "Yes, for this session"), notify: () => {} } };
	const execSymlink = createSandboxedBashOps({ ctx: symlinkCtx, onAlways, onAlwaysRead: onAlways });
	const before = customConfigs.length;
	const symlinkOut = [];
	r = await execSymlink.exec("touch SYMLINK-PROBE", cwd, { onData: (chunk) => symlinkOut.push(chunk.toString()), signal: undefined, timeout: 10 });
	check("symlinked write re-runs after the session grant", r.exitCode === 0, `exit=${r.exitCode}`);
	const granted = allowWriteOf(customConfigs[before + 1]);
	check("symlinked write grant is the canonical target", granted.includes(real), JSON.stringify(granted));
	check("symlinked write grant is not the link spelling", !granted.includes(link), JSON.stringify(granted));
	check("symlinked write prompt shows Path + Link", symlinkOut.join("").includes("Command output with the new permission follows"), symlinkOut.join(""));
	rmSync(link, { force: true });
	rmSync(real, { recursive: true, force: true });
}

// --- denyWrite beats allowWrite, so it must be hard-denied, never offered as a
// grant (ADR-035): otherwise once/session/remember all re-run into the fence. ---
{
	denyFencePath = join(outside, "secret.pem");
	// The shipped default has no denyWrite; add one so the hard tier is exercised.
	writeFileSync(join(agentDir, "extensions", "sandbox.json"), JSON.stringify({ filesystem: { denyWrite: ["*.pem"] } }));
	let prompted = 0;
	const denyCtx = { cwd, hasUI: true, ui: { select: async () => { prompted++; return undefined; }, notify: () => {} } };
	const denyOut = [];
	const execDeny = createSandboxedBashOps({ ctx: denyCtx, onAlways, onAlwaysRead: onAlways });
	r = await execDeny.exec("touch DENY-PROBE", cwd, { onData: (chunk) => denyOut.push(chunk.toString()), signal: undefined, timeout: 10 });
	check("denyWrite path is not offered a grant", prompted === 0, `prompts=${prompted}`);
	check("denyWrite path reports the policy reason", denyOut.join("").includes('denyWrite matched "*.pem"'), denyOut.join(""));
	check("denyWrite path is audited as write-denied", readFileSync(join(agentDir, "audit.log"), "utf8").includes('"decision":"write-denied"'));
}

// --- a grant that does not take effect is not re-prompted (ADR-035): the
// re-run hits the same fence, so asking again can only loop. ---
{
	stubbornFencePath = join(outside, "stubborn.txt");
	let prompted = 0;
	const stubbornCtx = { cwd, hasUI: true, ui: { select: async (_title, options) => { prompted++; return options.find((o) => o === "Yes, for this session"); }, notify: () => {} } };
	const stubbornOut = [];
	const execStubborn = createSandboxedBashOps({ ctx: stubbornCtx, onAlways, onAlwaysRead: onAlways });
	r = await execStubborn.exec("touch STUBBORN-PROBE", cwd, { onData: (chunk) => stubbornOut.push(chunk.toString()), signal: undefined, timeout: 10 });
	check("an ineffective grant prompts exactly once", prompted === 1, `prompts=${prompted}`);
	check("an ineffective grant reports the block instead of looping", stubbornOut.join("").includes("did not take effect"), stubbornOut.join(""));
	check("an ineffective grant is audited", readFileSync(join(agentDir, "audit.log"), "utf8").includes('"note":"grant-ineffective"'));
}

// --- a bwrap mount-setup failure is not a policy denial: the path is INSIDE
// the project, so no allowWrite grant can help. It must not prompt with a
// misleading reason ("outside your project" / "not under an allowWrite root").
{
	bwrapFencePath = join(cwd, ".claude", "agents");
	let prompted = 0;
	const bwrapCtx = { cwd, hasUI: true, ui: { select: async () => { prompted++; return undefined; }, notify: () => {} } };
	const bwrapOut = [];
	const execBwrap = createSandboxedBashOps({ ctx: bwrapCtx, onAlways, onAlwaysRead: onAlways });
	r = await execBwrap.exec("ls BWRAP-PROBE", cwd, { onData: (chunk) => bwrapOut.push(chunk.toString()), signal: undefined, timeout: 10 });
	check("bwrap setup failure is not offered a grant", prompted === 0, `prompts=${prompted}`);
	check("bwrap setup failure reports a setup problem", bwrapOut.join("").includes("sandbox could not start"), bwrapOut.join(""));
	check("bwrap setup failure hides the misleading allowWrite hint", !bwrapOut.join("").includes("not under an allowWrite root"), bwrapOut.join(""));
	check("bwrap setup failure is audited", readFileSync(join(agentDir, "audit.log"), "utf8").includes('"note":"sandbox-setup-error"'));
}

// --- session_start clears the grants -------------------------------------
clearFilesystemSessionGrants();
check("clearFilesystemSessionGrants clears the summary", filesystemSessionGrantSummary() === "", filesystemSessionGrantSummary());

rmSync(cwd, { recursive: true, force: true });
rmSync(outside, { recursive: true, force: true });
rmSync(freshDir, { recursive: true, force: true });
rmSync(agentDir, { recursive: true, force: true });

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
