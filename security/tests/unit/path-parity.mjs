// One pattern matcher for both layers: the same table through Layer 1's entry
// point and Layer 2's must agree, including the `@` and `file://` spellings
// that used to expand in only one of them.
import { homedir } from "node:os";
import { matchesPolicyPattern } from "../../../src/core/index.ts";
import { matchPattern } from "../../../src/l2-guard/matching.ts";

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
const cwd = `${home}/parity-project`;
const cases = [
	[`${home}/.secrets/x`, `${home}/.secrets`, true],
	[`${home}/.secrets/x`, `@${home}/.secrets`, true],
	[`${home}/.secrets/x`, `file://${home}/.secrets`, true],
	[`${home}/.secrets/x`, `~/.secrets`, true],
	[`${home}/.secrets/x`, "~/.ssh", false],
	[`${home}/foo.pem`, "*.pem", true],
	[`${home}/.env.local`, ".env.*", true],
	[`${home}/.env`, ".env", true],
	[`${home}/.env`, "*.pem", false],
	[`${home}/.pi/agent/extensions/a.ts`, "~/.pi/agent/**", true],
	[`${home}/.pi/other/a.ts`, "~/.pi/agent/**", false],
	[`${cwd}/src/a.ts`, ".", true],
	[`${cwd}/src/a.ts`, `.`, true],
	["/etc/passwd", ".", false],
	["/private/tmp/x/y", "/private/tmp/x", true],
	["/private/tmp/z/y", "/private/tmp/x", false],
];

for (const [absolutePath, pattern, expected] of cases) {
	const layer1 = matchesPolicyPattern(absolutePath, pattern, cwd, home);
	const layer2 = matchPattern(absolutePath, pattern, cwd);

	check(`both layers agree on ${pattern}`, layer1 === layer2, `L1=${layer1} L2=${layer2}`);
	check(`${pattern} matches the expectation`, layer2 === expected, `got ${layer2}, expected ${expected}`);
}

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
