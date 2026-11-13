// Read/write posture over the existing schema (ADR-047): writes are wide,
// critical files ask, credential stores ask as folders, an explicit allow wins.
import { homedir } from "node:os";
import { dirname } from "node:path";
import {
	askReadCandidates,
	askWriteCandidates,
	deniedWriteCandidates,
	isSafeFolderGrant,
	isSessionFolderGrant,
} from "../../../src/core/index.ts";
import { isAskRead, isDeniedRead, isDeniedWrite } from "../../../src/l2-guard/matching.ts";

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => { if (cond) pass++; else { fail++; console.log("FAIL:", name, "→", extra); } };

const home = homedir();
const cwd = `${home}/proj`;

const awsConfig = `${home}/.aws/config`;
const awsCredentials = `${home}/.aws/credentials`;
const awsBackup = `${home}/.aws-backup/notes.txt`;
const gcloudCredentials = `${home}/.config/gcloud/creds.db`;
const sshAuthorizedKeys = `${home}/.ssh/authorized_keys`;
const bashrc = `${home}/.bashrc`;
const projectEnv = `${cwd}/.env`;
const vendorCredentials = `${home}/.any-vendor/creds.json`;
const composioState = `${home}/.composio/state.json`;

const filesystem = (overrides = {}) => ({
	denyRead: [],
	allowWrite: [".", "/tmp", "~"],
	denyWrite: [],
	...overrides,
});

const policy = (overrides = {}) => ({
	enabled: true,
	mode: "advanced-secure",
	network: { allowedDomains: [], deniedDomains: [] },
	filesystem: filesystem(overrides),
});

const wide = policy({ denyWrite: ["~/.ssh"], askWrite: [".env", "~/.bashrc"], askRead: ["~/.aws"] });
const writeVerdict = (path, overrides) => isDeniedWrite(path, cwd, policy(overrides)) ?? "";

const askWhenWritingBashrc = { askWrite: ["~/.bashrc"] };

check("a home file is writable when home is allowed", writeVerdict(`${home}/notes.txt`, { denyWrite: ["~/.ssh"] }) === "");
check("a project file is writable", writeVerdict(`${cwd}/src/app.ts`, { denyWrite: ["~/.ssh"] }) === "");
check("key material stays hard-denied", writeVerdict(sshAuthorizedKeys, { denyWrite: ["~/.ssh"] }).includes("absolute-deny"));
check("a critical file asks when it is updated", writeVerdict(projectEnv, { askWrite: [".env"] }).startsWith("askWrite matched"));
check("a shell rc file asks even though home is writable", writeVerdict(bashrc, askWhenWritingBashrc).startsWith("askWrite matched"));
check("the ask verdict is rendered for the user", writeVerdict(bashrc, askWhenWritingBashrc).includes("~/.bashrc"));

check("a credential store folder asks on read", (isAskRead(awsConfig, cwd, wide) ?? "").includes("askRead matched"));
check("a sibling folder with the same prefix does not ask", isAskRead(awsBackup, cwd, wide) === null);

const allowOneFile = policy({ askRead: ["~/.aws"], allowRead: ["~/.aws/config"] });
check("an explicit allowRead silences the folder ask", isAskRead(awsConfig, cwd, allowOneFile) === null);
check("an explicit allowRead leaves the partner file asking", isAskRead(awsCredentials, cwd, allowOneFile) !== null);

const denyAndAskSameFolder = policy({ denyRead: ["~/.config/gcloud"], askRead: ["~/.config/gcloud"] });
check("a denyRead folder wins over an askRead folder", (() => {
	const reason = isDeniedRead(gcloudCredentials, cwd, denyAndAskSameFolder)
		?? isAskRead(gcloudCredentials, cwd, denyAndAskSameFolder);

	return (reason ?? "").startsWith("denyRead matched");
})());

const exists = () => true;
const reads = (command, overrides) => askReadCandidates(command, cwd, home, filesystem(overrides), exists, (path) => path);
const deniedWrites = (command, overrides) => deniedWriteCandidates(command, cwd, home, filesystem(overrides), (path) => path);
const askedWrites = (command, overrides) => askWriteCandidates(command, cwd, home, filesystem(overrides), (path) => path);

const awsSsoToken = `${home}/.aws/sso/cache/token.json`;
const askAws = { askRead: ["~/.aws"] };
const askVendor = { askRead: ["~/.any-vendor"] };
const denySsh = { denyWrite: ["~/.ssh"] };
const askEnv = { askWrite: [".env"] };

check("bash asks for a file inside a credential folder", reads("cat ~/.aws/config", askAws).includes(awsConfig));
check("bash asks for a nested unknown file too", reads("cat ~/.aws/sso/cache/token.json", askAws).includes(awsSsoToken));
check("a vendor folder added in one line is covered", reads("cat ~/.any-vendor/creds.json", askVendor).includes(vendorCredentials));
check("bash blocks a write into key material", deniedWrites("echo key >> ~/.ssh/authorized_keys", denySsh).includes(sshAuthorizedKeys));
check("bash reports a writer that touches a critical file", askedWrites("cp .env.example .env", askEnv).includes(projectEnv));
check("bash allows a write into a home dotfile", deniedWrites("echo x > ~/.composio/state.json", denySsh).length === 0);
check("the home dotfile path is what a session grant would cover", composioState.startsWith(`${home}/.composio/`));

check("a session grant may cover a credential folder", isSessionFolderGrant(`${home}/.aws`, home));
check("a session grant may not cover the home folder", !isSessionFolderGrant(home, home));
check("a session grant may not cover /", !isSessionFolderGrant("/", home));
check("a session grant may not cover a parent of home", !isSessionFolderGrant(dirname(home), home));
check("a permanent grant still refuses a credential folder", !isSafeFolderGrant(`${home}/.aws`, home));
check("a permanent grant still refuses a credential child", !isSafeFolderGrant(`${home}/.aws/sso`, home));
check("a permanent grant allows an ordinary folder", isSafeFolderGrant(`${home}/work/shared`, home));

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
