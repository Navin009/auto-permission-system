// Read operand grammar and hidden-file exposure (ADR-050): a grep/rg PATTERN is
// data, not a path, and a search tool that skips dotfiles never opens `.env`.
import { askReadFindings, ReadExposure, readTargetTokens } from "../../../src/core/index.ts";
import { embeddedPathTokens } from "../../../src/core/policy/path-tokens.ts";

let pass = 0;
let fail = 0;

const check = (name, condition, extra = "") => {
	if (condition) pass++;
	else {
		fail++;
		console.log("FAIL:", name, "→", extra);
	}
};

const cwd = "/home/me/proj";
const home = "/home/me";
const filesystem = { denyRead: [], allowWrite: ["."], denyWrite: [], askRead: [".env", ".env.*", "*.pem"] };
const exists = () => true;
const listDirectory = (absoluteDirectory) => [
	`${absoluteDirectory}/.env`,
	`${absoluteDirectory}/.env.local`,
	`${absoluteDirectory}/src`,
	`${absoluteDirectory}/src/app.ts`,
];
const findings = (command) => askReadFindings(command, cwd, home, filesystem, exists, (path) => path, { listDirectory });
const paths = (command) => findings(command).map((finding) => finding.path);

check("a grep pattern is not a read target", !paths("ls -la | grep -v '\\.env'").includes(`${cwd}/.env`), paths("ls -la | grep -v '\\.env'"));
check("an anchored grep pattern is not a target", !paths("ls -la | grep -E '\\.env$'").includes(`${cwd}/.env`));
check("an alternation pattern is not a target", !paths("ls -a | grep -v -E '(\\.env|\\.git)'").includes(`${cwd}/.env`));
check("a stray grep keeps its file operand", paths("grep -n token .env").includes(`${cwd}/.env`));
check("grep with -e keeps the file operand", paths("grep -e token app.ts").length === 0);
check("rg skips dotfiles in a project walk", !paths("rg -n API_TOKEN .").includes(`${cwd}/.env`), paths("rg -n API_TOKEN ."));
check("rg --hidden reads them again", paths("rg --hidden -n API_TOKEN .").includes(`${cwd}/.env`));
check("grep -r still reads dotfiles", paths("grep -rn API_TOKEN .").includes(`${cwd}/.env`));
check("an explicit rg file operand still asks", paths("rg -n API_TOKEN .env").includes(`${cwd}/.env`));
check("a sed script keeps its file operand", paths("sed 's/=.*/=<masked>/' .env").includes(`${cwd}/.env`));
check("an interpreter code string keeps its path", paths("node -e \"x=readFileSync('.env')\"").includes(`${cwd}/.env`));
check("git keeps its file operand", paths("git diff -- .env").includes(`${cwd}/.env`));
check("a name-only listing stays name exposure", findings("find . -name '*.env'")[0]?.exposure === ReadExposure.Name);

check("readTargetTokens drops the pattern", !readTargetTokens("grep", ["-v", "\\.env"]).length);
check("readTargetTokens keeps a later operand", readTargetTokens("grep", ["-n", "token", ".env"]).join() === ".env");
check("readTargetTokens skips a flag value", readTargetTokens("grep", ["-A", "3", "token", ".env"]).join() === ".env");
check("readTargetTokens handles -e", readTargetTokens("grep", ["-e", "token", ".env"]).join() === ".env");
check("readTargetTokens passes other heads through", readTargetTokens("cat", [".env"]).join() === ".env");
check("readTargetTokens skips an inline flag value", readTargetTokens("rg", ["--glob=*.env", "--hidden", ".env"]).length === 0);

check("a regex fragment is not split into a path", embeddedPathTokens("\\.env").length === 0);
check("an alternation is not split into paths", embeddedPathTokens("(\\.env|\\.git)").length === 0);
check("a quoted path inside a code string survives", embeddedPathTokens("readFileSync('.env')").join() === ".env");

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
