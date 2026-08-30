#!/usr/bin/env bun
/**
 * Thin wrapper → monorepo unified build for sproutai-core host binary.
 *
 *   bun build.ts
 *   bun build.ts --skip-build
 *   bun build.ts --cross
 *   bun build.ts --out <dir>
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const rootBuild = path.join(here, "..", "build.ts");
const result = spawnSync("bun", [rootBuild, "core", ...process.argv.slice(2)], {
	cwd: path.join(here, ".."),
	stdio: "inherit",
	shell: process.platform === "win32",
});
process.exit(result.status == null ? 1 : result.status);
