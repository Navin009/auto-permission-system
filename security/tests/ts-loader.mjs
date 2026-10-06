import { register } from "node:module";
import { pathToFileURL } from "node:url";

/**
 * Registers the extensionless relative-import resolver for the unit tests.
 * Used as `node --import ./security/tests/ts-loader.mjs <test.mjs>`.
 */
register("./ts-hooks.mjs", pathToFileURL(`${import.meta.dirname}/`));
