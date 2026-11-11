import { askReadFindings, findReadCandidates, parseFindQuery, ReadExposure } from "../../../src/core/index.ts";

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => { if (cond) pass++; else { fail++; console.log("FAIL:", name, "→", extra); } };

const cwd = "/home/me/proj";
const home = "/home/me";
const envFile = `${cwd}/.env`;
const nestedEnv = `${cwd}/config/.env`;
const deepEnv = `${cwd}/src/deep/nested/.env`;
const appFile = `${cwd}/src/app.ts`;
const tree = [envFile, nestedEnv, deepEnv, appFile];

const depthOf = (path) => path.slice(cwd.length + 1).split("/").length;

const listDirectory = (directory, maximumDepth) => {
	if (directory !== cwd) return [];

	return tree.filter((path) => maximumDepth === undefined || depthOf(path) <= maximumDepth);
};

const query = (tokens) => parseFindQuery(tokens);
const candidates = (tokens, checkFileExists = () => false) =>
	findReadCandidates(tokens, cwd, home, checkFileExists, { listDirectory });

check("the search root is a target, not a predicate value", (() => {
	const parsed = query([".", "-name", ".markdownlint*", "-maxdepth", "2"]);
	return parsed.targets.length === 1 && parsed.targets[0] === ".";
})());

check("a name pattern is not a target", (() => {
	const parsed = query([".", "-name", ".markdownlint*"]);
	return parsed.namePatterns.length === 1 && parsed.namePatterns[0] === ".markdownlint*";
})());

check("a negated path is an exclusion, not a target", (() => {
	const parsed = query([".", "-not", "-path", "./node_modules/*"]);

	return parsed !== undefined && parsed.targets.length === 1 && parsed.excludedPaths[0] === "./node_modules/*";
})());

check("a negated name is an exclusion", (() => {
	const parsed = query([".", "!", "-name", "*.md"]);

	return parsed !== undefined && parsed.excludedNames[0] === "*.md" && !parsed.namePatterns.length;
})());

check("maxdepth and mindepth are read as numbers", (() => {
	const parsed = query([".", "-maxdepth", "2", "-mindepth", "1"]);
	return parsed.maximumDepth === 2 && parsed.minimumDepth === 1;
})());

check("type consumes its value", (() => {
	const parsed = query([".", "-type", "f", "-name", "*.env"]);
	return parsed.targets.length === 1 && parsed.namePatterns.length === 1;
})());

check("exec cannot be read as a filter", query([".", "-exec", "cat", "{}", ";"] ) === undefined);
check("an alternation cannot be read as a filter", query([".", "-name", "a", "-o", "-name", "b"]) === undefined);
check("a negated size cannot be read as a filter", query([".", "!", "-size", "2"]) === undefined);
check("a trailing predicate without its value is refused", query([".", "-name"]) === undefined);

check("a name filter removes a file find never prints", !candidates([".", "-maxdepth", "2", "-name", ".markdownlint*", "-not", "-path", "./node_modules/*"]).length);
check("an excluded path removes that subtree", !candidates([".", "-not", "-path", "./src/*"]).includes(deepEnv));
check("an excluded name removes those files", !candidates([".", "!", "-name", "*.env"]).includes(envFile));

check("no filter lists everything", candidates(["."]).includes(envFile));
check("maxdepth bounds the walk", (() => {
	const found = candidates([".", "-maxdepth", "1"]);
	return found.includes(envFile) && !found.includes(nestedEnv);
})());

check("mindepth drops the shallow files", (() => {
	const found = candidates([".", "-mindepth", "2"]);
	return !found.includes(envFile) && found.includes(nestedEnv);
})());

check("a name pattern keeps only matches", (() => {
	const found = candidates([".", "-name", "*.env"]);
	return found.length === 3 && !found.includes(appFile);
})());

check("a bare target still reports the file", candidates([".env"], () => true).includes(`${cwd}/.env`));
check("a repeated target reports once", candidates([".", "."]).length === 4);
check("a missing target reports nothing", !candidates(["./missing"]).length);

const filesystem = { denyRead: [], allowWrite: ["."], denyWrite: [], askRead: [".env"] };
const findings = (tokens) =>
	askReadFindings(`find ${tokens.join(" ")}`, cwd, home, filesystem, () => false, (path) => path, { listDirectory });

check("the reported finding carries its matched pattern", findings([".", "-name", "*.env"])[0].pattern === ".env");
check("a listing is reported as name-only", findings([".", "-name", "*.env"])[0].exposure === ReadExposure.Name);

const contentFindings = askReadFindings("cat .env", cwd, home, filesystem, () => true);
check("a content read is reported as content", contentFindings[0].exposure === ReadExposure.Content);
check("content exposure wins over a name listing", (() => {
	const merged = askReadFindings("find . -name .env && cat .env", cwd, home, filesystem, () => true, (path) => path, { listDirectory });
	const namedInCommand = merged.find((finding) => finding.path === envFile);
	const listedOnly = merged.find((finding) => finding.path === nestedEnv);

	return namedInCommand?.exposure === ReadExposure.Content && listedOnly?.exposure === ReadExposure.Name;
})());

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
