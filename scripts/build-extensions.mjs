#!/usr/bin/env node
/**
 * Build all SproutAI extensions that emit dist/ artifacts.
 *
 * Usage (from repo root):
 *   node scripts/build-extensions.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const extensionsRoot = join(repoRoot, "..", "sproutai-extension");

const extensions = [
	// New esbuild bundles (shared build-extension.mjs)
	"status-line",
	"tips",
	"token-calendar",
	"context-debug",
	"prompt-inject",
	"tps",
	"redraws",
	"tool-mode",
	// Existing esbuild bundles
	"claude-tools",
	"pi-fff",
	"pi-hashline-edit",
	"pi-mcp-adapter",
	"pi-tool-timeout",
	// tsc → dist
	"pi-context-view",
];

function runBuild(name) {
	const dir = join(extensionsRoot, name);
	const pkgPath = join(dir, "package.json");
	if (!existsSync(pkgPath)) {
		console.error(`[build-extensions] skip ${name}: no package.json`);
		return false;
	}
	console.log(`\n=== ${name} ===`);
	const result = spawnSync("npm", ["run", "build"], {
		cwd: dir,
		stdio: "inherit",
		shell: process.platform === "win32",
	});
	if (result.status !== 0) {
		console.error(`[build-extensions] FAILED: ${name}`);
		return false;
	}
	const distJs = join(dir, "dist", "index.js");
	if (!existsSync(distJs)) {
		console.error(`[build-extensions] missing dist/index.js: ${name}`);
		return false;
	}
	return true;
}

let failed = 0;
for (const name of extensions) {
	if (!runBuild(name)) {
		failed++;
	}
}

if (failed > 0) {
	console.error(`\n[build-extensions] ${failed} extension(s) failed`);
	process.exit(1);
}

console.log(`\n[build-extensions] all ${extensions.length} extensions built`);
