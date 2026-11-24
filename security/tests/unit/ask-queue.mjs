import { askQueued, askSelect } from "#ui/ask-flow.ts";

let pass = 0;
let fail = 0;
const check = (name, condition, extra = "") => {
	if (condition) pass++;
	else {
		fail++;
		console.log("FAIL:", name, "→", extra);
	}
};

const order = [];
let releaseFirst;
const firstGate = new Promise((resolve) => {
	releaseFirst = resolve;
});

const ctx = {
	hasUI: true,
	mode: "rpc",
	ui: {
		select: async (title) => {
			order.push(`start:${title}`);
			if (title === "first") await firstGate;
			order.push(`end:${title}`);
			return undefined;
		},
	},
};

const first = askQueued(ctx, "first", ["yes", "no"]);
const second = askSelect(ctx, "second", ["yes", "no"], 0);

await new Promise((resolve) => setTimeout(resolve, 20));
check("the second ask waits for the first", order.join(",") === "start:first", order.join(","));

releaseFirst();
await first;
await second;

check("the asks run in order", order.join(",") === "start:first,end:first,start:second,end:second", order.join(","));

const chainedOrder = [];
const chainedCtx = {
	hasUI: true,
	mode: "rpc",
	ui: { select: async (title) => { chainedOrder.push(title); return undefined; } },
};

await Promise.all([
	askQueued(chainedCtx, "a", ["1"], 0),
	askQueued(chainedCtx, "b", ["1"], 0),
	askQueued(chainedCtx, "c", ["1"], 0),
]);

check("three queued asks keep their order", chainedOrder.join(",") === "a,b,c", chainedOrder.join(","));

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
