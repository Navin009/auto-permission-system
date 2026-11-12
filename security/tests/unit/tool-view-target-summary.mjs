import { fitTarget, summarizeShellCommand } from '../../../src/core/tool-view/target-summary.ts';

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
check('a newline separates segments', summarizeShellCommand('npm ci\nnpm test') === 'npm test');
check('the segment is collapsed to one line', summarizeShellCommand('  npm   run\n  build ') === 'build');
check('an empty last segment keeps the whole command', summarizeShellCommand('ls &&') === 'ls &&');
check('an empty command stays empty', summarizeShellCommand('') === '');

check('a fitting target is untouched', fitTarget('git status', 20) === 'git status');
check('an exact fit is untouched', fitTarget('abcde', 5) === 'abcde');
check('an overflowing target keeps its tail', fitTarget('sed -n 660,700p plan/a.md', 20) === '… 660,700p plan/a.md');
check('a long path keeps its last segment', fitTarget('src/core/tool-view/row-group.ts', 20) === '… row-group.ts');
check('a long path keeps as many segments as fit', fitTarget('src/core/tool-view/row-group.ts', 26) === '… tool-view/row-group.ts');
check('a single token that cannot fit is dropped', fitTarget('readme', 4) === undefined);
check('no room for the ellipsis drops the target', fitTarget('abc', 1) === undefined);
check('an empty budget drops the target', fitTarget('abc', 0) === undefined);

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
