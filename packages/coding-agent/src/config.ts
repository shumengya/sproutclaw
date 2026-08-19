import {
	accessSync,
	constants,
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "fs";
import { homedir } from "os";
import { basename, dirname, join, resolve, sep, win32 } from "path";
import { fileURLToPath } from "url";
import { spawnProcessSync } from "./utils/child-process.ts";
import { stripJsonComments } from "./utils/json.ts";
import { normalizePath } from "./utils/paths.ts";

// =============================================================================
// Package Detection
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Detect if we're running as a Bun compiled binary.
 * Bun binaries have import.meta.url containing "$bunfs", "~BUN", or "%7EBUN" (Bun's virtual filesystem path)
 */
export const isBunBinary =
	import.meta.url.includes("$bunfs") || import.meta.url.includes("~BUN") || import.meta.url.includes("%7EBUN");

/** Detect if Bun is the runtime (compiled binary or bun run) */
export const isBunRuntime = !!process.versions.bun;

// =============================================================================
// Install Method Detection
// =============================================================================

export type InstallMethod = "bun-binary" | "npm" | "pnpm" | "yarn" | "bun" | "unknown";

interface SelfUpdateCommandStep {
	command: string;
	args: string[];
	display: string;
}

export interface SelfUpdateCommand extends SelfUpdateCommandStep {
	steps?: SelfUpdateCommandStep[];
}

function makeSelfUpdateCommand(
	installStep: SelfUpdateCommandStep,
	uninstallStep?: SelfUpdateCommandStep,
): SelfUpdateCommand {
	if (!uninstallStep) return installStep;
	return {
		...installStep,
		display: `${uninstallStep.display} && ${installStep.display}`,
		steps: [uninstallStep, installStep],
	};
}

function makeSelfUpdateCommandStep(command: string, args: string[]): SelfUpdateCommandStep {
	return {
		command,
		args,
		display: [command, ...args].map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(" "),
	};
}

export function detectInstallMethod(): InstallMethod {
	if (isBunBinary) {
		return "bun-binary";
	}

	const resolvedPath = `${__dirname}\0${process.execPath || ""}`.toLowerCase().replace(/\\/g, "/");

	if (resolvedPath.includes("/pnpm/") || resolvedPath.includes("/.pnpm/")) {
		return "pnpm";
	}
	if (resolvedPath.includes("/yarn/") || resolvedPath.includes("/.yarn/")) {
		return "yarn";
	}
	if (isBunRuntime || resolvedPath.includes("/install/global/node_modules/")) {
		return "bun";
	}
	if (resolvedPath.includes("/npm/") || resolvedPath.includes("/node_modules/")) {
		return "npm";
	}

	return "unknown";
}

function getInferredNpmInstall(): { root: string; prefix: string } | undefined {
	const packageDir = getPackageDir();
	const path = process.platform === "win32" || packageDir.includes("\\") ? win32 : { basename, dirname };
	const parent = path.dirname(packageDir);
	let root: string | undefined;
	if (path.basename(parent).startsWith("@") && path.basename(path.dirname(parent)) === "node_modules") {
		root = path.dirname(parent);
	} else if (path.basename(parent) === "node_modules") {
		root = parent;
	}
	if (!root) return undefined;
	const rootParent = path.dirname(root);
	if (path.basename(rootParent) === "lib") return { root, prefix: path.dirname(rootParent) };
	// Windows global npm prefixes use `<prefix>\\node_modules`, which is
	// indistinguishable from local project installs by path shape alone. Do not
	// infer unsupported Windows custom prefixes without `npm root -g` evidence.
	return undefined;
}

function getSelfUpdateCommandForMethod(
	method: InstallMethod,
	installedPackageName: string,
	updatePackageName = installedPackageName,
	npmCommand?: string[],
): SelfUpdateCommand | undefined {
	switch (method) {
		case "bun-binary":
			return undefined;
		case "pnpm": {
			const match = readCommandOutput("pnpm", ["root", "-g"])
				? undefined
				: /^(.*[\\/]global[\\/][^\\/]+)[\\/]\.pnpm[\\/]/.exec(getPackageDir());
			const binDirArgs = match
				? [`--config.global-bin-dir=${process.env.PNPM_HOME || dirname(dirname(match[1]))}`]
				: [];
			return makeSelfUpdateCommand(
				makeSelfUpdateCommandStep("pnpm", [
					"install",
					"-g",
					"--ignore-scripts",
					"--config.minimumReleaseAge=0",
					...binDirArgs,
					updatePackageName,
				]),
				updatePackageName === installedPackageName
					? undefined
					: makeSelfUpdateCommandStep("pnpm", ["remove", "-g", ...binDirArgs, installedPackageName]),
			);
		}
		case "yarn":
			return makeSelfUpdateCommand(
				makeSelfUpdateCommandStep("yarn", ["global", "add", "--ignore-scripts", updatePackageName]),
				updatePackageName === installedPackageName
					? undefined
					: makeSelfUpdateCommandStep("yarn", ["global", "remove", installedPackageName]),
			);
		case "bun":
			return makeSelfUpdateCommand(
				makeSelfUpdateCommandStep("bun", [
					"install",
					"-g",
					"--ignore-scripts",
					"--minimum-release-age=0",
					updatePackageName,
				]),
				updatePackageName === installedPackageName
					? undefined
					: makeSelfUpdateCommandStep("bun", ["uninstall", "-g", installedPackageName]),
			);
		case "npm": {
			const [command = "npm", ...npmArgs] = npmCommand ?? [];
			const inferred = npmCommand?.length ? undefined : getInferredNpmInstall();
			const prefixArgs = [...npmArgs, ...(inferred ? ["--prefix", inferred.prefix] : [])];
			const installStep = makeSelfUpdateCommandStep(command, [
				...prefixArgs,
				"install",
				"-g",
				"--ignore-scripts",
				"--min-release-age=0",
				updatePackageName,
			]);
			const uninstallStep =
				updatePackageName === installedPackageName
					? undefined
					: makeSelfUpdateCommandStep(command, [...prefixArgs, "uninstall", "-g", installedPackageName]);
			return makeSelfUpdateCommand(installStep, uninstallStep);
		}
		case "unknown":
			return undefined;
	}
}

function readCommandOutput(
	command: string,
	args: string[],
	options: { requireSuccess?: boolean } = {},
): string | undefined {
	const result = spawnProcessSync(command, args, {
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (result.status === 0) return result.stdout.trim() || undefined;
	if (options.requireSuccess) {
		const reason = result.error?.message || result.stderr.trim() || `exit code ${result.status ?? "unknown"}`;
		throw new Error(`Failed to run ${[command, ...args].join(" ")}: ${reason}`);
	}
	return undefined;
}

function getGlobalPackageRoots(method: InstallMethod, _packageName: string, npmCommand?: string[]): string[] {
	switch (method) {
		case "npm": {
			const configured = !!npmCommand?.length;
			const [command = "npm", ...npmArgs] = npmCommand ?? [];
			if (configured && command === "bun") {
				const bunBin = readCommandOutput(command, [...npmArgs, "pm", "bin", "-g"], {
					requireSuccess: true,
				});
				const roots = [join(homedir(), ".bun", "install", "global", "node_modules")];
				if (bunBin) {
					roots.push(join(dirname(bunBin), "install", "global", "node_modules"));
				}
				return roots;
			}
			const root = readCommandOutput(command, [...npmArgs, "root", "-g"], {
				requireSuccess: configured,
			});
			const inferred = configured ? undefined : getInferredNpmInstall();
			return [root, inferred?.root].filter((x): x is string => !!x);
		}
		case "pnpm": {
			const root = readCommandOutput("pnpm", ["root", "-g"]);
			if (root) return [root, dirname(root)];
			const match = /^(.*[\\/]global[\\/][^\\/]+)[\\/]\.pnpm[\\/]/.exec(getPackageDir());
			return match ? [match[1]] : [];
		}
		case "yarn": {
			const dir = readCommandOutput("yarn", ["global", "dir"]);
			return dir ? [dir, join(dir, "node_modules")] : [];
		}
		case "bun": {
			const bunBin = readCommandOutput("bun", ["pm", "bin", "-g"]);
			const roots = [join(homedir(), ".bun", "install", "global", "node_modules")];
			if (bunBin) {
				roots.push(join(dirname(bunBin), "install", "global", "node_modules"));
			}
			return roots;
		}
		case "bun-binary":
		case "unknown":
			return [];
	}
}

function normalizeExistingPathForComparison(path: string, resolveSymlinks: boolean): string | undefined {
	const resolvedPath = resolve(path);
	if (!existsSync(resolvedPath)) {
		return undefined;
	}
	let normalizedPath = resolvedPath;
	if (resolveSymlinks) {
		try {
			normalizedPath = realpathSync(resolvedPath);
		} catch {
			return undefined;
		}
	}
	if (process.platform === "win32") {
		normalizedPath = normalizedPath.toLowerCase();
	}
	return normalizedPath;
}

function getPathComparisonCandidates(path: string): string[] {
	return Array.from(
		new Set(
			[normalizeExistingPathForComparison(path, false), normalizeExistingPathForComparison(path, true)].filter(
				(candidate): candidate is string => !!candidate,
			),
		),
	);
}

function getEntrypointPackageDir(): string | undefined {
	const entrypoint = process.argv[1];
	if (!entrypoint) return undefined;
	let dir = dirname(entrypoint);
	while (dir !== dirname(dir)) {
		if (existsSync(join(dir, "package.json"))) {
			return dir;
		}
		dir = dirname(dir);
	}
	return undefined;
}

function isSelfUpdatePathWritable(): boolean {
	const packageDir = getPackageDir();
	try {
		accessSync(packageDir, constants.W_OK);
		accessSync(dirname(packageDir), constants.W_OK);
		return true;
	} catch {
		return false;
	}
}

function isManagedByGlobalPackageManager(method: InstallMethod, packageName: string, npmCommand?: string[]): boolean {
	const packageDirs = [getPackageDir(), getEntrypointPackageDir()].filter((dir): dir is string => !!dir);
	const packageDirCandidates = packageDirs.flatMap((dir) => getPathComparisonCandidates(dir));
	return getGlobalPackageRoots(method, packageName, npmCommand).some((root) => {
		return getPathComparisonCandidates(root).some((normalizedRoot) => {
			const rootPrefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
			return packageDirCandidates.some((packageDir) => packageDir.startsWith(rootPrefix));
		});
	});
}

export function getSelfUpdateCommand(
	packageName: string,
	npmCommand?: string[],
	updatePackageName = packageName,
): SelfUpdateCommand | undefined {
	const method = detectInstallMethod();
	const command = getSelfUpdateCommandForMethod(method, packageName, updatePackageName, npmCommand);
	if (!command || !isManagedByGlobalPackageManager(method, packageName, npmCommand) || !isSelfUpdatePathWritable()) {
		return undefined;
	}
	return command;
}

export function getSelfUpdateUnavailableInstruction(
	packageName: string,
	npmCommand?: string[],
	updatePackageName = packageName,
): string {
	const method = detectInstallMethod();
	if (method === "bun-binary") {
		return `Download from: https://github.com/earendil-works/pi-mono/releases/latest`;
	}
	const command = getSelfUpdateCommandForMethod(method, packageName, updatePackageName, npmCommand);
	if (command) {
		if (isManagedByGlobalPackageManager(method, packageName, npmCommand) && !isSelfUpdatePathWritable()) {
			return `This installation is managed by a global ${method} install, but the install path is not writable. Update it yourself with: ${command.display}`;
		}
		return `This installation is not managed by a global ${method} install. Update it with the package manager, wrapper, or source checkout that provides it.`;
	}
	return `Update ${updatePackageName} using the package manager, wrapper, or source checkout that provides this installation.`;
}

export function getUpdateInstruction(packageName: string): string {
	const method = detectInstallMethod();
	const command = getSelfUpdateCommandForMethod(method, packageName);
	if (command) {
		return `Run: ${command.display}`;
	}
	return getSelfUpdateUnavailableInstruction(packageName);
}

// =============================================================================
// Package Asset Paths (shipped with executable)
// =============================================================================

/**
 * Slim runtime package.json written next to the compiled binary.
 * It has piConfig for app identity but no main/bin/scripts — unlike the real package root.
 */
export function isRuntimeSlimPackageJson(pkg: unknown): boolean {
	if (!pkg || typeof pkg !== "object") {
		return false;
	}
	const rec = pkg as Record<string, unknown>;
	if (!rec.piConfig || typeof rec.piConfig !== "object") {
		return false;
	}
	if (rec.main || rec.bin || rec.scripts) {
		return false;
	}
	return true;
}

function readPackageJsonIfPresent(dir: string): unknown | undefined {
	const packageJsonPath = join(dir, "package.json");
	if (!existsSync(packageJsonPath)) {
		return undefined;
	}
	try {
		return JSON.parse(readFileSync(packageJsonPath, "utf8"));
	} catch {
		return undefined;
	}
}

/**
 * Walk up from startDir until a real package.json is found, skipping slim runtime copies
 * that assembleBinaryRuntime writes next to the binary (and used to write into dist/).
 */
export function resolvePackageDirFrom(startDir: string): string {
	let dir = startDir;
	let fallback = startDir;
	while (dir !== dirname(dir)) {
		const pkg = readPackageJsonIfPresent(dir);
		if (pkg !== undefined) {
			if (!isRuntimeSlimPackageJson(pkg)) {
				return dir;
			}
			fallback = dir;
		}
		dir = dirname(dir);
	}
	return fallback;
}

/**
 * Get the base directory for resolving package assets (themes, package.json, README.md, CHANGELOG.md).
 * - For Bun binary: returns the directory containing the executable
 * - For Node.js (dist/): returns the package root (not dist/, even if a slim package.json is present)
 * - For tsx (src/): returns parent directory (the package root)
 */
export function getPackageDir(): string {
	// Allow override via environment variable (useful for Nix/Guix where store paths tokenize poorly)
	const envDir = process.env.PI_PACKAGE_DIR;
	if (envDir) {
		return normalizePath(envDir);
	}

	if (isBunBinary) {
		// Bun binary: process.execPath points to the compiled executable
		return dirname(process.execPath);
	}
	return resolvePackageDirFrom(__dirname);
}

/**
 * Get path to built-in themes directory (shipped with package)
 * - For Bun binary: theme/ next to executable
 * - For Node.js (dist/): dist/modes/interactive/theme/
 * - For tsx (src/): src/modes/interactive/theme/
 */
export function getThemesDir(): string {
	if (isBunBinary) {
		return join(getPackageDir(), "theme");
	}
	// Theme is in modes/interactive/theme/ relative to src/ or dist/
	const packageDir = getPackageDir();
	const srcOrDist = existsSync(join(packageDir, "src")) ? "src" : "dist";
	return join(packageDir, srcOrDist, "modes", "interactive", "theme");
}

/**
 * Get path to HTML export template directory (shipped with package)
 * - For Bun binary: export-html/ next to executable
 * - For Node.js (dist/): dist/core/export-html/
 * - For tsx (src/): src/core/export-html/
 */
export function getExportTemplateDir(): string {
	if (isBunBinary) {
		return join(getPackageDir(), "export-html");
	}
	const packageDir = getPackageDir();
	const srcOrDist = existsSync(join(packageDir, "src")) ? "src" : "dist";
	return join(packageDir, srcOrDist, "core", "export-html");
}

/** Get path to package.json */
export function getPackageJsonPath(): string {
	return join(getPackageDir(), "package.json");
}

/** Get path to README.md */
export function getReadmePath(): string {
	return resolve(join(getPackageDir(), "README.md"));
}

/** Get path to docs directory */
export function getDocsPath(): string {
	return resolve(join(getPackageDir(), "docs"));
}

/** Get path to examples directory */
export function getExamplesPath(): string {
	return resolve(join(getPackageDir(), "examples"));
}

/** Get path to CHANGELOG.md */
export function getChangelogPath(): string {
	return resolve(join(getPackageDir(), "CHANGELOG.md"));
}

/**
 * Get path to built-in interactive assets directory.
 * - For Bun binary: assets/ next to executable
 * - For Node.js (dist/): dist/modes/interactive/assets/
 * - For tsx (src/): src/modes/interactive/assets/
 */
export function getInteractiveAssetsDir(): string {
	if (isBunBinary) {
		return join(getPackageDir(), "assets");
	}
	const packageDir = getPackageDir();
	const srcOrDist = existsSync(join(packageDir, "src")) ? "src" : "dist";
	return join(packageDir, srcOrDist, "modes", "interactive", "assets");
}

/** Get path to a bundled interactive asset */
export function getBundledInteractiveAssetPath(name: string): string {
	return join(getInteractiveAssetsDir(), name);
}

// =============================================================================
// App Config (from package.json piConfig + optional config.jsonc profiles)
// =============================================================================

/** Multi-profile agent config file (next to package.json / binary). */
export const AGENT_PROFILES_FILENAME = "config.jsonc";
/** Legacy single-profile override; migrated into config.jsonc when present. */
export const LEGACY_ACTIVE_PI_CONFIG_FILENAME = "active-pi-config.json";

export interface PiConfigIdentity {
	name: string;
	configDir: string;
}

export interface AgentProfilesFile {
	"default-config": PiConfigIdentity;
	configs: PiConfigIdentity[];
}

interface PackageJson {
	name?: string;
	version?: string;
	piConfig?: {
		name?: string;
		configDir?: string;
	};
}

let pkg: PackageJson = {};
try {
	pkg = JSON.parse(readFileSync(getPackageJsonPath(), "utf-8")) as PackageJson;
} catch (e: unknown) {
	const err = e as NodeJS.ErrnoException;
	if (err.code !== "ENOENT") throw e;
}

/** Path to config.jsonc (agent profile list + default). */
export function getAgentProfilesPath(): string {
	return join(getPackageDir(), AGENT_PROFILES_FILENAME);
}

/**
 * Validate agent name + configDir for profile switching.
 * configDir must be a single directory segment (e.g. `.sproutai`), not a path.
 */
export function validatePiConfigIdentity(name: string, configDir: string): string | undefined {
	const trimmedName = name.trim();
	const trimmedDir = configDir.trim();
	if (!trimmedName) {
		return "agent 名字不能为空";
	}
	if (!trimmedDir) {
		return "配置目录不能为空";
	}
	if (trimmedName.length > 64) {
		return "agent 名字过长（最多 64 字符）";
	}
	if (trimmedDir.length > 64) {
		return "配置目录名过长（最多 64 字符）";
	}
	if (/[\\/]/.test(trimmedName) || trimmedName === "." || trimmedName === "..") {
		return "agent 名字不能包含路径分隔符";
	}
	if (/[\\/]/.test(trimmedDir) || trimmedDir === "." || trimmedDir === "..") {
		return "配置目录必须是单个目录名（如 .sproutai），不能是路径";
	}
	if (!/^[A-Za-z0-9][\w.-]*$/.test(trimmedName)) {
		return "agent 名字只能包含字母、数字、下划线、点、连字符，且以字母或数字开头";
	}
	if (!/^\.?[A-Za-z0-9][\w.-]*$/.test(trimmedDir)) {
		return "配置目录名格式无效（示例：.sproutai）";
	}
	return undefined;
}

function parsePiConfigIdentity(raw: unknown): PiConfigIdentity | undefined {
	if (!raw || typeof raw !== "object") {
		return undefined;
	}
	const obj = raw as Partial<PiConfigIdentity>;
	if (typeof obj.name !== "string" || typeof obj.configDir !== "string") {
		return undefined;
	}
	const error = validatePiConfigIdentity(obj.name, obj.configDir);
	if (error) {
		return undefined;
	}
	return { name: obj.name.trim(), configDir: obj.configDir.trim() };
}

function samePiConfigIdentity(a: PiConfigIdentity, b: PiConfigIdentity): boolean {
	return a.name === b.name && a.configDir === b.configDir;
}

function profileKey(identity: PiConfigIdentity): string {
	return `${identity.name}\0${identity.configDir}`;
}

/** Package.json defaults (bake-time identity). */
export function getPackagePiConfig(): PiConfigIdentity {
	return {
		name: pkg.piConfig?.name || "pi",
		configDir: pkg.piConfig?.configDir || ".pi",
	};
}

function createDefaultAgentProfilesFile(): AgentProfilesFile {
	return {
		"default-config": getPackagePiConfig(),
		configs: [],
	};
}

function serializeAgentProfilesFile(file: AgentProfilesFile): string {
	const payload = {
		"default-config": {
			name: file["default-config"].name,
			configDir: file["default-config"].configDir,
		},
		configs: file.configs.map((entry) => ({
			name: entry.name,
			configDir: entry.configDir,
		})),
	};
	return `${JSON.stringify(payload, null, "\t")}\n`;
}

export function writeAgentProfilesFile(file: AgentProfilesFile): void {
	const defaultError = validatePiConfigIdentity(file["default-config"].name, file["default-config"].configDir);
	if (defaultError) {
		throw new Error(defaultError);
	}
	for (const entry of file.configs) {
		const error = validatePiConfigIdentity(entry.name, entry.configDir);
		if (error) {
			throw new Error(error);
		}
	}
	writeFileSync(getAgentProfilesPath(), serializeAgentProfilesFile(file), "utf-8");
}

function readAgentProfilesFromDisk(path: string): AgentProfilesFile | undefined {
	if (!existsSync(path)) {
		return undefined;
	}
	try {
		const raw = JSON.parse(stripJsonComments(readFileSync(path, "utf-8"))) as {
			"default-config"?: unknown;
			configs?: unknown;
		};
		const defaultConfig = parsePiConfigIdentity(raw["default-config"]);
		if (!defaultConfig) {
			return undefined;
		}
		const configs: PiConfigIdentity[] = [];
		if (Array.isArray(raw.configs)) {
			for (const entry of raw.configs) {
				const identity = parsePiConfigIdentity(entry);
				if (identity) {
					configs.push(identity);
				}
			}
		}
		return { "default-config": defaultConfig, configs };
	} catch {
		return undefined;
	}
}

function migrateLegacyActivePiConfig(): AgentProfilesFile | undefined {
	const legacyPath = join(getPackageDir(), LEGACY_ACTIVE_PI_CONFIG_FILENAME);
	if (!existsSync(legacyPath)) {
		return undefined;
	}
	try {
		const raw = JSON.parse(readFileSync(legacyPath, "utf-8")) as unknown;
		const identity = parsePiConfigIdentity(raw);
		if (!identity) {
			return undefined;
		}
		const file: AgentProfilesFile = {
			"default-config": identity,
			configs: [],
		};
		writeAgentProfilesFile(file);
		try {
			unlinkSync(legacyPath);
		} catch {
			// Keep legacy file if unlink fails; config.jsonc already written.
		}
		return file;
	} catch {
		return undefined;
	}
}

/** Load config.jsonc (migrating legacy active-pi-config.json when needed). */
export function loadAgentProfilesFile(): AgentProfilesFile | undefined {
	const fromDisk = readAgentProfilesFromDisk(getAgentProfilesPath());
	if (fromDisk) {
		return fromDisk;
	}
	return migrateLegacyActivePiConfig();
}

/** Current profiles file, or a virtual default derived from package.json. */
export function getAgentProfiles(): AgentProfilesFile {
	return loadAgentProfilesFile() ?? createDefaultAgentProfilesFile();
}

/** Ensure a profiles file exists on disk (creates from package.json defaults if missing). */
export function ensureAgentProfilesFile(): AgentProfilesFile {
	const existing = loadAgentProfilesFile();
	if (existing) {
		return existing;
	}
	const created = createDefaultAgentProfilesFile();
	writeAgentProfilesFile(created);
	return created;
}

/** Unique profiles for the /config selector (default first, then configs). */
export function listAgentProfileOptions(): PiConfigIdentity[] {
	const file = getAgentProfiles();
	const seen = new Set<string>();
	const options: PiConfigIdentity[] = [];
	const push = (identity: PiConfigIdentity) => {
		const key = profileKey(identity);
		if (seen.has(key)) {
			return;
		}
		seen.add(key);
		options.push(identity);
	};
	push(file["default-config"]);
	for (const entry of file.configs) {
		push(entry);
	}
	return options;
}

/**
 * Resolve an agent profile by name (case-insensitive).
 * Returns undefined when no match; throws when multiple profiles share the same name.
 */
export function findAgentProfileByName(name: string): PiConfigIdentity | undefined {
	const trimmed = name.trim();
	if (!trimmed) {
		return undefined;
	}
	const needle = trimmed.toLowerCase();
	const matches = listAgentProfileOptions().filter((profile) => profile.name.toLowerCase() === needle);
	if (matches.length === 0) {
		return undefined;
	}
	if (matches.length > 1) {
		const listed = matches.map((profile) => `${profile.name} (${profile.configDir})`).join(", ");
		throw new Error(`配置名 "${trimmed}" 不唯一，匹配到多个：${listed}`);
	}
	return matches[0];
}

/** Active identity from config.jsonc default-config, if the file exists. */
export function getActiveAgentProfile(): PiConfigIdentity | undefined {
	return loadAgentProfilesFile()?.["default-config"];
}

/**
 * Persist default-config to config.jsonc.
 * Keeps the previous default in configs so it remains selectable.
 * For in-process hot switch, also call setActiveAgentProfileIdentity.
 */
export function setDefaultAgentProfile(name: string, configDir: string): PiConfigIdentity {
	const error = validatePiConfigIdentity(name, configDir);
	if (error) {
		throw new Error(error);
	}
	const next: PiConfigIdentity = { name: name.trim(), configDir: configDir.trim() };
	const file = ensureAgentProfilesFile();
	const previous = file["default-config"];
	if (!samePiConfigIdentity(previous, next)) {
		const alreadyListed = file.configs.some((entry) => samePiConfigIdentity(entry, previous));
		if (!alreadyListed) {
			file.configs.push(previous);
		}
	}
	file["default-config"] = next;
	writeAgentProfilesFile(file);
	return next;
}

/**
 * Add a profile to configs via /config-add.
 * Does not change default-config. Returns whether a new entry was written.
 */
export function addAgentProfile(name: string, configDir: string): { added: boolean; profile: PiConfigIdentity } {
	const error = validatePiConfigIdentity(name, configDir);
	if (error) {
		throw new Error(error);
	}
	const profile: PiConfigIdentity = { name: name.trim(), configDir: configDir.trim() };
	const file = ensureAgentProfilesFile();
	if (
		samePiConfigIdentity(file["default-config"], profile) ||
		file.configs.some((entry) => samePiConfigIdentity(entry, profile))
	) {
		return { added: false, profile };
	}
	file.configs.push(profile);
	writeAgentProfilesFile(file);
	return { added: true, profile };
}

const packagePiConfig = getPackagePiConfig();
const activeAgentProfile = getActiveAgentProfile();
const resolvedPiConfigName: string | undefined = activeAgentProfile?.name ?? pkg.piConfig?.name;

export const PACKAGE_NAME: string = pkg.name || "@earendil-works/pi-coding-agent";
export let APP_NAME: string = resolvedPiConfigName || "pi";
export let APP_TITLE: string = resolvedPiConfigName ? APP_NAME : "π";
export let CONFIG_DIR_NAME: string = activeAgentProfile?.configDir || packagePiConfig.configDir;
export const VERSION: string = pkg.version || "0.0.0";
/** True when APP_NAME/CONFIG_DIR_NAME come from config.jsonc rather than package.json alone. */
export const HAS_AGENT_PROFILES_FILE: boolean = !!activeAgentProfile;

// e.g., PI_CODING_AGENT_DIR or TAU_CODING_AGENT_DIR
export let ENV_AGENT_DIR = `${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`;
export let ENV_SESSION_DIR = `${APP_NAME.toUpperCase()}_CODING_AGENT_SESSION_DIR`;

/**
 * Update in-memory active profile identity so getAgentDir()/CONFIG_DIR_NAME
 * resolve to the new profile without restarting the process.
 */
export function setActiveAgentProfileIdentity(identity: PiConfigIdentity): PiConfigIdentity {
	const error = validatePiConfigIdentity(identity.name, identity.configDir);
	if (error) {
		throw new Error(error);
	}
	const next: PiConfigIdentity = { name: identity.name.trim(), configDir: identity.configDir.trim() };
	APP_NAME = next.name;
	APP_TITLE = next.name;
	CONFIG_DIR_NAME = next.configDir;
	ENV_AGENT_DIR = `${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`;
	ENV_SESSION_DIR = `${APP_NAME.toUpperCase()}_CODING_AGENT_SESSION_DIR`;
	return next;
}

/**
 * Apply `--config <name>` from argv before the first getAgentDir() call.
 * Session-only: does not persist to config.jsonc.
 */
export function applyStartupConfigFromArgs(args: string[]): string[] {
	const remaining: string[] = [];

	const applyProfile = (rawName: string): void => {
		const profile = findAgentProfileByName(rawName);
		if (!profile) {
			const available = listAgentProfileOptions().map((entry) => entry.name);
			const hint = available.length > 0 ? `可用配置：${available.join(", ")}` : `请检查 ${getAgentProfilesPath()}`;
			throw new Error(`未找到配置 "${rawName.trim()}"。${hint}`);
		}
		setActiveAgentProfileIdentity(profile);
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i]!;

		if (arg === "--config") {
			const next = args[i + 1];
			if (!next || next.startsWith("-")) {
				throw new Error("--config 需要指定配置名");
			}
			applyProfile(next);
			i++;
			continue;
		}

		if (arg.startsWith("--config=")) {
			const value = arg.slice("--config=".length);
			if (!value) {
				throw new Error("--config 需要指定配置名");
			}
			applyProfile(value);
			continue;
		}

		remaining.push(arg);
	}

	return remaining;
}

export function expandTildePath(path: string): string {
	return normalizePath(path);
}

const DEFAULT_SHARE_VIEWER_URL = "https://pi.dev/session/";

/** Get the share viewer URL for a gist ID */
export function getShareViewerUrl(gistId: string): string {
	const baseUrl = process.env.PI_SHARE_VIEWER_URL || DEFAULT_SHARE_VIEWER_URL;
	return `${baseUrl}#${gistId}`;
}

// =============================================================================
// User Config Paths (<install>/agents/<configDir>/agent/*)
// =============================================================================

/**
 * Agent profiles always live under `<installRoot>/agents/<configDir>/`.
 * Never under the user home directory (no ~/.sproutai).
 * - Bun binary: `<exeDir>/agents/.sproutai/agent/`
 * - Node/tsx: `<packageDir>/agents/.sproutai/agent/`
 */
export const PORTABLE_AGENTS_DIRNAME = "agents";

/** Default working folder next to the portable binary: `<installRoot>/workspace`. */
export const PORTABLE_WORKSPACE_DIRNAME = "workspace";

/** Root of agent profiles: `<installRoot>/agents`. */
export function getPortableAgentsRoot(): string {
	return join(getPackageDir(), PORTABLE_AGENTS_DIRNAME);
}

/**
 * Ensure `<installRoot>/workspace` exists (portable binary layout).
 * No-op if the directory is already present. Safe to call repeatedly.
 */
export function ensurePortableWorkspaceDir(): string {
	const workspaceDir = join(getPackageDir(), PORTABLE_WORKSPACE_DIRNAME);
	if (!existsSync(workspaceDir)) {
		mkdirSync(workspaceDir, { recursive: true });
	}
	return workspaceDir;
}

let legacyConfigDirMigrated = false;

/**
 * One-time move into `<installRoot>/agents/<configDir>` from:
 * 1. `<installRoot>/<configDir>` (old portable layout next to the binary)
 * 2. `~/<configDir>` (legacy home layout — stop using home going forward)
 */
function migrateLegacyConfigDir(): void {
	if (legacyConfigDirMigrated) {
		return;
	}
	legacyConfigDirMigrated = true;

	const next = join(getPortableAgentsRoot(), CONFIG_DIR_NAME);
	if (existsSync(next)) {
		return;
	}

	const candidates = [join(getPackageDir(), CONFIG_DIR_NAME), join(homedir(), CONFIG_DIR_NAME)];
	for (const legacy of candidates) {
		if (!existsSync(legacy)) {
			continue;
		}
		try {
			mkdirSync(dirname(next), { recursive: true });
			renameSync(legacy, next);
			return;
		} catch {
			// Try the next candidate; leave legacy in place if the move fails.
		}
	}
}

/**
 * Get the global config directory root: `<installRoot>/agents/.sproutai`.
 * Agent settings live under getAgentDir() = this + "/agent".
 * Home directory is never used (unless ENV_AGENT_DIR explicitly overrides).
 */
export function getGlobalConfigDir(): string {
	const envDir = process.env[ENV_AGENT_DIR];
	if (envDir) {
		return dirname(expandTildePath(envDir));
	}
	migrateLegacyConfigDir();
	return join(getPortableAgentsRoot(), CONFIG_DIR_NAME);
}

/** Get the agent config directory: `<installRoot>/agents/.sproutai/agent`. */
export function getAgentDir(): string {
	const envDir = process.env[ENV_AGENT_DIR];
	if (envDir) {
		return expandTildePath(envDir);
	}
	migrateLegacyConfigDir();
	return join(getPortableAgentsRoot(), CONFIG_DIR_NAME, "agent");
}

/** Get path to user's custom themes directory */
export function getCustomThemesDir(): string {
	return join(getAgentDir(), "themes");
}

/** Get path to models.json */
export function getModelsPath(): string {
	return join(getAgentDir(), "models.json");
}

/** Get path to auth.json */
export function getAuthPath(): string {
	return join(getAgentDir(), "auth.json");
}

/** Get path to settings.json */
export function getSettingsPath(): string {
	return join(getAgentDir(), "settings.json");
}

/** Get path to tools directory */
export function getToolsDir(): string {
	return join(getAgentDir(), "tools");
}

/** Get path to managed binaries directory (fd, rg) */
export function getBinDir(): string {
	return join(getAgentDir(), "bin");
}

/** Get path to prompt templates directory */
export function getPromptsDir(): string {
	return join(getAgentDir(), "prompts");
}

/** Get path to sessions directory */
export function getSessionsDir(): string {
	return join(getAgentDir(), "sessions");
}

/** Get path to debug log file */
export function getDebugLogPath(): string {
	return join(getAgentDir(), `${APP_NAME}-debug.log`);
}
