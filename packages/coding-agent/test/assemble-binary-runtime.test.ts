import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, test } from "vitest";
import { isCompileOutputDir, PackageRoot, writeRuntimePackageJson } from "../scripts/assemble-binary-runtime.mjs";

let tempDir: string | undefined;

afterEach(() => {
	if (tempDir) {
		rmSync(tempDir, { recursive: true, force: true });
		tempDir = undefined;
	}
});

describe("assembleBinaryRuntime package.json", () => {
	test("does not treat the TypeScript outDir as a binary runtime directory", () => {
		expect(isCompileOutputDir(join(PackageRoot, "dist"))).toBe(true);
		expect(isCompileOutputDir(join(PackageRoot, "..", "..", "dist"))).toBe(false);
	});

	test("writes slim package.json only outside the TypeScript outDir", () => {
		tempDir = mkdtempSync(join(tmpdir(), "pi-assemble-pkg-"));
		writeRuntimePackageJson(tempDir);
		expect(existsSync(join(tempDir, "package.json"))).toBe(true);
		const pkg = JSON.parse(readFileSync(join(tempDir, "package.json"), "utf8"));
		expect(pkg.piConfig).toEqual({ name: "sproutai", configDir: ".sproutai" });
		expect(pkg.main).toBeUndefined();
		expect(pkg.bin).toBeUndefined();
		expect(pkg.scripts).toBeUndefined();
	});
});
