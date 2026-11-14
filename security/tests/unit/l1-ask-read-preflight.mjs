import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearFilesystemSessionGrants, preflightAskReads } from "../../../src/l1-sandbox/bash-preflight.ts";

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => { if (cond) pass++; else { fail++; console.log("FAIL:", name, "→", extra); } };

const project = realpathSync(mkdtempSync(join(tmpdir(), "aps-ask-read-")));
const outerFolder = realpathSync(mkdtempSync(join(tmpdir(), "aps-ask-read-outer-")));

mkdirSync(join(project, "src"));
writeFileSync(join(project, "src", "app.ts"), "export const value = 1;\n");
writeFileSync(join(project, ".env"), "API_TOKEN=abc123\n");
writeFileSync(join(project, ".env.example"), "# documented keys, no values\nAPI_TOKEN=\nDB_HOST=localhost\n");
writeFileSync(join(project, ".env.sample"), "OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz0123456789\n");
writeFileSync(join(outerFolder, ".env"), "API_TOKEN=abc123\n");

const prompts = [];
const blocks = [];
const ctx = {
	cwd: project,
	hasUI: true,
	ui: {
		select: async (title) => { prompts.push(title); return undefined; },
		notify: () => {},
	},
};

const run = (command, options = { ctx }) => {
	prompts.length = 0;
	blocks.length = 0;
	clearFilesystemSessionGrants();

	return preflightAskReads(command, project, options, (chunk) => blocks.push(String(chunk)));
};

/** Same command line again, without clearing what the conversation already decided. */
const askAgain = (command, options = { ctx }) => {
	prompts.length = 0;
	blocks.length = 0;

	return preflightAskReads(command, project, options, (chunk) => blocks.push(String(chunk)));
};

await run("cat .env");
check("a content read asks", prompts.length === 1, prompts.length);
check("the asked file is named", prompts[0]?.includes(`File     ${project}/.env`) === true);
check("the triggering command is shown", prompts[0]?.includes("Command  cat .env") === true);

const longCommand = `cd ${project} && rg -n "stale after session replacement" --hidden --glob '!node_modules' .env`;
await run(longCommand);
check("a long command is shown in full, without an ellipsis", prompts[0]?.includes(`Command  ${longCommand}`) === true, prompts[0]?.split("\n")[1]);
check("the exposure is stated as content", prompts[0]?.includes("Risk     the AI will see any keys in it") === true);
check("the matched rule is explained", prompts[0]?.includes("Why      .env files usually hold passwords") === true);
check("the note explains the missing always option", prompts[0]?.includes("Note     this file holds secrets, so a saved rule is never offered") === true);
check("a denial blocks the command", blocks.join("").includes("[Security Block] sandbox: read access to"));
check("the title describes a read", prompts[0]?.startsWith("🔑  Let this command read your .env file?") === true, prompts[0]?.split("\n")[0]);

await run("find . -type f");
check("a name-only listing inside the project does not ask", prompts.length === 0, prompts[0]);
check("a name-only listing is not blocked", blocks.length === 0);

await run("find . -name .env");
check("a filtered name-only listing does not ask either", prompts.length === 0, prompts[0]);

await run("ls -a");
check("a dotfile listing does not ask", prompts.length === 0, prompts[0]);

await run("ls -a | grep -v '\\.env'");
check("a grep pattern that names .env does not ask", prompts.length === 0, prompts[0]);

await run("rg -n 'API_TOKEN' .");
check("rg does not ask for the dotfile it never opens", prompts.length === 0, prompts[0]);

await run("grep -rn 'API_TOKEN' .");
check("a recursive search that merely walks over a dotfile does not ask", prompts.length === 0, prompts[0]);

await run("grep -rn 'API_TOKEN' .env");
check("a recursive search that names the dotfile still asks", prompts.length === 1, prompts.length);

await run("cat .env", { ctx });
await askAgain("cat .env", { ctx });
check("a refusal is remembered instead of asked again", prompts.length === 0, prompts.length);
check("the remembered refusal still blocks", blocks.join("").includes("was refused earlier in this conversation"));

await run("cat .env.example");
check("a clean env template does not ask", prompts.length === 0, prompts[0]);
check("the clean template is not blocked", blocks.length === 0);

await run("cat .env.sample");
check("a template that carries a real key still asks", prompts.length === 1, prompts.length);

await run(`find ${outerFolder} -name .env`);
check("a name-only walk outside the project does not ask at the read gate", prompts.length === 0, prompts.length);
check("the outside-project fence is the gate for it instead", blocks.length === 0);

await run(`cat ${outerFolder}/.env`);
check("a content read outside the project asks", prompts.length === 1, prompts.length);

await run("cat .env", {});
check("a headless content read is blocked instead of asked", prompts.length === 0 && blocks.join("").includes("automated environment"));

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
