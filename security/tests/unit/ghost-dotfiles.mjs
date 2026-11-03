// Verify suppression of ghost dotfiles in memory (src/l1-sandbox/manager.ts).
import { suppressGhostDotfiles } from '../../../src/l1-sandbox/manager.ts';
import { stripNonExistentWorkspaceMounts } from '../../../src/l1-sandbox/bash-ops.ts';
import { DANGEROUS_FILES, DANGEROUS_DIRECTORIES } from '@anthropic-ai/sandbox-runtime/dist/sandbox/sandbox-utils.js';
import { SandboxManager } from '@anthropic-ai/sandbox-runtime';

let pass = 0, fail = 0;
const check = (name, cond) => {
	if (cond) {
		pass++;
	} else {
		fail++;
		console.log('FAIL:', name, '→', JSON.stringify(cond));
	}
};

suppressGhostDotfiles();

const dangerousFiles = DANGEROUS_FILES;
const dangerousDirs = DANGEROUS_DIRECTORIES;

check('.bashrc is not in DANGEROUS_FILES', !dangerousFiles.includes('.bashrc'));
check('.bash_profile is not in DANGEROUS_FILES', !dangerousFiles.includes('.bash_profile'));
check('.zshrc is not in DANGEROUS_FILES', !dangerousFiles.includes('.zshrc'));
check('.zprofile is not in DANGEROUS_FILES', !dangerousFiles.includes('.zprofile'));
check('.profile is not in DANGEROUS_FILES', !dangerousFiles.includes('.profile'));
check('.gitconfig is not in DANGEROUS_FILES', !dangerousFiles.includes('.gitconfig'));
check('.mcp.json is not in DANGEROUS_FILES', !dangerousFiles.includes('.mcp.json'));
check('.gitmodules is not in DANGEROUS_FILES', !dangerousFiles.includes('.gitmodules'));
check('.ripgreprc is not in DANGEROUS_FILES', !dangerousFiles.includes('.ripgreprc'));

check('.vscode is not in DANGEROUS_DIRECTORIES', !dangerousDirs.includes('.vscode'));
check('.idea is not in DANGEROUS_DIRECTORIES', !dangerousDirs.includes('.idea'));

// Check wrapped command output doesn't bind shell dotfiles
await SandboxManager.initialize({
	network: { allowedDomains: [] },
	filesystem: { allowWrite: ["."], denyRead: [], allowRead: [], denyWrite: [] },
});

const wrapped = await SandboxManager.wrapWithSandbox("echo ok");
check('wrapped command does not mention .bashrc', !wrapped.includes('.bashrc'));
check('wrapped command does not mention .bash_profile', !wrapped.includes('.bash_profile'));
check('wrapped command does not mention .zshrc', !wrapped.includes('.zshrc'));
check('wrapped command does not mention .zprofile', !wrapped.includes('.zprofile'));

SandboxManager.cleanupAfterCommand();
await SandboxManager.reset();

// Verify generic mount stripping of non-existent workspace placeholders
const fakeCwd = '/home/user/my-project';
const mockBwrap = `bwrap --ro-bind / / --ro-bind /dev/null ${fakeCwd}/.claude --ro-bind /dev/null ${fakeCwd}/.gitconfig --ro-bind /usr /usr -- echo ok`;
const stripped = stripNonExistentWorkspaceMounts(mockBwrap, fakeCwd);

check('strip removes /dev/null bind for non-existent .claude', !stripped.includes(`${fakeCwd}/.claude`));
check('strip removes /dev/null bind for non-existent .gitconfig', !stripped.includes(`${fakeCwd}/.gitconfig`));
check('strip preserves real system bind /usr', stripped.includes('--ro-bind /usr /usr'));

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
