#!/usr/bin/env bash
# One-stop security check.
#
#   ./security/check.sh        — run all tests, regenerate SECURITY.md, print summary
#   ./security/check.sh tests  — run tests only
#   ./security/check.sh render — regenerate SECURITY.md only
#

set -uo pipefail
cd "$(dirname "$0")/.."

# Prefer the sandbox's pi scratch dir; macOS has /private/tmp, Linux only /tmp.
if [[ -z "${TMPDIR:-}" ]]; then
	if [[ -d /private/tmp ]]; then
		TMPDIR="/private/tmp/pi-$(id -u)/"
	else
		TMPDIR="/tmp/pi-$(id -u)/"
	fi
fi
mkdir -p "$TMPDIR" || { echo "security/check.sh: cannot create TMPDIR=$TMPDIR" >&2; exit 1; }
out="$TMPDIR/sec-$$-out"

mode="${1:-all}"
manifest="security/manifest.json"
pass=0
fail=0
drift=0
skipped=0
results=()

counts_of_output() {
	local counts
	counts=$(grep -oE '(PASS|FAIL)=[0-9]+' "$1" | tail -2 | cut -d= -f2 | tr '\n' '/')
	printf '%s' "${counts%/}"
}

counts_of_expected() {
	local counts
	counts=$(grep -oE '(PASS|FAIL)=[0-9]+' <<<"$1" | head -2 | cut -d= -f2 | tr '\n' '/')
	printf '%s' "${counts%/}"
}

count_drift() {
	local expected_text=$1 output_file=$2
	local expected_pair reported_pair reported_failures

	expected_pair=$(counts_of_expected "$expected_text")
	reported_pair=$(counts_of_output "$output_file")

	if [[ "$reported_pair" == "?/?" ]]; then
		printf 'no PASS=/FAIL= summary in the output'
		return
	fi

	reported_failures=${reported_pair#*/}
	if [[ "$reported_failures" != "0" ]]; then
		printf 'reported %s' "$reported_pair"
		return
	fi

	if [[ "$expected_text" == *"("* ]]; then
		return
	fi

	if [[ "$reported_pair" != "$expected_pair" ]]; then
		printf 'the manifest pins %s, the test reports %s' "$expected_pair" "$reported_pair"
	fi
}

report_unlisted_tests() {
	local unlisted
	unlisted=$(node -e "
		const fs = require('fs');
		const m = JSON.parse(fs.readFileSync('$manifest', 'utf8'));
		const listed = new Set();
		for (const L of m.layers)
			for (const t of (L.tests || [])) {
				const found = /security\/tests\/([a-z]+\/[^ \"']+\.mjs)/.exec(t.command || '');
				if (found) listed.add(found[1]);
			}
		const files = ['unit', 'contract'].flatMap((dir) =>
			fs.readdirSync('security/tests/' + dir).filter((f) => f.endsWith('.mjs')).map((f) => dir + '/' + f));
		console.log(files.filter((f) => !listed.has(f)).join(' '));
	")

	if [[ -n "$unlisted" ]]; then
		echo "  note: not in the manifest (ran by npm test, not reported by SECURITY.md):"
		echo "    $unlisted"
		echo
	fi
}

run_tests() {
	# Extract { id, command, expected } from manifest.layers[*].tests[*]
	# Skip tests whose expected starts with "manual".
	local i=0
	while IFS=$'\t' read -r id cmd expected; do
		i=$((i+1))
		if [[ "$expected" == manual* ]]; then
			skipped=$((skipped+1))
			results+=("SKIP  $id  ($expected)")
			continue
		fi
		if eval "$cmd" >"$out" 2>&1; then
			summary=$(grep -E "^---|PASS=" "$out" | tail -1)
			drift_reason=$(count_drift "$expected" "$out")
			if [[ -n "$drift_reason" ]]; then
				drift=$((drift+1))
				results+=("FAIL  $id  count drift — $drift_reason")
			else
				pass=$((pass+1))
				results+=("PASS  $id  $summary")
			fi
		else
			fail=$((fail+1))
			summary=$(tail -3 "$out" | tr '\n' ' ')
			results+=("FAIL  $id  $summary")
		fi
		rm -f "$out"
	done < <(node -e "
		const m = JSON.parse(require('fs').readFileSync('$manifest','utf8'));
		for (const L of m.layers)
			for (const t of (L.tests||[]))
				console.log([t.id, t.command, t.expected].join('\t'));
	")
}

case "$mode" in
	all|tests)
		run_tests
		;;
esac

case "$mode" in
	all|render)
		echo
		node security/render.mjs
		;;
esac

if [[ "$mode" != "render" ]]; then
	echo
	echo "── Test results ──────────────────────────────────────────────"
	for r in "${results[@]}"; do echo "  $r"; done
	echo "──────────────────────────────────────────────────────────────"
	echo "  PASS=$pass  FAIL=$fail  DRIFT=$drift  SKIP=$skipped"
	echo
	report_unlisted_tests
	if [[ $((fail + drift)) -eq 0 ]]; then
		echo "✓ all tests pass"
	else
		echo "✗ $fail test(s) failed, $drift count mismatch(es)"
		exit 1
	fi
fi
