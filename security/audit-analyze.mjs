#!/usr/bin/env node
/**
 * auto-permission-system audit-log analyzer.
 *
 * Reads `~/.pi/agent/audit.log` (one JSONL entry per decision) and reports
 * patterns that suggest bugs, friction, or misconfiguration:
 *
 *   1. Headless refusals — a subagent or `-p` run got blocked; the model saw
 *      "blocked by policy" instead of an answer. If many of these pile up,
 *      the user's policy is too restrictive for that workflow.
 *   2. Persist failures — `always-persist-failed` in the note means the ask
 *      was answered but writing to `sandbox.json` failed (typically untrusted
 *      project). Each one is a session/remember grant the user thought they
 *      saved but actually didn't.
 *   3. Model loops — the same path or host blocked more than 3 times in a
 *      row. Almost always means the model is retrying the same action without
 *      changing approach.
 *   4. Telemetry spam — the same analytics host (posthog, segment, etc.) keeps
 *      being asked even after a session grant. Indicates session grants
 *      aren't surviving a session boundary.
 *   5. Untrusted-project widening — the same project keeps warning that it
 *      wants to loosen rules. Either trust it or tighten it.
 *   6. Advanced Secure redactions — many `advanced-secure-output` decisions
 *      mean the model keeps hitting secret-like content and you keep losing
 *      context. Consider narrowing the surface that triggers it.
 *   7. Grant outliers — sessions granted more than 10 times for the same
 *      pattern suggest a one-shot grant would have been cheaper.
 *
 * Usage:
 *   node security/audit-analyze.mjs              # human-readable report
 *   node security/audit-analyze.mjs --json      # machine-readable JSON
 *   node security/audit-analyze.mjs --top N     # show top N (default 10)
 *   node security/audit-analyze.mjs --path X    # custom audit-log path
 *
 * Designed to be re-run after each session to spot drift.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const args = new Set(process.argv.slice(2));
const asJson = args.has("--json");
const topN = Number(/--top\s+(\d+)/.exec(process.argv.join(" "))?.[1] ?? "10");
const customPath = (() => {
	for (let i = 2; i < process.argv.length; i++) if (process.argv[i] === "--path") return process.argv[i + 1];
	return undefined;
})();

const AUDIT_PATH = customPath ?? join(homedir(), ".pi", "agent", "audit.log");

if (!existsSync(AUDIT_PATH)) {
	console.error(`audit-analyze: ${AUDIT_PATH} does not exist (no audit log yet?)`);
	process.exit(1);
}

const text = readFileSync(AUDIT_PATH, "utf-8");
const entries = text.trim().split("\n").map((line) => {
	try { return JSON.parse(line); }
	catch { return null; }
}).filter(Boolean);

// ---------- Aggregations ----------

const byDecision = new Map();
const bySubject = new Map();     // subject -> { yes, no, session, ... }
const byNote = new Map();         // note -> count
const headless = [];
const persistFailures = [];
const advancedRedactions = [];
const untrustedWarnings = [];
const sensitiveCommands = [];
const grantsByPattern = new Map(); // pattern -> count
const loops = []; // sequences of > 3 same-subject blocks

let prevSubject = null;
let runStart = null;

for (const e of entries) {
	const decision = String(e.decision ?? "");
	byDecision.set(decision, (byDecision.get(decision) ?? 0) + 1);

	if (e.note) byNote.set(e.note, (byNote.get(e.note) ?? 0) + 1);

	const subj = e.subject ?? "(no-subject)";
	const sub = bySubject.get(subj) ?? {};
	sub[decision] = (sub[decision] ?? 0) + 1;
	bySubject.set(subj, sub);

	if (String(e.note ?? "").includes("headless")) headless.push(e);
	if (String(e.note ?? "").startsWith("always-persist-failed")) persistFailures.push(e);
	if (e.note === "advanced-secure-output") advancedRedactions.push(e);
	if (e.event === "untrusted-project-policy") untrustedWarnings.push(e);
	if (e.note === "sensitive-command") sensitiveCommands.push(e);

	if (e.grant && (decision === "session" || decision === "always-cwd" || decision === "always-global")) {
		grantsByPattern.set(e.grant, (grantsByPattern.get(e.grant) ?? 0) + 1);
	}

	// Loop detection: > 3 consecutive blocks on the same subject
	if (decision === "no" && subj === prevSubject) {
		if (!runStart) runStart = entries.indexOf(e);
	} else {
		if (runStart !== null && entries.indexOf(e) - runStart >= 3) {
			loops.push({ subject: prevSubject, length: entries.indexOf(e) - runStart, startedAt: entries[runStart]?.ts });
		}
		runStart = null;
	}
	prevSubject = subj;
}

// ---------- Findings (issues to surface) ----------

const findings = [];

if (headless.length > 0) {
	findings.push({
		severity: "warn",
		code: "headless-refusals",
		count: headless.length,
		summary: `${headless.length} headless refusals — subagents got blocked instead of prompted.`,
		detail: headless.slice(-3).map((e) => `  ${e.ts}\t${e.tool}\t${e.note}`).join("\n"),
		suggestion: "If these are intentional, lower the strictness for subagent mode (subagent.network=allow). If unintentional, the policy may be too tight.",
	});
}

if (persistFailures.length > 0) {
	findings.push({
		severity: "high",
		code: "persist-failures",
		count: persistFailures.length,
		summary: `${persistFailures.length} “always” grants failed to persist to sandbox.json.`,
		detail: persistFailures.slice(-3).map((e) => `  ${e.ts}\t${e.subject ?? ""}\t${String(e.note).slice(0, 80)}`).join("\n"),
		suggestion: "Most common cause: an untrusted project (.pi/sandbox.json) that the user picked “in this project” on. Run /security trust or pick “in all projects”.",
	});
}

if (loops.length > 0) {
	findings.push({
		severity: "high",
		code: "model-loops",
		count: loops.length,
		summary: `${loops.length} sequences of 3+ consecutive blocks on the same subject.`,
		detail: loops.slice(0, 5).map((l) => `  ${l.subject}  (${l.length} consecutive blocks)`).join("\n"),
		suggestion: "The model is retrying the same action. A clearer system prompt or a one-shot session grant would unblock it.",
	});
}

if (advancedRedactions.length > 5) {
	findings.push({
		severity: "warn",
		code: "advanced-secure-redactions",
		count: advancedRedactions.length,
		summary: `${advancedRedactions.length} Advanced Secure output redactions.`,
		suggestion: "If redactions happen often in a single session, the model keeps losing context. Consider narrowing the surface that triggers Advanced Secure, or upgrading to a session grant for known-safe outputs.",
	});
}

if (untrustedWarnings.length > 0) {
	const uniqProjects = new Set(untrustedWarnings.map((w) => w.file));
	findings.push({
		severity: "warn",
		code: "untrusted-project-warnings",
		count: untrustedWarnings.length,
		summary: `${untrustedWarnings.length} untrusted-project-policy warnings across ${uniqProjects.size} project(s).`,
		detail: [...uniqProjects].map((p) => `  ${p}`).join("\n"),
		suggestion: "Either run /security trust for the project(s), or tighten their .pi/sandbox.json so they don't ask to loosen.",
	});
}

if (sensitiveCommands.length > 3) {
	findings.push({
		severity: "info",
		code: "sensitive-command-blocks",
		count: sensitiveCommands.length,
		summary: `${sensitiveCommands.length} sensitive-command blocks (env / printenv).`,
		suggestion: "If the user keeps re-asking, consider whether they need an escape hatch or a more refined commands.ask list.",
	});
}

// ---------- Telemetry-spam detection ----------
const telemetryHosts = ["posthog.com", "segment.io", "mixpanel.com", "sentry.io", "amplitude.com", "datadoghq.com", "fullstory.com", "heap.io", "appsflyer.com", "adjust.com"];
const telemetryHits = [];
for (const [sub, counts] of bySubject) {
	for (const t of telemetryHosts) if (sub.includes(t)) {
		if ((counts.no ?? 0) > 2) telemetryHits.push({ host: sub, noCount: counts.no, ...counts });
		break;
	}
}
if (telemetryHits.length > 0) {
	findings.push({
		severity: "warn",
		code: "telemetry-spam",
		count: telemetryHits.length,
		summary: `${telemetryHits.length} analytics host(s) blocked multiple times in this log.`,
		detail: telemetryHits.map((t) => `  ${t.host}: ${t.noCount} blocks`).join("\n"),
		suggestion: "Either allow these hosts globally (they're analytics, not core), or add them to a 'telemetry tier' that auto-allows common ones.",
	});
}

// ---------- Grant outliers ----------
const grantOutliers = [...grantsByPattern.entries()].filter(([_, c]) => c >= 10);
if (grantOutliers.length > 0) {
	findings.push({
		severity: "info",
		code: "grant-outliers",
		count: grantOutliers.length,
		summary: `${grantOutliers.length} grant pattern(s) used 10+ times.`,
		detail: grantOutliers.map(([pat, c]) => `  ${pat}: ${c} grants`).join("\n"),
		suggestion: "These should probably be remembered (always) rather than re-asked each time.",
	});
}

// ---------- Output ----------

if (asJson) {
	const out = {
		path: AUDIT_PATH,
		totalEntries: entries.length,
		byDecision: Object.fromEntries(byDecision),
		topSubjects: [...bySubject.entries()].sort((a, b) => sumCounts(b[1]) - sumCounts(a[1])).slice(0, topN).map(([subject, counts]) => ({ subject, ...counts })),
		topGrants: [...grantsByPattern.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN),
		findings,
	};
	process.stdout.write(JSON.stringify(out, null, 2) + "\n");
} else {
	console.log(`audit-analyze  ${AUDIT_PATH}`);
	console.log(`entries:       ${entries.length}`);
	console.log(`window:        ${entries[0]?.ts ?? "?"}  →  ${entries[entries.length - 1]?.ts ?? "?"}`);
	console.log("");
	console.log("by decision:");
	for (const [k, v] of [...byDecision.entries()].sort((a, b) => b[1] - a[1])) {
		console.log(`  ${k.padEnd(22)} ${v}`);
	}
	console.log("");
	console.log(`top ${topN} subjects:`);
	const topSubjects = [...bySubject.entries()].sort((a, b) => sumCounts(b[1]) - sumCounts(a[1])).slice(0, topN);
	for (const [subject, counts] of topSubjects) {
		const total = sumCounts(counts);
		console.log(`  ${String(total).padStart(4)}  ${subject}`);
	}
	console.log("");
	console.log(`top ${topN} grants:`);
	const topGrants = [...grantsByPattern.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
	for (const [pat, c] of topGrants) console.log(`  ${String(c).padStart(4)}  ${pat}`);
	console.log("");
	if (findings.length === 0) {
		console.log("findings:       none — log looks healthy.");
	} else {
		console.log("findings:");
		for (const f of findings) {
			console.log(`  [${f.severity}] ${f.code} (${f.count})`);
			console.log(`    ${f.summary}`);
			if (f.detail) console.log(f.detail.split("\n").map((l) => "    " + l).join("\n"));
			if (f.suggestion) console.log(`    → ${f.suggestion}`);
		}
	}
}

function sumCounts(c) {
	let s = 0;
	for (const v of Object.values(c)) s += Number(v);
	return s;
}