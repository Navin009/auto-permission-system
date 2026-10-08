// Layer 2 URL gate contract (src/l2-guard/url.ts, ADR-023): deniedDomains is
// the hard-deny tier, kept separate from the ask-able "not in allowlist"
// reason so the guard can refuse without a prompt. No pi, no fs.
import { deniedUrlReason, isAllowedUrl } from '../../../src/l2-guard/url.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, '→', JSON.stringify(cond)); } };

const policy = {
	network: { allowedDomains: ['github.com', '*.github.com'], deniedDomains: ['evil.com', '*.blocked.com'] },
	overrides: { allowDomains: ['extra.com'] },
};

check('denied exact', deniedUrlReason('https://evil.com/x', policy) === 'denied domain: evil.com');
check('denied wildcard', deniedUrlReason('https://sub.blocked.com/a', policy) === 'denied domain: sub.blocked.com');
check('denied case-folded', deniedUrlReason('https://EVIL.com', policy) === 'denied domain: evil.com');
check('allowed host is not denied', deniedUrlReason('https://github.com', policy) === null);
check('unknown host is not denied', deniedUrlReason('https://unknown.com', policy) === null);
check('invalid url is not denied', deniedUrlReason('not-a-url', policy) === null);

check('isAllowedUrl reports the deny', isAllowedUrl('https://evil.com', policy) === 'denied domain: evil.com');
check('isAllowedUrl allows an allowlist host', isAllowedUrl('https://docs.github.com', policy) === null);
check('isAllowedUrl allows an override host', isAllowedUrl('https://extra.com/x', policy) === null);
check('isAllowedUrl asks for an unknown host', isAllowedUrl('https://unknown.com', policy) === 'domain not in allowlist: unknown.com');
check('isAllowedUrl rejects a non-URL', isAllowedUrl('not-a-url', policy) === 'not a valid URL: not-a-url');
check(
	'deny wins over an override',
	deniedUrlReason('https://evil.com', { network: { allowedDomains: [], deniedDomains: ['evil.com'] }, overrides: { allowDomains: ['evil.com'] } }) === 'denied domain: evil.com',
);

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
