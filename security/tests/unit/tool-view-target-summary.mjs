import { displayShellCommand, fitCommand, fitTarget, summarizeShellCommand } from '../../../src/core/tool-view/target-summary.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

check('a single command is itself', summarizeShellCommand('npm test') === 'npm test');
check('an && chain keeps the last segment', summarizeShellCommand('cd /work && npm run build') === 'npm run build');
check('a || chain keeps the last segment', summarizeShellCommand('npm test || echo failed') === 'echo failed');
check('a semicolon chain keeps the last segment', summarizeShellCommand('a; b ; c') === 'c');
check('a pipeline keeps the last stage', summarizeShellCommand('cat log | tail -20') === 'tail -20');
check('a quoted && is not a boundary', summarizeShellCommand("echo 'a && b' && ls") === 'ls');
check('a quoted pipe stays in its segment', summarizeShellCommand("grep 'a|b' file") === "grep 'a|b' file");
check('a double-quoted separator is not a boundary', summarizeShellCommand('echo "a && b"') === 'echo "a && b"');
check('a newline is collapsed, not a segment boundary', summarizeShellCommand('npm ci\nnpm test') === 'npm ci npm test');
check('whitespace collapses to one line', summarizeShellCommand('  npm   run\n  build ') === 'npm run build');
check('an empty last segment keeps the whole command', summarizeShellCommand('ls &&') === 'ls &&');
check('an empty command stays empty', summarizeShellCommand('') === '');

check('a sudo prefix is dropped', summarizeShellCommand('sudo npm test') === 'npm test');
check('an env assignment is dropped', summarizeShellCommand('FOO=1 npm test') === 'npm test');
check('env, an assignment and a runner are all dropped', summarizeShellCommand('env FOO=1 npx vitest run') === 'vitest run');
check('uv run is dropped', summarizeShellCommand('uv run pytest -q') === 'pytest -q');
check('poetry run is dropped', summarizeShellCommand('poetry run python -m pytest -q') === 'pytest -q');

check('python -m names the module', summarizeShellCommand('python3 -m pytest tests/unit -q') === 'pytest tests/unit -q');
check('flags before -m are still hoisted', summarizeShellCommand('python3 -X faulthandler -m pytest -k "not slow"') === 'pytest -k "not slow"');
check('python -m ruff names ruff', summarizeShellCommand('python -m ruff check src') === 'ruff check src');
check('python -m pip names pip', summarizeShellCommand('python3 -m pip install -r requirements.txt') === 'pip install -r requirements.txt');
check('a python script replaces the interpreter', summarizeShellCommand('python3 scripts/seed.py --force') === 'scripts/seed.py --force');
check('python -c keeps the flag and drops the code', summarizeShellCommand('python3 -c "import sys; print(sys.version)"') === 'python3 -c …');
check('a heredoc reads as stdin', summarizeShellCommand("python3 - <<'EOF'\nprint(1)\nEOF") === 'python3 (stdin)');
check('a plain python call is untouched', summarizeShellCommand('python3 --version') === 'python3 --version');
check('a non-python program is untouched', summarizeShellCommand('node scripts/seed.js --force') === 'node scripts/seed.js --force');

check('a display command keeps a pipeline whole', displayShellCommand('head -40 src/a.ts | head') === 'head -40 src/a.ts | head');
check('a display command keeps both chain segments', displayShellCommand('npm ci && npm test') === 'npm ci && npm test');
check('a display command drops a leading cd', displayShellCommand('cd /work && npm test') === 'npm test');
check('a display command drops cd then hoists python', displayShellCommand('cd /work && python3 -m pytest -q') === 'pytest -q');
check('a display command drops wrappers', displayShellCommand('sudo uv run pytest -q') === 'pytest -q');
check('an empty display command stays empty', displayShellCommand('') === '');

check('a fitting target is untouched', fitTarget('git status', 20) === 'git status');
check('an exact fit is untouched', fitTarget('abcde', 5) === 'abcde');
check('an overflowing target keeps its tail', fitTarget('sed -n 660,700p plan/a.md', 20) === '… 660,700p plan/a.md');
check('a long path keeps its last segment', fitTarget('src/core/tool-view/row-group.ts', 20) === '… row-group.ts');
check('a long path keeps as many segments as fit', fitTarget('src/core/tool-view/row-group.ts', 26) === '… tool-view/row-group.ts');
check('a single token that cannot fit is dropped', fitTarget('readme', 4) === undefined);
check('no room for the ellipsis drops the target', fitTarget('abc', 1) === undefined);
check('an empty budget drops the target', fitTarget('abc', 0) === undefined);

check('a fitting command is untouched', fitCommand('npm test', 20) === 'npm test');
check('an overflowing command keeps its head and tail', fitCommand('rg -n "tool-view" src/core plan', 24) === 'rg -n "tool-view" … plan');
check('a quoted argument is one token', fitCommand('pytest -k "not slow" tests/unit', 30) === 'pytest -k … tests/unit');
check('a narrower budget keeps the program and the tail', fitCommand('rg -n "tool-view" src/core plan', 10) === 'rg … plan');
check('an even narrower budget keeps only the tail', fitCommand('rg -n "tool-view" src/core plan', 6) === '… plan');
check('the program survives when the tail cannot', fitCommand('rg -n "tool-view" src/core plan', 3) === 'rg');
check('a single long token keeps its path tail', fitCommand('a/very/long/path/file.ts', 12) === '… file.ts');
check('the tail carries exactly one ellipsis', fitCommand('awk \'length > 110 {printf "%s:%d"}\' src/a.ts src/b.ts', 12) === '… src/b.ts');

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
