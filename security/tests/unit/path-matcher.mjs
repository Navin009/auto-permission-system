// Layer 2 path matcher — exercises the shipped `matchPattern`, not a copy.
import { homedir } from "node:os";
import { matchPattern } from "#l2-guard/matching.ts";

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
	[`${home}/FILE.PEM`, "*.pem", true, "a credential glob ignores case"],
	[`${home}/.ENV.local`, ".env.*", true, "an env glob ignores case"],
	[`${home}/.SSH/id_rsa`, "~/.ssh", false, "a full absolute prefix stays case-sensitive"],
];

let pass = 0;
let fail = 0;

for (const [path, pattern, expected, label] of cases) {
	const actual = matchPattern(path, pattern, cwd);

	if (actual === expected) {
		pass++;
		console.log(`PASS: ${label}  (${path} vs ${pattern} → ${actual})`);
		continue;
	}

	fail++;
	console.log(`FAIL: ${label}  (${path} vs ${pattern} → ${actual}, exp ${expected})`);
}

console.log("---", `PASS=${pass}`, `FAIL=${fail}`);
process.exit(fail ? 1 : 0);
