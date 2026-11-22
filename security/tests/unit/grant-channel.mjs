import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratchDirectory = mkdtempSync(join(tmpdir(), "pi-grant-channel-"));
process.env.PI_CODING_AGENT_DIR = join(scratchDirectory, "agent");

const { applyNetworkGrant, isGrantableHost } = await import("../../../src/l1-sandbox/manager.ts");

let pass = 0;
let fail = 0;
const check = (name, condition, extra = "") => {
	if (condition) pass++;
	else {
		fail++;
		console.log("FAIL:", name, "→", extra);
	}
};

check("an exact host is grantable", isGrantableHost("example.com"));
check("a wildcard group is grantable", isGrantableHost("*.example.com"));
check("an IPv4 literal is grantable", isGrantableHost("127.0.0.1"));
check("a bare wildcard is not grantable", isGrantableHost("*") === false);
check("an empty host is not grantable", isGrantableHost("") === false);
check("a host with a space is not grantable", isGrantableHost("exa mple.com") === false);
check("a double dot is not grantable", isGrantableHost("evil..com") === false);
check("a trailing dot is not grantable", isGrantableHost("example.com.") === false);

let threw = false;
try {
	applyNetworkGrant("*");
	applyNetworkGrant("exa mple.com");
} catch {
	threw = true;
}

check("refused hosts do not throw", threw === false);

rmSync(scratchDirectory, { recursive: true, force: true });

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
