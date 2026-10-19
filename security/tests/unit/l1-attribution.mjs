// Layer 1 violation attribution: which path was refused, whether it was a denyRead,
// and which folders may be offered as a write grant. Imports the real lib.
import { extractBlockedPath, extractLoopbackEndpoint, isBlockedAccessError, isLoopbackConnectionRefused, isSafeFolderGrant, isWriteBlockError, matchesPolicyPattern, toSandboxPatterns } from '../../../src/core/index.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };
const cwd = '/private/tmp/pi-guard-test', home = '/Users/me';
const x = (out) => extractBlockedPath(out, cwd, home);

check('relative ./ path resolves against cwd, not /', x('grep: ./.env: Operation not permitted') === '/private/tmp/pi-guard-test/.env');
check('bare relative name', x("touch: cannot touch 'x.pem': Operation not permitted") === '/private/tmp/pi-guard-test/x.pem');
check('nested relative', x('cat: sub/x.pem: Operation not permitted') === '/private/tmp/pi-guard-test/sub/x.pem');
check('absolute path', x('cat: /Users/me/.ssh/id_ed25519: Operation not permitted') === '/Users/me/.ssh/id_ed25519');
check('~ path', x('ls: ~/.gnupg: Operation not permitted') === '/Users/me/.gnupg');
check('quoted absolute', x("rm: cannot remove '/etc/hosts': Operation not permitted") === '/etc/hosts');
check('bash redirect', x('bash: x.pem: Operation not permitted') === '/private/tmp/pi-guard-test/x.pem');
check('.. segments normalised', x('cat: ../other/.env: Operation not permitted') === '/private/tmp/other/.env');
check('last EPERM line wins', x('grep: ./a: Operation not permitted\ngrep: ./b.key: Operation not permitted') === '/private/tmp/pi-guard-test/b.key');
check('EACCES variant', x('open ./secret.txt: EACCES') === '/private/tmp/pi-guard-test/secret.txt');
check('no error, no path', x('all good') === undefined);

check('unquoted path with a space keeps the whole path', x("open /home/me/.config/google-chrome/Crash Reports/new/abc.dmp: Read-only file system (30)") === '/home/me/.config/google-chrome/Crash Reports/new/abc.dmp');
check('pid-prefixed errno line keeps the whole path', x("[1011/234914:ERROR:crashpad.cc:153] open /home/me/.config/google-chrome/Crash Reports/new/abc.dmp: Read-only file system (30)") === '/home/me/.config/google-chrome/Crash Reports/new/abc.dmp');
check('operation word "socket" is not a path', x('Failed to open socket: Operation not permitted') === undefined);
check('operation word "display" is not a path', x('Failed to connect to Wayland display: Operation not permitted') === undefined);
check('a sentence before the errno is not a path', x('Check failed: . socket() failed: Operation not permitted (1)') === undefined);
check('a pid-prefixed sentence is not a path', x('[4:4:1011:FATAL:process_singleton.cc:297] Check failed: . socket() failed: Operation not permitted (1)') === undefined);
check('bwrap mount-setup line recovers the masked path', x("bwrap: Can't create file /private/tmp/pi-guard-test/.claude/agents: Read-only file system") === '/private/tmp/pi-guard-test/.claude/agents');

check('EROFS: Node-prefixed errno style', x("Could not update /home/me/.pi/agent/mcp.json: EROFS: read-only file system, open '/home/me/.pi/agent/mcp.json'") === '/home/me/.pi/agent/mcp.json');
check('EROFS: bare errno style', x("EROFS: read-only file system, open '/var/lib/x' ") === '/var/lib/x');
check('EROFS: coreutils style', x("touch: cannot touch '/etc/conf': Read-only file system") === '/etc/conf');
check('EROFS: Python errno style', x("[Errno 30] Read-only file system: '/srv/data'") === '/srv/data');
check('EROFS: Go unquoted style', x('open /srv/data: read-only file system') === '/srv/data');
check('EROFS: quoted relative operand', x("open 'sub/cfg.yml': Read-only file system") === '/private/tmp/pi-guard-test/sub/cfg.yml');
check('EROFS: last blocked line wins', x("touch: cannot touch 'a': Read-only file system\ntouch: cannot touch 'b': Read-only file system") === '/private/tmp/pi-guard-test/b');

check('blocked-access regex sees EROFS', isBlockedAccessError("EROFS: read-only file system, open '/x'") === true);
check('blocked-access regex sees EPERM', isBlockedAccessError('rm: /x: Operation not permitted') === true);
check('blocked-access regex ignores clean output', isBlockedAccessError('all good') === false);
check('write-block regex sees EROFS', isWriteBlockError("EROFS: read-only file system, open '/x'") === true);
check('write-block regex does not claim EPERM', isWriteBlockError('rm: /x: Operation not permitted') === false);

// Loopback / localhost connection refusal checks
check('loopback regex sees Diffusion Studio not running', isLoopbackConnectionRefused('Diffusion Studio is not running. Launch the app first, then retry.') === true);
check('loopback regex sees curl 127.0.0.1', isLoopbackConnectionRefused('curl: (7) Failed to connect to 127.0.0.1 port 3274 after 0 ms: Could not connect to server') === true);
check('loopback regex sees curl localhost', isLoopbackConnectionRefused('curl: (7) Failed to connect to localhost port 3000: Connection refused') === true);
check('loopback regex sees ECONNREFUSED 127.0.0.1', isLoopbackConnectionRefused('connect ECONNREFUSED 127.0.0.1:3274') === true);
check('loopback regex sees ECONNREFUSED ::1', isLoopbackConnectionRefused('Error: connect ECONNREFUSED ::1:8080') === true);
check('loopback regex ignores clean output', isLoopbackConnectionRefused('all good') === false);
check('loopback regex ignores normal error', isLoopbackConnectionRefused('cat: file not found') === false);

const epDiffusion = extractLoopbackEndpoint('Diffusion Studio is not running. Launch the app first, then retry.', 'dapi ctx');
check('extractLoopbackEndpoint identifies Diffusion Studio', epDiffusion?.host === '127.0.0.1' && epDiffusion?.port === '3274' && epDiffusion?.service === 'Diffusion Studio');

const epCurl = extractLoopbackEndpoint('curl: (7) Failed to connect to 127.0.0.1 port 3274 after 0 ms: Could not connect to server', 'curl http://127.0.0.1:3274/');
check('extractLoopbackEndpoint parses curl 127.0.0.1 port 3274', epCurl?.host === '127.0.0.1' && epCurl?.port === '3274' && epCurl?.service === 'Diffusion Studio');

const epLocalhost = extractLoopbackEndpoint('curl: (7) Failed to connect to localhost port 3000: Connection refused', 'curl http://localhost:3000');
check('extractLoopbackEndpoint parses localhost port 3000', epLocalhost?.host === 'localhost' && epLocalhost?.port === '3000' && epLocalhost?.service === undefined);

const epNode = extractLoopbackEndpoint('connect ECONNREFUSED 127.0.0.1:8080');
check('extractLoopbackEndpoint parses node ECONNREFUSED', epNode?.host === '127.0.0.1' && epNode?.port === '8080');

check('/ is never a folder grant', !isSafeFolderGrant('/', home));
check('home is never a folder grant', !isSafeFolderGrant('/Users/me', home));
check('above home is never a folder grant', !isSafeFolderGrant('/Users', home));
check('project folder is a fine grant', isSafeFolderGrant('/private/tmp/pi-guard-test', home));
check('folder inside home is a fine grant', isSafeFolderGrant('/Users/me/.cache/tool', home));

const m = (abs, pat) => matchesPolicyPattern(abs, pat, cwd, home);
check('basename .env', m('/private/tmp/pi-guard-test/.env', '.env'));
check('basename .env does not match .env.example', !m('/private/tmp/pi-guard-test/.env.example', '.env'));
check('glob .env.*', m('/private/tmp/pi-guard-test/.env.local', '.env.*'));
check('~ prefix', m('/Users/me/.ssh/id_ed25519', '~/.ssh'));
check('~ prefix is not a string prefix', !m('/Users/me/.sshfoo', '~/.ssh'));
check('absolute glob', m('/Users/me/.pi/agent/extensions/x.ts', '~/.pi/agent/extensions/**'));
check('. is the project root', m('/private/tmp/pi-guard-test/a/b', '.'));
check('*.pem basename glob', m('/private/tmp/pi-guard-test/sub/x.pem', '*.pem'));

const t = toSandboxPatterns(['.env', '*.key', '.', '~/.ssh', '/etc/x', 'config/app.yml', '~/.pi/agent/extensions/**']);
check('file name gets **/', t[0] === '**/.env' && t[1] === '**/*.key');
check('. stays', t[2] === '.');
check('~ and absolute stay', t[3] === '~/.ssh' && t[4] === '/etc/x');
check('relative path with / stays', t[5] === 'config/app.yml');
check('globbed path stays', t[6] === '~/.pi/agent/extensions/**');

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
