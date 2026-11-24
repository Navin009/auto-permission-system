import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const FIELD_SEPARATOR = "\x1f";
const RECORD_SEPARATOR = "\x1e";
const TAG_PATTERN = "v*";
const TAG_PREFIX = "v";
const DEFAULT_REPOSITORY = "Navin009/auto-permission-system";
const GITHUB_ORIGIN = "https://github.com";
const GENERATOR_PLUGIN_NAME = "@semantic-release/release-notes-generator";
const RELEASE_CHORE_PATTERN = /^chore\(release\):/;
const COMMIT_FORMAT = `%H${FIELD_SEPARATOR}%B${RECORD_SEPARATOR}`;
const REQUIRE = createRequire(import.meta.url);

function runGit(args) {
	return execFileSync("git", args, { encoding: "utf-8" }).trim();
}

function findPreviousTag(currentTag) {
	try {
		return runGit(["describe", "--tags", "--abbrev=0", "--match", TAG_PATTERN, `${currentTag}^`]);
	} catch {
		return undefined;
	}
}

function readCommits(range) {
	const raw = runGit(["log", "--no-merges", `--format=${COMMIT_FORMAT}`, range]);

	if (!raw) {
		return [];
	}

	return raw
		.split(RECORD_SEPARATOR)
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map(parseCommitEntry)
		.filter((commit) => !RELEASE_CHORE_PATTERN.test(commit.message));
}

function parseCommitEntry(entry) {
	const [hash = "", ...rest] = entry.split(FIELD_SEPARATOR);

	return { hash, message: rest.join(FIELD_SEPARATOR).trim() };
}

function loadGeneratorPluginConfig() {
	const releaseConfig = REQUIRE("../../.releaserc.cjs");
	const plugins = releaseConfig.plugins ?? [];
	const entry = plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === GENERATOR_PLUGIN_NAME);

	return entry ? entry[1] : { preset: "conventionalcommits" };
}

function versionFromTag(tag) {
	return tag.startsWith(TAG_PREFIX) ? tag.slice(TAG_PREFIX.length) : tag;
}

async function buildNotes(currentTag, outputPath) {
	const repository = process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY;
	const repositoryUrl = `${GITHUB_ORIGIN}/${repository}`;
	const previousTag = findPreviousTag(currentTag);
	const range = previousTag ? `${previousTag}..${currentTag}` : currentTag;
	const commits = readCommits(range);
	const pluginConfig = loadGeneratorPluginConfig();
	const generatorUrl = pathToFileURL(REQUIRE.resolve(GENERATOR_PLUGIN_NAME)).href;
	const { generateNotes } = await import(generatorUrl);

	const generated = await generateNotes(pluginConfig, {
		commits,
		lastRelease: previousTag ? { gitTag: previousTag, gitHead: previousTag } : {},
		nextRelease: {
			version: versionFromTag(currentTag),
			gitTag: currentTag,
			gitHead: currentTag,
		},
		options: { repositoryUrl },
		cwd: process.cwd(),
	});

	const trimmed = generated.trim();
	const fallback = previousTag
		? `**Full Changelog**: ${repositoryUrl}/compare/${previousTag}...${currentTag}`
		: `Release ${currentTag}`;
	const notes = `${trimmed || fallback}\n`;

	if (outputPath) {
		writeFileSync(outputPath, notes);
		return;
	}

	process.stdout.on("error", (error) => {
		if (error.code === "EPIPE") {
			process.exit(0);
		}

		throw error;
	});
	process.stdout.write(notes);
}

await buildNotes(process.argv[2] ?? process.env.TAG ?? "HEAD", process.argv[3]);
