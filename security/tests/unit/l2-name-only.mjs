// Layer 2 read exposure (ADR-050): a directory listing is name-only, so the
// askRead tier (which is about file contents) does not fire for `ls`/`find` or
// for a `grep` rooted at a folder — while denyRead and the outside-project
// fence still apply, and a file operand still asks.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const agentDir = mkdtempSync(join(tmpdir(), "aps-name-only-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const { ReadExposure } = await import("../../../src/core/index.ts");
const { checkReadAccess } = await import("../../../src/l2-guard/tool-gates.ts");
const { clearSessionGrants } = await import("../../../src/l2-guard/prompts.ts");

let pass = 0;
let fail = 0;

const check = (name, condition, extra = "") => {
	if (condition) pass++;
	else {
		fail++;
		console.log("FAIL:", name, "→", extra);
	}
};

const project = realpathSync(mkdtempSync(join(tmpdir(), "aps-name-only-")));
const outsideFolder = realpathSync(mkdtempSync(join(tmpdir(), "aps-name-only-outside-")));

mkdirSync(join(project, "credentials"));
mkdirSync(join(project, "src"));
writeFileSync(join(project, ".env"), "API_TOKEN=abc123\n");
writeFileSync(join(project, "credentials", "token.txt"), "abc123\n");
writeFileSync(join(project, "src", "app.ts"), "export const value = 1;\n");

const prompts = [];
const context = {
	cwd: project,
	hasUI: true,
	ui: {
		select: async (title) => {
			prompts.push(title);
			return undefined;
		},
		input: async () => undefined,
		notify: () => {},
	},
};

const policyFor = (overrides = {}) => ({
	enabled: true,
	mode: "default",
	network: { allowedDomains: [], deniedDomains: [] },
	filesystem: {
		denyRead: [],
		allowWrite: ["."],
		denyWrite: [],
		askRead: [".env", `${project}/credentials`],
		outsideProject: { read: "allow" },
		...overrides,
	},
});

const read = async (path, toolName, exposure, policy = policyFor()) => {
	prompts.length = 0;
	clearSessionGrants();

	const result = await checkReadAccess(path, toolName, context, policy, exposure);

	return { result, asked: prompts.length > 0, prompt: prompts[0] };
};

const nameOnlyListing = await read("credentials", "ls", ReadExposure.Name);
check("listing a credential folder asks nothing", !nameOnlyListing.asked && !nameOnlyListing.result);
check("the listing is not blocked", nameOnlyListing.result === undefined);

const reRead = await read("credentials", "read", ReadExposure.Content);
check("reading the same path as content still asks", reRead.asked, reRead.prompt);

const fileInsideFolder = await read(join(project, "credentials", "token.txt"), "read", ReadExposure.Content);
check("a file inside the folder asks", fileInsideFolder.asked, fileInsideFolder.prompt);

const grepOverFolder = await read("credentials", "grep", ReadExposure.Name);
check("grep rooted at a folder asks nothing", !grepOverFolder.asked && !grepOverFolder.result);

const grepOverFile = await read(join(project, "credentials", "token.txt"), "grep", ReadExposure.Content);
check("grep on a file still asks", grepOverFile.asked, grepOverFile.prompt);

const envRead = await read(".env", "read", ReadExposure.Content);
check("reading .env still asks", envRead.asked, envRead.prompt);

const deniedListing = await read("credentials", "ls", ReadExposure.Name, policyFor({ denyRead: [`${project}/credentials`] }));
check("denyRead still blocks a name-only listing", deniedListing.result?.block === true, deniedListing.result);

const deniedFile = await read(
	"credentials/token.txt",
	"grep",
	ReadExposure.Name,
	policyFor({ denyRead: [`${project}/credentials/token.txt`] }),
);
check("denyRead still blocks a name-only root under a denied file", deniedFile.result?.block === true, deniedFile.result);

const outsideListing = await read(outsideFolder, "ls", ReadExposure.Name, policyFor({ outsideProject: { read: "deny" } }));
check("the outside-project fence still blocks a name-only listing", outsideListing.result?.block === true, outsideListing.result);

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
