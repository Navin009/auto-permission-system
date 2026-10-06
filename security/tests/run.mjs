/**
 * Runs every unit + contract test in this directory. This is the single entry
 * point behind `npm test`; adding a test file needs no other change. The manual
 * e2e suite is not included (run it with APS_E2E=1).
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const loader = join(here, "ts-loader.mjs");

const files = ["unit", "contract"]
	.flatMap((dir) => readdirSync(join(here, dir)).filter((f) => f.endsWith(".mjs")).map((f) => join(dir, f)))
	.sort();

let passed = 0;
const failed = [];

for (const rel of files) {
	const file = join(here, rel);
	const r = spawnSync(process.execPath, ["--import", loader, file], { encoding: "utf8" });
	const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
	if (r.status === 0) {
		passed++;
		const summary = out.split("\n").filter((l) => l.includes("PASS=")).pop() ?? "";
		console.log(`PASS  ${relative(repo, file)}  ${summary}`);
	} else {
		failed.push(rel);
		console.log(`FAIL  ${relative(repo, file)}`);
		console.log(out);
	}
}

console.log(`\n${passed}/${files.length} test files passed`);
if (failed.length) {
	console.log(`failed: ${failed.join(", ")}`);
	process.exit(1);
}
