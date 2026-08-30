#!/usr/bin/env bun
/**
 * Compatibility shim — prefer from monorepo root:
 *   bun build.ts core
 *   bun build.ts core --skip-build
 *   bun build.ts core --out <dir>
 *
 * Or from this package:
 *   bun ../build.ts core
 *   bun build.ts   (sproutai-core/build.ts wrapper)
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
