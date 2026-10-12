import { symlinkSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { canonicalize } from '../../../src/shared/canonicalize.ts';

function expandHome(p){ if(p==='~') return homedir(); if(p.startsWith('~/')) return homedir()+'/'+p.slice(2); return p; }
function matchPrefix(absPath, pattern){
  const p = expandHome(pattern);
  return absPath===p || absPath.startsWith(p+'/');
}

const cwd = homedir() + '/.pi-tmp';
mkdirSync(cwd, { recursive: true });

const target = cwd + '/secret-target';
mkdirSync(target, { recursive: true });
writeFileSync(target + '/marker', 'secret');

const linkPath = cwd + '/escape-link';
try { rmSync(linkPath, { force:true }); } catch {}
symlinkSync(target, linkPath);

const cases = [
  [linkPath + '/marker', target, true, 'symlink → target, leaf exists'],
  [linkPath + '/nonexistent.txt', target, true, 'symlink → target, leaf nonexistent'],
  [linkPath + '/sub/deep/leaf', target, true, 'symlink → target, deep nonexistent'],
  [target + '/marker', target, true, 'direct hit'],
  [cwd + '/normal', target, false, 'unrelated path does not match'],
];
let p=0,f=0;
for (const [path,pattern,exp,label] of cases){
  const c = canonicalize(path, cwd);
  const got = matchPrefix(c, pattern);
  const ok = got===exp;
  console.log((ok?'PASS':'FAIL')+': '+label+'  ('+path+' → '+c+' vs '+pattern+' → '+got+')');
  ok?p++:f++;
}
try { rmSync(linkPath, { force:true }); } catch {}
try { rmSync(target, { recursive:true, force:true }); } catch {}
console.log('---','PASS='+p,'FAIL='+f);
process.exit(f?1:0);
