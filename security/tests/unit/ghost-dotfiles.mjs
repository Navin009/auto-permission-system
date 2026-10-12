// Verify suppression of ghost dotfiles in memory (src/l1-sandbox/manager.ts).
import { suppressGhostDotfiles } from '../../../src/l1-sandbox/manager.ts';
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

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
