#!/usr/bin/env node
/**
 * Build a flat standalone binary runtime (like release/sproutai/sproutai-core).
 *
 * Layout:
 *   sproutai.exe | sproutai
 *   package.json, photon_rs_bg.wasm, theme/, export-html/, native/, …
 *   (lean release: no assets/, docs/, examples/, README.md, .sproutai/)
 *
 * Usage (from sproutai-core root):
 *   bun run build:binary
 *   node scripts/build-release-binary.mjs
 *   node scripts/build-release-binary.mjs --skip-build
 *   node scripts/build-release-binary.mjs --out D:/path/to/sproutai-core
 *
 * Default --out: <sproutai-core>/dist
 *
 * Notes:
 *   Default package build skips regenerating models.generated.ts from the network.
 *   Use `bun run build:fresh` when you need an updated model catalog.
 *   Compile uses --minify to shrink the embedded JS. Avoid --bytecode here: it roughly
 *   doubles startup speed but adds tens of MB to the release binary.
 */
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	rmSync,
	statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CoreRoot = path.resolve(__dirname, "..");
const CodingAgentPkg = path.join(CoreRoot, "packages", "coding-agent");
const DefaultOut = path.join(CoreRoot, "dist");

/** Keep local overrides when rebuilding into an existing folder. */
const PRESERVE_NAMES = new Set([
	".web3cryptoagent",
	".websearchagent",
	"package.jsonc",
]);

function hostPlatform() {
	if (process.platform === "win32") {
		return process.arch === "arm64" ? "windows-arm64" : "windows-x64";
	}
	if (process.platform === "darwin") {
		return process.arch === "arm64" ? "darwin-arm64" : "darwin-x64";
	}
	if (process.platform === "linux") {
		return process.arch === "arm64" ? "linux-arm64" : "linux-x64";
	}
	throw new Error(`Unsupported host platform: ${process.platform} ${process.arch}`);
}

function bunTarget(platform) {
	return `bun-${platform}`;
}

function binaryName(platform) {
	return platform.startsWith("windows-") ? "sproutai.exe" : "sproutai";
}

function parseArgs(argv) {
	let outDir = DefaultOut;
	let skipBuild = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--skip-build") {
			skipBuild = true;
			continue;
		}
		if (arg === "--out") {
			const value = argv[++i];
			if (!value) throw new Error("--out requires a path");
			outDir = path.resolve(value);
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			console.log(`Usage:
  node scripts/build-release-binary.mjs [--skip-build] [--out <dir>]

Default output: ${DefaultOut}
`);
			process.exit(0);
		}
		throw new Error(`Unknown option: ${arg}`);
	}
	return { outDir, skipBuild };
}

function run(label, cwd, command, args, env = process.env) {
	console.log(`\n==> ${label}`);
	console.log(`    ${command} ${args.join(" ")}`);
	const result = spawnSync(command, args, {
		cwd,
		env,
		stdio: "inherit",
		shell: process.platform === "win32",
	});
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(`${label} failed with exit code ${result.status ?? 1}`);
	}
}

function commandExists(bin) {
	const lookup = process.platform === "win32" ? "where" : "which";
	const result = spawnSync(lookup, [bin], {
		encoding: "utf8",
		shell: false,
		stdio: "ignore",
	});
	return result.status === 0;
}

function ensureDir(dir) {
	mkdirSync(dir, { recursive: true });
}

/**
 * Remove previous runtime files but keep agent config dirs / package.jsonc.
 */
function cleanOutDir(outDir) {
	ensureDir(outDir);
	for (const name of readdirSync(outDir)) {
		if (PRESERVE_NAMES.has(name)) continue;
		const full = path.join(outDir, name);
		rmSync(full, { recursive: true, force: true });
	}
}

function main() {
	const { outDir, skipBuild } = parseArgs(process.argv.slice(2));
	const platform = hostPlatform();
	const binName = binaryName(platform);
	const bunCli = path.join(CodingAgentPkg, "dist", "bun", "cli.js");
	const assembleScript = path.join(
		CodingAgentPkg,
		"scripts",
		"assemble-binary-runtime.mjs",
	);

	console.log(`[build-release-binary] core: ${CoreRoot}`);
	console.log(`[build-release-binary] out:  ${outDir}`);
	console.log(`[build-release-binary] platform: ${platform}`);

	if (!commandExists("bun")) {
		throw new Error("Bun is required. Install: https://bun.sh");
	}

	if (!skipBuild) {
		run("bun run build (all packages)", CoreRoot, "bun", ["run", "build"]);
	} else {
		console.log("\n==> Skipping package build (--skip-build)");
	}

	if (!existsSync(bunCli)) {
		throw new Error(
			`Missing ${bunCli}\nRun without --skip-build, or run: bun run build`,
		);
	}
	if (!existsSync(assembleScript)) {
		throw new Error(`Missing assemble script: ${assembleScript}`);
	}

	cleanOutDir(outDir);

	const outfile = path.join(outDir, binName);
	const bunArgs = [
		"build",
		"--compile",
		`--target=${bunTarget(platform)}`,
		"--minify",
		"./dist/bun/cli.js",
		"./src/utils/image-resize-worker.ts",
		"--outfile",
		outfile,
	];

	// Embed Windows .exe icon when compiling natively on Windows.
	const iconPath = path.join(CoreRoot, "logo.ico");
	if (platform.startsWith("windows-")) {
		if (!existsSync(iconPath)) {
			throw new Error(
				`Missing Windows icon: ${iconPath}\nRun: node scripts/make-logo-ico.mjs`,
			);
		}
		bunArgs.push(`--windows-icon=${iconPath}`);
		bunArgs.push("--windows-title=SproutAI");
		bunArgs.push("--windows-description=SproutAI");
	}

	run(
		`bun compile ${platform} → ${binName}`,
		CodingAgentPkg,
		"bun",
		bunArgs,
	);

	run(
		"assemble binary runtime assets",
		CodingAgentPkg,
		process.execPath,
		[assembleScript, outDir, "--platform", platform, "--mode", "release"],
	);

	// Sanity check
	if (!existsSync(outfile)) {
		throw new Error(`Binary missing after build: ${outfile}`);
	}
	const sizeMb = (statSync(outfile).size / (1024 * 1024)).toFixed(1);
	console.log(`\n[ok] Release binary ready:`);
	console.log(`     ${outfile} (${sizeMb} MB)`);
	console.log(`     lean runtime assembled beside the binary (no assets/docs/README/.sproutai)`);
}

try {
	main();
} catch (error) {
	console.error(`\n[fail] ${error instanceof Error ? error.message : error}`);
	process.exit(1);
}
