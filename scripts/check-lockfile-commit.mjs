#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const allowValue = process.env.PI_ALLOW_LOCKFILE_CHANGE;
const allowed = allowValue === "1" || allowValue === "true" || allowValue === "yes";

function git(args) {
	return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

const stagedFiles = git(["diff", "--cached", "--name-only"])
	.split("\n")
	.map((line) => line.trim())
	.filter(Boolean);

if (!stagedFiles.includes("bun.lock")) {
	process.exit(0);
}

if (allowed) {
	console.error("bun.lock is staged; PI_ALLOW_LOCKFILE_CHANGE is set, allowing commit.");
	process.exit(0);
}

console.error("bun.lock is staged.");
console.error("");
console.error("Review lockfile changes before committing.");
console.error("If this lockfile change is intentional, commit with:");
console.error("  PI_ALLOW_LOCKFILE_CHANGE=1 git commit ...");
process.exit(1);
