// Layer 1 bash path candidates (ADR-045): shell structure, globs and write
// targets decide what the pre-flight inspects, not a fixed command allowlist.
import { join } from "node:path";
import {
	askReadCandidates,
	askWriteCandidates,
	commandMentionsPath,
	commandSegments,
	deniedWriteCandidates,
} from "../../../src/core/index.ts";

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => { if (cond) pass++; else { fail++; console.log("FAIL:", name, "→", extra); } };

const cwd = "/home/me/proj";
const home = "/home/me";
const filesystem = { denyRead: [], allowWrite: [".", "/tmp"], denyWrite: [], askRead: [".env"], askWrite: [".env"] };
const everything = () => true;
const reads = (command, options) => askReadCandidates(command, cwd, home, filesystem, everything, (path) => path, options);
const envPath = `${cwd}/.env`;

check("a plain read is a candidate", reads("cat .env").includes(envPath));
check("a wrapper shell is parsed", reads("sh -c 'cat .env'").includes(envPath));
check("a wrapper shell with flags is parsed", reads('bash -lc "cat .env"').includes(envPath));
check("a substitution is parsed", reads('echo "$(cat .env)"').includes(envPath));
check("a backtick substitution is parsed", reads("echo `cat .env`").includes(envPath));
check("a subshell is parsed", reads("(cat .env)").includes(envPath));
check("an operator does not hide the operand", reads("cat .env 2>&1 | head").includes(envPath));
check("an assignment prefix does not hide the command", reads("COLUMNS=80 cat .env").includes(envPath));
check("sudo is traversed", reads("sudo -u me cat .env").includes(envPath));
check("env is traversed", reads("env DEBUG=1 cat .env").includes(envPath));
check("xargs is traversed", reads("xargs cat .env").includes(envPath));

check("a copy source is a candidate", reads("cp .env /tmp/copy.txt").includes(envPath));
check("an archiver operand is a candidate", reads("tar cf out.tar .env").includes(envPath));
check("an encoder operand is a candidate", reads("base64 -w0 .env").includes(envPath));
check("an interpreter argument is a candidate", reads("node -e \"x=readFileSync('.env')\"").includes(envPath));
check("an interpreter absolute argument is a candidate", reads("python3 -c \"print(open('/home/me/proj/.env').read())\"").includes(envPath));
check("dd if= is a candidate", reads("dd if=.env bs=4096").includes(envPath));
check("a tilde path resolves", reads("cat ~/.env").includes(`${home}/.env`));

const globOptions = { expandGlob: (pattern) => (pattern.includes("*") ? [envPath] : []) };
check("a glob is expanded", reads("cat .e*", globOptions).includes(envPath));
check("an unexpanded glob is not a candidate", reads("cat .e*").length === 0);
check("a quoted glob is expanded too", reads("cat '.e*'", globOptions).includes(envPath));

const walkOptions = { listDirectory: (directory) => (directory === cwd ? [envPath] : []) };
const missing = () => false;
const walkReads = (command) =>
	askReadCandidates(command, cwd, home, filesystem, missing, (path) => path, walkOptions);
check("a recursive search over a folder is walked", walkReads("grep -r KEY .").includes(envPath));
check("a non-recursive command is not walked", walkReads("echo .").length === 0);

check("echo alone is not a read", reads("echo .env").length === 0);
check("a flag is not a path", reads("cat -- .env").includes(envPath));

const writes = (command, options) => deniedWriteCandidates(command, cwd, home, { ...filesystem, denyWrite: [".env"] }, (path) => path, options);
check("a redirect target is a write", writes("echo x > .env").includes(envPath));
check("an append target is a write", writes("echo x >> .env").includes(envPath));
check("a numbered redirect target is a write", writes("cat a 2>.env").includes(envPath));
check("a data destination is a write", writes("dd if=a of=.env").includes(envPath));
check("tee operands are writes", writes("tee .env").includes(envPath));
check("a copy destination is a write", writes("cp src.txt .env").includes(envPath));
check("a touch operand is a write", writes("touch .env").includes(envPath));
check("an in-place edit is a write", writes("sed -i s/a/b/ .env").includes(envPath));
check("a plain sed read is not a write", writes("sed -n 1p .env").length === 0);
check("reading a secret is not a write", writes("cat .env").length === 0);

const askWrites = askWriteCandidates("echo x > .env", cwd, home, { ...filesystem, denyWrite: [], askWrite: [".env"] }, (path) => path);
check("an askWrite candidate is reported", askWrites.includes(envPath));

check("a mentioned absolute path is recognised", commandMentionsPath("touch '/home/me/proj/.env'", envPath, cwd, home));
check("a mentioned relative path is recognised", commandMentionsPath("touch .env", envPath, cwd, home));
check("a mentioned bare name is recognised", commandMentionsPath("touch .env", join(cwd, "sub", ".env"), cwd, home));
check("an unrelated command mentions nothing", !commandMentionsPath("touch other.txt", envPath, cwd, home));
check("a fabricated path is not a mention", !commandMentionsPath("node -e \"run()\"", `${home}/.ssh/id_rsa`, cwd, home));

check("segments are exposed", commandSegments("cat a && cat b").length === 2);

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
