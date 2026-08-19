#!/usr/bin/env node
/**
 * Convert root logo.png → logo.ico (multi-size Windows icon).
 *
 * Usage (from repo root):
 *   node scripts/make-logo-ico.mjs
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const pngPath = path.join(root, "logo.png");
const icoPath = path.join(root, "logo.ico");
const toolsDir = path.join(__dirname, ".ico-tools");
const sizes = [16, 24, 32, 48, 64, 128, 256];

async function main() {
	if (!fs.existsSync(pngPath)) {
		throw new Error(`Missing ${pngPath}`);
	}

	fs.mkdirSync(toolsDir, { recursive: true });
	const pkgJson = path.join(toolsDir, "package.json");
	if (!fs.existsSync(pkgJson)) {
		fs.writeFileSync(pkgJson, JSON.stringify({ private: true }));
	}
	const resolveCjs = path.join(toolsDir, "resolve.cjs");
	if (!fs.existsSync(resolveCjs)) {
		fs.writeFileSync(resolveCjs, "module.exports = require;\n");
	}

	const requireFromTools = createRequire(resolveCjs);
	const load = () => {
		const sharp = requireFromTools("sharp");
		const pngToIco = requireFromTools("png-to-ico").default;
		return { sharp, pngToIco };
	};

	let tools;
	try {
		tools = load();
	} catch {
		console.log("Installing sharp + png-to-ico...");
		const result = spawnSync(
			"npm",
			["install", "--no-save", "--no-package-lock", "sharp", "png-to-ico"],
			{ cwd: toolsDir, stdio: "inherit", shell: process.platform === "win32" },
		);
		if (result.status !== 0) throw new Error("Failed to install icon tools");
		tools = load();
	}

	const { sharp, pngToIco } = tools;
	const pngBuffers = [];
	for (const size of sizes) {
		const buf = await sharp(pngPath)
			.resize(size, size, {
				fit: "contain",
				background: { r: 0, g: 0, b: 0, alpha: 1 },
			})
			.png()
			.toBuffer();
		pngBuffers.push(buf);
	}

	const ico = await pngToIco(pngBuffers);
	fs.writeFileSync(icoPath, ico);
	console.log(`Wrote ${icoPath} (${ico.length} bytes, sizes: ${sizes.join(",")})`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
