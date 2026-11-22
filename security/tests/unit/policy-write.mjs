import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addOverride } from "../../../src/core/policy/overrides.ts";
import { readPolicyForUpdate, setPolicyMode, writePolicyFile } from "../../../src/core/policy/policy-file.ts";

let pass = 0;
let fail = 0;
const check = (name, condition, extra = "") => {
	if (condition) pass++;
	else {
		fail++;
		console.log("FAIL:", name, "→", extra);
	}
};

const directory = mkdtempSync(join(tmpdir(), "pi-policy-write-"));
const policyPath = join(directory, ".pi", "sandbox.json");

addOverride(policyPath, "allowWrite", "/first");
addOverride(policyPath, "allowDomains", "example.com");

const afterTwoWrites = JSON.parse(readFileSync(policyPath, "utf-8"));

check("the first write survives the second", afterTwoWrites.overrides.allowWrite.includes("/first"));
check("the second write lands", afterTwoWrites.overrides.allowDomains.includes("example.com"));
check("no temp file is left behind", !existsSync(`${policyPath}.tmp`));

setPolicyMode(policyPath, "advanced-secure");
const afterMode = JSON.parse(readFileSync(policyPath, "utf-8"));

check("a mode write keeps the grants", afterMode.overrides.allowWrite.includes("/first"));
check("a mode write lands", afterMode.mode === "advanced-secure");

writeFileSync(`${policyPath}.tmp`, "left over from a previous crash");

addOverride(policyPath, "allowRead", "/second");
const afterStaleTemp = JSON.parse(readFileSync(policyPath, "utf-8"));

check("a stale temp file does not break the next write", afterStaleTemp.overrides.allowRead.includes("/second"));
check("a stale temp file is replaced", !existsSync(`${policyPath}.tmp`));

writePolicyFile(policyPath, { mode: "default", overrides: { allowWrite: [], allowRead: [], allowDomains: [] } });

check("a direct write replaces the whole document", readPolicyForUpdate(policyPath).mode === "default");
check("a direct write leaves valid JSON", typeof readPolicyForUpdate(policyPath) === "object");

rmSync(directory, { recursive: true, force: true });

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
