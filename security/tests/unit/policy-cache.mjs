// The loaders read the policy on every tool event, so the parse is cached by
// mtime and size. A hit must return the same document, and a write must be
// visible immediately rather than after the mtime granularity.
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPolicy, writePolicyFile } from "../../../src/core/policy/policy-file.ts";

let pass = 0;
let fail = 0;
const check = (name, condition, extra = "") => {
	if (condition) pass++;
	else {
		fail++;
		console.log("FAIL:", name, "→", extra);
	}
};

const directory = mkdtempSync(join(tmpdir(), "pi-policy-cache-"));
const policyPath = join(directory, "sandbox.json");

check("an absent policy is null", readPolicy(policyPath) === null);

writeFileSync(policyPath, JSON.stringify({ mode: "default", marker: "first" }));

const firstRead = readPolicy(policyPath);
const secondRead = readPolicy(policyPath);

check("a present policy parses", firstRead?.marker === "first", JSON.stringify(firstRead));
check("a repeat read is served from the cache", firstRead === secondRead);

writeFileSync(policyPath, JSON.stringify({ mode: "default", marker: "second" }));
utimesSync(policyPath, new Date(), new Date(Date.now() + 5000));

const afterEdit = readPolicy(policyPath);

check("an edited policy is re-read", afterEdit?.marker === "second", JSON.stringify(afterEdit));
check("a re-read is a different document", afterEdit !== firstRead);

writePolicyFile(policyPath, { mode: "advanced-secure", marker: "written" });

const afterWrite = readPolicy(policyPath);

check("a writer is visible immediately", afterWrite?.marker === "written", JSON.stringify(afterWrite));
check("the writer keeps the object it wrote", afterWrite?.mode === "advanced-secure");

writeFileSync(policyPath, "{ not json");
utimesSync(policyPath, new Date(), new Date(Date.now() + 10000));

check("an unparseable policy is null", readPolicy(policyPath) === null);

rmSync(directory, { recursive: true, force: true });

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
