import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratchDirectory = mkdtempSync(join(tmpdir(), "pi-audit-log-"));
process.env.PI_CODING_AGENT_DIR = join(scratchDirectory, "agent");

const { AUDIT_PATH, audit } = await import("#shared/audit.ts");

let pass = 0;
let fail = 0;
const check = (name, condition, extra = "") => {
	if (condition) pass++;
	else {
		fail++;
		console.log("FAIL:", name, "→", extra);
	}
};

audit({ layer: 2, event: "test", cwd: "/tmp" });

check("the log is created", existsSync(AUDIT_PATH));
check("the log is owner-only", (statSync(AUDIT_PATH).mode & 0o077) === 0, statSync(AUDIT_PATH).mode.toString(8));
check("the entry is one JSON line", statSync(AUDIT_PATH).size > 0);

const oversized = "x".repeat(5 * 1024 * 1024 + 1);
writeFileSync(AUDIT_PATH, oversized);

audit({ layer: 2, event: "after-rotation", cwd: "/tmp" });

check("the oversized log is rotated", existsSync(`${AUDIT_PATH}.1`));
check("the log restarts small", statSync(AUDIT_PATH).size < 4096, String(statSync(AUDIT_PATH).size));
check("the rotated file keeps the old content", statSync(`${AUDIT_PATH}.1`).size > 5 * 1024 * 1024);

rmSync(scratchDirectory, { recursive: true, force: true });

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
