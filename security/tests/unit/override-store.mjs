// Persisted ask-tier overrides (ADR-007): both layers write the same policy
// file through src/core/policy/overrides.ts, so the shared writer must preserve
// hand-written keys and sibling grant kinds, stay idempotent, refuse an
// unparseable file, and keep a trusted project file trusted after its own grant.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { addOverride, addProjectOverride } = await import("../../../src/core/policy/overrides.ts");
const { createProjectTrust, isProjectFileTrusted } = await import("../../../src/core/trust.ts");

let pass = 0;
let fail = 0;
const check = (name, cond, extra = "") => {
	if (cond) pass++;
	else {
		fail++;
		console.log("FAIL:", name, extra);
	}
};

const root = mkdtempSync(join(tmpdir(), "aps-override-"));
const policyPath = join(root, "nested", "sandbox.json");
const projectPath = join(root, "project", ".pi", "sandbox.json");
const storePath = join(root, "extensions", "sandbox.trust.json");
const read = (path) => JSON.parse(readFileSync(path, "utf8"));

// --- addOverride: create, append, preserve ---------------------------------
const written = addOverride(policyPath, "allowWrite", "/opt/tool-a");
check("addOverride returns the path it wrote", written === policyPath);
check("addOverride creates the parent directory", read(policyPath).overrides.allowWrite.includes("/opt/tool-a"));

addOverride(policyPath, "allowWrite", "/opt/tool-b");
addOverride(policyPath, "allowDomains", "*.example.com");
const preserved = read(policyPath);
check("addOverride appends a second value", preserved.overrides.allowWrite.join(",") === "/opt/tool-a,/opt/tool-b");
check("addOverride keeps a sibling grant kind", preserved.overrides.allowDomains.join(",") === "*.example.com");

// --- addOverride: idempotent and non-destructive ---------------------------
addOverride(policyPath, "allowWrite", "/opt/tool-a");
check("addOverride does not duplicate a value", read(policyPath).overrides.allowWrite.filter((v) => v === "/opt/tool-a").length === 1);

const handWritten = { mode: "default", filesystem: { denyRead: ["/etc"] }, overrides: { allowRead: ["/tmp/x"] } };
writeFileSync(policyPath, `${JSON.stringify(handWritten, null, 2)}\n`);
addOverride(policyPath, "allowWrite", "/opt/tool-c");
const merged = read(policyPath);
check("addOverride preserves hand-written top-level keys", merged.mode === "default" && merged.filesystem.denyRead[0] === "/etc");
check("addOverride preserves an existing override kind", merged.overrides.allowRead[0] === "/tmp/x");
check("addOverride adds the new kind next to it", merged.overrides.allowWrite[0] === "/opt/tool-c");

// --- addOverride: refuse an unparseable file -------------------------------
writeFileSync(policyPath, "{ this is not json");
let threw = false;
try {
	addOverride(policyPath, "allowWrite", "/opt/tool-d");
} catch {
	threw = true;
}
check("addOverride refuses an unparseable file", threw);
check("addOverride left the unparseable file untouched", readFileSync(policyPath, "utf8") === "{ this is not json");

// --- addProjectOverride: write + record trust ------------------------------
addProjectOverride(projectPath, storePath, "allowWrite", "/opt/tool-e");
check("addProjectOverride writes the project file", read(projectPath).overrides.allowWrite[0] === "/opt/tool-e");
check("addProjectOverride records trust for the new content", isProjectFileTrusted(projectPath, storePath) === true);

addProjectOverride(projectPath, storePath, "allowDomains", "*.example.org");
const project = read(projectPath);
check("addProjectOverride keeps the earlier kind", project.overrides.allowWrite[0] === "/opt/tool-e");
check("addProjectOverride keeps trust after a second write", isProjectFileTrusted(projectPath, storePath) === true);

// --- createProjectTrust ----------------------------------------------------
const trust = createProjectTrust(storePath);
check("createProjectTrust trusts an absent file", trust.isTrusted(join(root, "empty-project")) === true);
check("createProjectTrust trusts a matching hash", trust.isTrusted(join(root, "project")) === true);
trust.setDeclined(true);
check("createProjectTrust refuses when pi declined", trust.isTrusted(join(root, "project")) === false);
trust.setDeclined(false);
addOverride(projectPath, "allowWrite", "/opt/tool-f");
check("createProjectTrust refuses after the file changes", trust.isTrusted(join(root, "project")) === false);

rmSync(root, { recursive: true, force: true });
console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
