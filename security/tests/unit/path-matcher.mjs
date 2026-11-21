// Layer 2 path matcher — exercises the shipped `matchPattern`, not a copy.
//
// Rows marked `xfail` state the behaviour S15 will bring (a credential glob
// matches regardless of case). They count as passes while production still
// disagrees, and a normal pass once it agrees, so the marker is removed when
// S15 lands instead of being forgotten.
import { homedir } from "node:os";
import { matchPattern } from "../../../src/l2-guard/matching.ts";

const home = homedir();
const cwd = `${home}/.pi/playground`;

const cases = [
	[`${home}/.ssh/id_rsa`, "~/.ssh", true, "denyRead ~/.ssh hits child"],
	[`${home}/.ssh`, "~/.ssh", true, "denyRead ~/.ssh hits self"],
	[`${home}/.sshfoo`, "~/.ssh", false, "denyRead ~/.ssh no false-prefix"],
	[`${home}/.bashrc.test`, "~/.bashrc", false, "~/.bashrc is exact only (basename rule then catches via not-in-allowWrite)"],
	[`${home}/foo.pem`, "*.pem", true, "basename glob *.pem"],
	[`${home}/.env.local`, ".env.*", true, "basename glob .env.*"],
	[`${home}/.env`, ".env", true, "basename exact .env"],
	[`${home}/.pi/agent/extensions/foo.ts`, "~/.pi/agent/**", true, "recursive glob"],
	[`${home}/.pi/playground/foo.ts`, "~/.pi/agent/**", false, "recursive glob does not bleed"],
	[`${home}/.pi/playground/x.ts`, ".", true, ". allowWrite covers cwd descendants"],
	["/etc/passwd", ".", false, ". does not cover /etc"],
	["/private/tmp/pi-502/foo", "/private/tmp/pi-502", true, "allowWrite tmp dir"],
	["/private/tmp/something-else", "/private/tmp/pi-502", false, "allowWrite tmp dir does not bleed"],
	[`${home}/FILE.PEM`, "*.pem", true, "a credential glob ignores case (S15)", "xfail"],
	[`${home}/.ENV.local`, ".env.*", true, "an env glob ignores case (S15)", "xfail"],
	[`${home}/.SSH/id_rsa`, "~/.ssh", false, "a full absolute prefix stays case-sensitive", "strict"],
];

let pass = 0;
let fail = 0;

for (const [path, pattern, expected, label, mode] of cases) {
	const actual = matchPattern(path, pattern, cwd);
	const matches = actual === expected;
	const line = `${path} vs ${pattern} → ${actual}, exp ${expected}`;

	if (matches) {
		pass++;
		console.log(`PASS: ${label}  (${line})`);
		if (mode === "xfail") console.log(`      ${label}: expected-fail now passes — drop the xfail marker`);
		continue;
	}

	if (mode === "xfail") {
		pass++;
		console.log(`XFAIL: ${label}  (${line})`);
		continue;
	}

	fail++;
	console.log(`FAIL: ${label}  (${line})`);
}

console.log("---", `PASS=${pass}`, `FAIL=${fail}`);
process.exit(fail ? 1 : 0);
