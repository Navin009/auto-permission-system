// Path normalisation parity (ADR-044): the guard and pi's tools must agree on
// what a spelled path means, or a `~`/`@`/`file://` spelling walks past a rule.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeUserPath } from "../../../src/core/index.ts";
import { canonicalize } from "../../../src/shared/canonicalize.ts";
import { isDeniedRead, isDeniedWrite } from "../../../src/l2-guard/matching.ts";

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => { if (cond) pass++; else { fail++; console.log("FAIL:", name, "→", extra); } };

const home = "/home/me";
check("tilde expands to home", normalizeUserPath("~", home) === home);
check("tilde path expands", normalizeUserPath("~/.ssh/id_rsa", home) === `${home}/.ssh/id_rsa`);
check("at prefix is dropped", normalizeUserPath("@/etc/passwd", home) === "/etc/passwd");
check("file url becomes a path", normalizeUserPath("file:///etc/passwd", home) === "/etc/passwd");
check("unicode space folds", normalizeUserPath("/tmp/a\u00A0b", home) === "/tmp/a b");
check("plain relative path is untouched", normalizeUserPath("src/app.ts", home) === "src/app.ts");

const cwd = mkdtempSync(join(tmpdir(), "aps-pathnorm-cwd-"));
const outside = mkdtempSync(join(tmpdir(), "aps-pathnorm-out-"));
const secret = join(outside, "config.json");
writeFileSync(secret, '{"k":"v"}\n');
mkdirSync(join(cwd, "sub"), { recursive: true });
writeFileSync(join(cwd, "sub", "note.txt"), "x\n");
symlinkSync(secret, join(cwd, "linked.json"));

const expandedHome = homedir();
const spellings = [
	secret,
	`file://${secret}`,
	`@${secret}`,
	`${cwd}/../${outside.split("/").pop()}/config.json`,
];
check(
	"every spelling canonicalizes to one path",
	new Set(spellings.map((spelling) => canonicalize(spelling, cwd))).size === 1,
	spellings.map((spelling) => canonicalize(spelling, cwd)).join(" | "),
);
check("a tilde path is not silently anchored at cwd", canonicalize("~/probe.txt", cwd) === `${expandedHome}/probe.txt`);
check("a symlink resolves to its target", canonicalize("linked.json", cwd) === canonicalize(secret, cwd));

const policy = {
	enabled: true,
	mode: "advanced-secure",
	network: { allowedDomains: [], deniedDomains: [] },
	filesystem: {
		denyRead: ["~/.ssh"],
		allowWrite: [".", "/tmp"],
		denyWrite: [],
		askRead: [".env", "*.pem"],
	},
};

check("read ~/.ssh/config is denied via the tilde spelling", isDeniedRead("~/.ssh/config", cwd, policy) !== null);
check("read the same path spelled absolutely is denied", isDeniedRead(`${expandedHome}/.ssh/config`, cwd, policy) !== null);
check("read @/home/me/.ssh/config is denied via the at spelling", isDeniedRead(`@${expandedHome}/.ssh/config`, cwd, policy) !== null);
check("read file:///home/me/.aws/config is denied via the url spelling", isDeniedRead(`file://${expandedHome}/.aws/config`, cwd, policy) !== null);
check("write ~/.bashrc needs permission", isDeniedWrite("~/.bashrc", cwd, policy) !== null);
check("write @/home/me/.bashrc needs permission", isDeniedWrite(`@${expandedHome}/.bashrc`, cwd, policy) !== null);
check("write file:///home/me/.bashrc needs permission", isDeniedWrite(`file://${expandedHome}/.bashrc`, cwd, policy) !== null);
check("write ~/.ssh/authorized_keys is denied", isDeniedWrite("~/.ssh/authorized_keys", cwd, policy) !== null);
check("a path inside the project still writes freely", isDeniedWrite("src/app.ts", cwd, policy) === null);

rmSync(cwd, { recursive: true, force: true });
rmSync(outside, { recursive: true, force: true });

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
