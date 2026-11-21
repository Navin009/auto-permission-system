import {
	TOOL_OUTPUT_DEFAULT_MAX_BYTES,
	TOOL_OUTPUT_HARD_MAX_BYTES,
} from "../../../src/detect/tool-output-scanner/constants.ts";
import { clampLimit, estimateSize } from "../../../src/detect/tool-output-scanner/size.ts";

let pass = 0;
let fail = 0;
const check = (name, condition, extra = "") => {
	if (condition) pass++;
	else {
		fail++;
		console.log("FAIL:", name, "→", extra);
	}
};

const limit = 64 * 1024;
const multibytePayload = "é".repeat(40000);
const multibyteBytes = 80000;

check("the string path measures UTF-8 bytes", estimateSize(multibytePayload, limit).bytes === multibyteBytes, String(estimateSize(multibytePayload, limit).bytes));
check("a multibyte payload over the limit is rejected", estimateSize(multibytePayload, limit).exceeded === true);
check("an ascii payload keeps its length", estimateSize("a".repeat(10), limit).bytes === 10);
check("an ascii payload under the limit is exact", estimateSize("a".repeat(10), limit).exact === true);

const structured = estimateSize([multibytePayload], limit);

check("the structure path rejects the same multibyte payload", structured.exceeded === true, JSON.stringify(structured));
check("the structure path counts bytes, not code units", structured.bytes >= multibyteBytes, String(structured.bytes));
check("a small structure carries its field overhead", estimateSize({ key: "value" }, limit).bytes > "value".length);
check("an oversized structure is rejected", estimateSize({ payload: multibytePayload }, 1024).exceeded === true);

check("clampLimit floors at one byte", clampLimit(0) === 1);
check("clampLimit caps at the hard maximum", clampLimit(Number.MAX_SAFE_INTEGER) === TOOL_OUTPUT_HARD_MAX_BYTES);
check("clampLimit defaults to the scan limit", clampLimit(undefined) === TOOL_OUTPUT_DEFAULT_MAX_BYTES);
check("clampLimit keeps a value inside the range", clampLimit(2048) === 2048);

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
