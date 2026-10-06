// Layer 1 sandbox end-to-end (MANUAL / opt-in).
//
// `SandboxManager.initialize()` starts the network bridge and can take a while;
// it is deliberately not part of `security/check.sh`. Run it yourself:
//
//   APS_E2E=1 node security/tests/e2e/sandbox-fs.mjs
//
// Needs bubblewrap + socat (Linux) or sandbox-exec (macOS), and ripgrep.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SandboxManager } from "@anthropic-ai/sandbox-runtime";

const TIMEOUT_MS = 90_000;

if (process.env.APS_E2E !== "1") {
	console.log("SKIP: set APS_E2E=1 to run the Layer 1 sandbox end-to-end test");
	console.log("PASS=0, FAIL=0");
	process.exit(0);
}

let pass = 0;
let fail = 0;
const check = (name, cond, extra = "") => {
	if (cond) pass++;
	else {
		fail++;
		console.log("FAIL:", name, extra);
	}
};

const withTimeout = (p, ms) =>
	Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms))]);

const dir = mkdtempSync(join(tmpdir(), "aps-e2e-"));
const secret = join(dir, "secret.txt");
const visible = join(dir, "visible.txt");
writeFileSync(secret, "TOPSECRET-DO-NOT-LEAK\n");
writeFileSync(visible, "VISIBLE-OK\n");

/** Run an already-wrapped shell command; never throws. */
const run = (cmd) => {
	try {
		return execFileSync("bash", ["-c", cmd], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	} catch (e) {
		return `${e.stdout ?? ""}${e.stderr ?? ""}`;
	}
};

try {
	await withTimeout(
		SandboxManager.initialize({
			network: { allowedDomains: [], deniedDomains: [] },
			filesystem: {
				denyRead: [secret],
				allowRead: [],
				allowWrite: [dir],
				denyWrite: [],
			},
		}),
		TIMEOUT_MS,
	);

	// A denied file is masked: its content must never reach the output.
	const denied = run(await SandboxManager.wrapWithSandbox(`cat '${secret}'`));
	check("denied file content is not leaked", !denied.includes("TOPSECRET"), `out=${JSON.stringify(denied)}`);

	// An allowed file still works, so the sandbox isn't just blocking everything.
	const allowed = run(await SandboxManager.wrapWithSandbox(`cat '${visible}'`));
	check("allowed file is readable", allowed.includes("VISIBLE-OK"), `out=${JSON.stringify(allowed)}`);

	await SandboxManager.reset();
	console.log(`PASS=${pass}, FAIL=${fail}`);
	process.exit(fail ? 1 : 0);
} catch (e) {
	console.log(`E2E could not run: ${e instanceof Error ? e.message : e}`);
	console.log("PASS=0, FAIL=1");
	process.exit(1);
} finally {
	rmSync(dir, { recursive: true, force: true });
}
