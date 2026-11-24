import { readFileSync } from "node:fs";
import { POLICY_KEYS, unknownPolicyKeys } from "#core/policy/policy-keys.ts";

let pass = 0;
let fail = 0;
const check = (name, condition, extra = "") => {
	if (condition) pass++;
	else {
		fail++;
		console.log("FAIL:", name, "→", extra);
	}
};

const schema = JSON.parse(readFileSync("sandbox.schema.json", "utf-8"));
const shipped = JSON.parse(readFileSync("sandbox.default.json", "utf-8"));

const schemaAt = (path) => (path === "" ? schema : path.split(".").reduce((node, key) => node.properties[key], schema));
const paths = ["", "network", "filesystem", "filesystem.outsideProject", "mcp", "subagent", "commands", "overrides"];

check("the schema declares draft 2020-12", String(schema.$schema).includes("2020-12"));
check("the schema refuses unknown keys", schema.additionalProperties === false);

for (const path of paths) {
	const node = schemaAt(path);
	const schemaKeys = Object.keys(node?.properties ?? {})
		.filter((key) => key !== "$schema")
		.sort();
	const runtimeKeys = [...POLICY_KEYS[path]].filter((key) => key !== "$schema").sort();
	const label = path === "" ? "the root" : path;

	check(`${label}: the schema and the readers agree`, JSON.stringify(schemaKeys) === JSON.stringify(runtimeKeys), `schema=${schemaKeys} runtime=${runtimeKeys}`);
	check(`${label}: nested objects refuse unknown keys`, path === "" || node.additionalProperties === false);
}

const defaultUnknown = unknownPolicyKeys(shipped);
check("the shipped default has no unknown keys", defaultUnknown.length === 0, JSON.stringify(defaultUnknown));
check("the shipped default declares no $schema", shipped.$schema === undefined);

check("a top-level typo is reported", unknownPolicyKeys({ allowWrite: [] }).join(",") === "allowWrite");
check("a nested typo is reported", unknownPolicyKeys({ filesystem: { allowWrites: [] } }).join(",") === "filesystem.allowWrites");
check("a comment key is allowed", unknownPolicyKeys({ _comment_x: 1, filesystem: { _comment_y: 2 } }).length === 0);
check("valid keys report nothing", unknownPolicyKeys({ enabled: true, filesystem: { denyRead: [] }, network: { allowedDomains: [] } }).length === 0);

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
