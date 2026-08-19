#!/usr/bin/env node
/**
 * Bump workspace package.json version fields without npm.
 *
 * Usage:
 *   node scripts/bump-workspace-version.mjs patch|minor|major
 *   node scripts/bump-workspace-version.mjs 1.2.3
 *
 * Updates the repo root and every workspace package.json listed in
 * the root workspaces field. Then run scripts/sync-versions.js and bun install.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv[2];
const BUMP_TYPES = new Set(["major", "minor", "patch"]);
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

if (!arg || (!BUMP_TYPES.has(arg) && !SEMVER_RE.test(arg))) {
	console.error("Usage: node scripts/bump-workspace-version.mjs <patch|minor|major|x.y.z>");
	process.exit(1);
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
	writeFileSync(path, `${JSON.stringify(data, null, "\t")}\n`);
}

function bumpSemver(version, kind) {
	const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
	if (!match) {
		throw new Error(`Not a semver: ${version} (${kind})`);
	}
	let major = Number(match[1]);
	let minor = Number(match[2]);
	let patch = Number(match[3]);
	if (kind === "major") {
		major += 1;
		minor = 0;
		patch = 0;
	} else if (kind === "minor") {
		minor += 1;
		patch = 0;
	} else {
		patch += 1;
	}
	return `${major}.${minor}.${patch}`;
}

function expandWorkspaces(workspaces) {
	const paths = [];
	for (const pattern of workspaces) {
		if (pattern.endsWith("/*")) {
			const parent = join(root, pattern.slice(0, -2));
			if (!existsSync(parent)) continue;
			for (const dirent of readdirSync(parent, { withFileTypes: true })) {
				if (!dirent.isDirectory()) continue;
				const pkgPath = join(parent, dirent.name, "package.json");
				if (existsSync(pkgPath)) paths.push(pkgPath);
			}
			continue;
		}
		const pkgPath = join(root, pattern, "package.json");
		if (existsSync(pkgPath)) paths.push(pkgPath);
	}
	return paths;
}

const rootPkgPath = join(root, "package.json");
const rootPkg = readJson(rootPkgPath);
const workspacePkgPaths = [rootPkgPath, ...expandWorkspaces(rootPkg.workspaces ?? [])];

for (const pkgPath of workspacePkgPaths) {
	const pkg = readJson(pkgPath);
	if (typeof pkg.version !== "string") continue;
	pkg.version = BUMP_TYPES.has(arg) ? bumpSemver(pkg.version, arg) : arg;
	writeJson(pkgPath, pkg);
	console.log(`${pkg.name ?? pkgPath}: ${pkg.version}`);
}
