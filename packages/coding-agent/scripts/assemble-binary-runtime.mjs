#!/usr/bin/env node
/**
 * Assemble standalone binary runtime assets next to pi / pi.exe.
 *
 * Bun embeds the JS bundle into pi[.exe]; only a few side-files must sit
 * next to the executable at runtime. docs/examples/README/CHANGELOG/assets
 * are NOT required to run — they are only for --mode full (upstream-style full ship).
 *
 * Usage (from packages/coding-agent):
 *   node scripts/assemble-binary-runtime.mjs [targetDir] [--platform <name>] [--mode release|full]
 *
 * Default targetDir: ./dist
 * Default platform: host
 * Default mode: release  (lean runtime only)
 *
 * release layout (next to sproutai.exe):
 *   package.json, photon_rs_bg.wasm, theme/, export-html/
 *   node_modules/@mariozechner/clipboard* , native/...
 *
 * full mode additionally copies assets/, docs/, examples/, README.md
 */
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
	readFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PackageRoot = path.resolve(__dirname, "..");
const MonoRoot = path.resolve(PackageRoot, "../..");

const PLATFORMS = new Set([
	"darwin-arm64",
	"darwin-x64",
	"linux-x64",
	"linux-arm64",
	"windows-x64",
	"windows-arm64",
]);

const MODES = new Set(["release", "full"]);

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

function parseArgs(argv) {
	let targetDir = path.join(PackageRoot, "dist");
	let platform = hostPlatform();
	let mode = "release";
	const positional = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--platform") {
			const value = argv[++i];
			if (!value || !PLATFORMS.has(value)) {
				throw new Error(
					`--platform requires one of: ${[...PLATFORMS].join(", ")}`,
				);
			}
			platform = value;
			continue;
		}
		if (arg === "--mode") {
			const value = argv[++i];
			if (!value || !MODES.has(value)) {
				throw new Error(`--mode requires one of: ${[...MODES].join(", ")}`);
			}
			mode = value;
			continue;
		}
		if (arg.startsWith("-")) {
			throw new Error(`Unknown option: ${arg}`);
		}
		positional.push(arg);
	}
	if (positional[0]) {
		targetDir = path.resolve(positional[0]);
	}
	return { targetDir, platform, mode };
}

function ensureDir(dir) {
	mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
	if (!existsSync(src)) {
		throw new Error(`Missing required file: ${src}`);
	}
	ensureDir(path.dirname(dest));
	cpSync(src, dest);
}

function copyTree(src, dest) {
	if (!existsSync(src)) {
		throw new Error(`Missing required directory: ${src}`);
	}
	ensureDir(path.dirname(dest));
	cpSync(src, dest, { recursive: true, force: true });
}

function clipboardNativePackage(platform) {
	switch (platform) {
		case "darwin-arm64":
			return "clipboard-darwin-arm64";
		case "darwin-x64":
			return "clipboard-darwin-x64";
		case "linux-x64":
			return "clipboard-linux-x64-gnu";
		case "linux-arm64":
			return "clipboard-linux-arm64-gnu";
		case "windows-x64":
			return "clipboard-win32-x64-msvc";
		case "windows-arm64":
			return "clipboard-win32-arm64-msvc";
		default:
			throw new Error(`Unknown platform: ${platform}`);
	}
}

export function isCompileOutputDir(targetDir) {
	return path.resolve(targetDir) === path.resolve(PackageRoot, "dist");
}

function isRuntimeSlimPackageJson(pkg) {
	return Boolean(pkg?.piConfig && typeof pkg.piConfig === "object" && !pkg.main && !pkg.bin && !pkg.scripts);
}

/**
 * Write a slim package.json with only fields the binary needs at runtime.
 * Avoids shipping scripts/devDependencies from the monorepo package.json.
 * Never write this into the TypeScript compile output (packages/coding-agent/dist),
 * or Node getPackageDir() treats dist/ as the package root and theme paths break.
 */
export function writeRuntimePackageJson(targetDir) {
	if (isCompileOutputDir(targetDir)) {
		const existing = path.join(targetDir, "package.json");
		if (existsSync(existing)) {
			try {
				const pkg = JSON.parse(readFileSync(existing, "utf8"));
				if (isRuntimeSlimPackageJson(pkg)) {
					rmSync(existing, { force: true });
				}
			} catch {
				// Leave a non-slim package.json alone.
			}
		}
		return;
	}
	const full = JSON.parse(
		readFileSync(path.join(PackageRoot, "package.json"), "utf8"),
	);
	const slim = {
		name: full.name,
		version: full.version,
		description: full.description,
		type: full.type,
		piConfig: full.piConfig,
	};
	writeFileSync(
		path.join(targetDir, "package.json"),
		`${JSON.stringify(slim, null, "\t")}\n`,
		"utf8",
	);
}

/**
 * Copy shared + platform-specific runtime files into targetDir (next to pi binary).
 * @param {string} targetDir
 * @param {string} platform
 * @param {"release"|"full"} [mode="release"]
 */
export function assembleBinaryRuntime(targetDir, platform, mode = "release") {
	if (!PLATFORMS.has(platform)) {
		throw new Error(`Invalid platform: ${platform}`);
	}
	if (!MODES.has(mode)) {
		throw new Error(`Invalid mode: ${mode}`);
	}
	ensureDir(targetDir);

	// --- required for correct app identity (sproutai / .sproutai) ---
	writeRuntimePackageJson(targetDir);

	// --- image tooling (loaded next to execPath) ---
	const wasmSrc = path.join(
		MonoRoot,
		"node_modules",
		"@silvia-odwyer",
		"photon-node",
		"photon_rs_bg.wasm",
	);
	copyFile(wasmSrc, path.join(targetDir, "photon_rs_bg.wasm"));

	// --- TUI themes ---
	const themeDest = path.join(targetDir, "theme");
	if (existsSync(themeDest)) rmSync(themeDest, { recursive: true, force: true });
	ensureDir(themeDest);
	for (const name of readdirSync(path.join(PackageRoot, "src/modes/interactive/theme"))) {
		if (!name.endsWith(".json")) continue;
		copyFile(
			path.join(PackageRoot, "src/modes/interactive/theme", name),
			path.join(themeDest, name),
		);
	}

	// --- interactive assets (optional mascot / images; full mode only) ---
	const assetsDest = path.join(targetDir, "assets");
	if (existsSync(assetsDest)) rmSync(assetsDest, { recursive: true, force: true });
	if (mode === "full") {
		ensureDir(assetsDest);
		const assetsSrc = path.join(PackageRoot, "src/modes/interactive/assets");
		if (existsSync(assetsSrc)) {
			for (const name of readdirSync(assetsSrc)) {
				const src = path.join(assetsSrc, name);
				if (statSync(src).isFile()) {
					copyFile(src, path.join(assetsDest, name));
				}
			}
		}
	}

	// --- session HTML export ---
	const exportHtmlDest = path.join(targetDir, "export-html");
	if (existsSync(exportHtmlDest)) {
		rmSync(exportHtmlDest, { recursive: true, force: true });
	}
	ensureDir(exportHtmlDest);
	copyFile(
		path.join(PackageRoot, "src/core/export-html/template.html"),
		path.join(exportHtmlDest, "template.html"),
	);
	const vendorSrc = path.join(PackageRoot, "src/core/export-html/vendor");
	const vendorDest = path.join(exportHtmlDest, "vendor");
	ensureDir(vendorDest);
	for (const name of readdirSync(vendorSrc)) {
		if (!name.endsWith(".js")) continue;
		copyFile(path.join(vendorSrc, name), path.join(vendorDest, name));
	}

	// --- optional natives (clipboard + terminal); only runtime files, not Rust sources ---
	const marioRoot = path.join(MonoRoot, "node_modules", "@mariozechner");
	const clipboardPkg = path.join(marioRoot, "clipboard");
	const nativeName = clipboardNativePackage(platform);
	const clipboardNative = path.join(marioRoot, nativeName);
	const nmMario = path.join(targetDir, "node_modules", "@mariozechner");
	if (existsSync(path.join(targetDir, "node_modules"))) {
		rmSync(path.join(targetDir, "node_modules"), { recursive: true, force: true });
	}
	if (existsSync(clipboardPkg)) {
		const dest = path.join(nmMario, "clipboard");
		ensureDir(dest);
		for (const name of ["package.json", "index.js", "index.d.ts"]) {
			const src = path.join(clipboardPkg, name);
			if (existsSync(src)) copyFile(src, path.join(dest, name));
		}
	}
	if (existsSync(clipboardNative)) {
		const dest = path.join(nmMario, nativeName);
		ensureDir(dest);
		copyFile(
			path.join(clipboardNative, "package.json"),
			path.join(dest, "package.json"),
		);
		for (const name of readdirSync(clipboardNative)) {
			if (name.endsWith(".node")) {
				copyFile(path.join(clipboardNative, name), path.join(dest, name));
			}
		}
	}

	const tuiNative = path.join(PackageRoot, "../tui/native");
	const nativeDestRoot = path.join(targetDir, "native");
	if (existsSync(nativeDestRoot)) {
		rmSync(nativeDestRoot, { recursive: true, force: true });
	}
	if (platform.startsWith("darwin-")) {
		const prebuild = path.join(
			tuiNative,
			"darwin/prebuilds",
			platform,
			"darwin-modifiers.node",
		);
		if (existsSync(prebuild)) {
			copyFile(
				prebuild,
				path.join(targetDir, "native/darwin/prebuilds", platform, "darwin-modifiers.node"),
			);
		}
	}
	if (platform.startsWith("windows-")) {
		const win32Arch = platform === "windows-arm64" ? "win32-arm64" : "win32-x64";
		const prebuild = path.join(
			tuiNative,
			"win32/prebuilds",
			win32Arch,
			"win32-console-mode.node",
		);
		if (existsSync(prebuild)) {
			copyFile(
				prebuild,
				path.join(
					targetDir,
					"native/win32/prebuilds",
					win32Arch,
					"win32-console-mode.node",
				),
			);
		}
	}

	// --- full mode only: docs / examples / README (NOT required to run) ---
	if (mode === "full") {
		const readme = path.join(PackageRoot, "README.md");
		if (existsSync(readme)) {
			copyFile(readme, path.join(targetDir, "README.md"));
		}
		const docsSrc = path.join(PackageRoot, "docs");
		if (existsSync(docsSrc)) {
			const docsDest = path.join(targetDir, "docs");
			if (existsSync(docsDest)) rmSync(docsDest, { recursive: true, force: true });
			copyTree(docsSrc, docsDest);
		}
		const examplesSrc = path.join(PackageRoot, "examples");
		if (existsSync(examplesSrc)) {
			const examplesDest = path.join(targetDir, "examples");
			if (existsSync(examplesDest)) rmSync(examplesDest, { recursive: true, force: true });
			copyTree(examplesSrc, examplesDest);
		}
	} else {
		// Ensure stale full-mode dirs are not left when re-assembling into same folder
		for (const name of ["docs", "examples", "README.md", "CHANGELOG.md", "assets"]) {
			const p = path.join(targetDir, name);
			if (existsSync(p)) {
				rmSync(p, { recursive: true, force: true });
			}
		}
	}
	// Never ship CHANGELOG.md
	const changelogDest = path.join(targetDir, "CHANGELOG.md");
	if (existsSync(changelogDest)) {
		rmSync(changelogDest, { force: true });
	}

	return { targetDir, platform, mode };
}

export { hostPlatform, PLATFORMS, PackageRoot, MonoRoot };

// Direct CLI: node scripts/assemble-binary-runtime.mjs
const isMain =
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	try {
		const { targetDir, platform, mode } = parseArgs(process.argv.slice(2));
		const result = assembleBinaryRuntime(targetDir, platform, mode);
		console.log(
			`[assemble-binary-runtime] ok → ${result.targetDir} (${result.platform}, mode=${result.mode})`,
		);
	} catch (err) {
		console.error(err?.stack || err);
		process.exit(1);
	}
}
