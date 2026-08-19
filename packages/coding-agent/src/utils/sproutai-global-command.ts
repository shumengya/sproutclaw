/**
 * Install / uninstall the global `sproutai` command pointing at the compiled binary.
 *
 * Windows: expose sproutai.exe via a hardlink/symlink under %LOCALAPPDATA%\sproutai\bin
 *          (or prepend the install directory if linking fails), then update
 *          HKCU\Environment\Path with TypeScript + reg.exe. No .cmd launcher.
 * Linux/macOS: fs.symlinkSync into /usr/local/bin or ~/.local/bin (no shell / ln)
 */

import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	linkSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { getPackageDir, isBunBinary } from "../config.ts";

export interface GlobalCommandResult {
	ok: boolean;
	output: string;
}

const COMMAND_NAME = "sproutai";
const WINDOWS_PATH_STATE_FILENAME = ".sproutai-global-command.json";
/** Legacy shim locations from older installs — cleaned up on install/uninstall. */
const LEGACY_WINDOWS_SHIM_DIR = join(homedir(), ".sproutai", "bin");

interface WindowsPathState {
	pathDir: string;
	binaryPath: string;
	/** Path of the linked/registered command entry (usually ...\sproutai.exe). */
	commandPath?: string;
	/** @deprecated older installs used a .cmd launcher */
	shimPath?: string;
}

function binaryFileName(): string {
	return process.platform === "win32" ? "sproutai.exe" : "sproutai";
}

/**
 * Resolve the compiled sproutai binary path.
 * Prefer the running Bun binary; otherwise search next to the package / release layout.
 */
export function resolveSproutaiBinaryPath(): string | undefined {
	if (isBunBinary && existsSync(process.execPath)) {
		return process.execPath;
	}

	const name = binaryFileName();
	const packageDir = getPackageDir();
	const candidates = [
		join(packageDir, name),
		join(packageDir, "dist", name),
		join(dirname(packageDir), name),
		join(dirname(packageDir), "dist", name),
		// packages/coding-agent → repo root dist/
		join(dirname(dirname(packageDir)), "dist", name),
		// packages/coding-agent/dist → repo root dist/
		join(dirname(dirname(dirname(packageDir))), "dist", name),
	];

	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

function windowsPathStatePath(): string {
	return join(getPackageDir(), WINDOWS_PATH_STATE_FILENAME);
}

function readWindowsPathState(): WindowsPathState | undefined {
	const path = windowsPathStatePath();
	if (!existsSync(path)) {
		return undefined;
	}
	try {
		const raw = JSON.parse(readFileSync(path, "utf-8")) as Partial<WindowsPathState>;
		if (typeof raw.pathDir === "string" && typeof raw.binaryPath === "string") {
			return {
				pathDir: raw.pathDir,
				binaryPath: raw.binaryPath,
				commandPath: typeof raw.commandPath === "string" ? raw.commandPath : undefined,
				shimPath: typeof raw.shimPath === "string" ? raw.shimPath : undefined,
			};
		}
	} catch {
		// ignore corrupt state
	}
	return undefined;
}

function writeWindowsPathState(state: WindowsPathState): void {
	writeFileSync(windowsPathStatePath(), `${JSON.stringify(state, null, "\t")}\n`, "utf-8");
}

function clearWindowsPathState(): void {
	const path = windowsPathStatePath();
	if (existsSync(path)) {
		unlinkSync(path);
	}
}

function normalizeWinDir(dir: string): string {
	return dir.replace(/[\\/]+$/, "").toLowerCase();
}

/** Dedicated short PATH directory for the global command link (not the install root). */
function windowsBinDir(): string {
	const localAppData = process.env.LOCALAPPDATA?.trim();
	if (localAppData) {
		return join(localAppData, "sproutai", "bin");
	}
	return join(homedir(), "AppData", "Local", "sproutai", "bin");
}

function windowsCommandExePath(binDir: string = windowsBinDir()): string {
	return join(binDir, `${COMMAND_NAME}.exe`);
}

function windowsLegacyCmdPath(binDir: string): string {
	return join(binDir, `${COMMAND_NAME}.cmd`);
}

function readWindowsUserPathEntries(): string[] {
	const query = spawnSync("reg", ["query", "HKCU\\Environment", "/v", "Path"], {
		encoding: "utf-8",
		windowsHide: true,
	});
	if (query.status !== 0) {
		// Value may not exist yet
		return [];
	}
	const match = (query.stdout || "").match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/im);
	if (!match) {
		return [];
	}
	return match[1]
		.trim()
		.split(";")
		.map((part) => part.trim())
		.filter(Boolean);
}

function writeWindowsUserPathEntries(entries: string[]): { ok: boolean; error?: string } {
	const value = entries.join(";");
	const result = spawnSync(
		"reg",
		["add", "HKCU\\Environment", "/v", "Path", "/t", "REG_EXPAND_SZ", "/d", value, "/f"],
		{ encoding: "utf-8", windowsHide: true },
	);
	if (result.status !== 0) {
		const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
		return { ok: false, error: detail || `reg exited with code ${result.status}` };
	}
	return { ok: true };
}

/**
 * Add or remove a directory from the current-user PATH (HKCU\Environment\Path).
 * Implemented in TypeScript via reg.exe — no PowerShell scripts.
 * On add, the directory is prepended so long PATH lists don't drop a trailing entry in cmd.exe.
 */
function updateWindowsUserPath(
	dir: string,
	action: "add" | "remove",
	options?: { prepend?: boolean },
): { ok: boolean; output: string } {
	const target = dir.replace(/[\\/]+$/, "");
	const targetNorm = normalizeWinDir(target);
	const parts = readWindowsUserPathEntries();
	const has = parts.some((part) => normalizeWinDir(part) === targetNorm);
	const prepend = options?.prepend !== false;

	if (action === "add") {
		if (has) {
			if (!prepend) {
				return { ok: true, output: `[信息] 用户 PATH 已包含：${target}` };
			}
			// Move existing entry to the front for cmd.exe long-PATH reliability.
			const rest = parts.filter((part) => normalizeWinDir(part) !== targetNorm);
			const alreadyFront =
				parts.length > 0 && normalizeWinDir(parts[0]!) === targetNorm && rest.length === parts.length - 1;
			if (alreadyFront) {
				return { ok: true, output: `[信息] 用户 PATH 已包含：${target}` };
			}
			const written = writeWindowsUserPathEntries([target, ...rest]);
			if (!written.ok) {
				return { ok: false, output: `PATH 更新失败：${written.error}` };
			}
			return {
				ok: true,
				output: `[完成] 已将 PATH 条目移到最前：${target}\n       请重新打开终端使 PATH 生效。`,
			};
		}
		const next = prepend ? [target, ...parts] : [...parts, target];
		const written = writeWindowsUserPathEntries(next);
		if (!written.ok) {
			return { ok: false, output: `PATH 更新失败：${written.error}` };
		}
		return {
			ok: true,
			output: `[完成] 已添加到用户 PATH：${target}\n       请重新打开终端使 PATH 生效。`,
		};
	}

	const kept = parts.filter((part) => normalizeWinDir(part) !== targetNorm);
	if (kept.length === parts.length) {
		return { ok: true, output: `[信息] 用户 PATH 中未找到：${target}` };
	}
	const written = writeWindowsUserPathEntries(kept);
	if (!written.ok) {
		return { ok: false, output: `PATH 更新失败：${written.error}` };
	}
	return {
		ok: true,
		output: `[完成] 已从用户 PATH 移除：${target}\n       请重新打开终端使 PATH 生效。`,
	};
}

function removeFileIfPresent(filePath: string): boolean {
	if (!existsSync(filePath)) {
		return false;
	}
	unlinkSync(filePath);
	return true;
}

function cleanupLegacyWindowsCmdShims(extraDirs: string[] = []): string[] {
	const lines: string[] = [];
	const dirs = new Set<string>([LEGACY_WINDOWS_SHIM_DIR, windowsBinDir(), ...extraDirs]);
	for (const dir of dirs) {
		const legacyCmd = windowsLegacyCmdPath(dir);
		if (!existsSync(legacyCmd)) {
			continue;
		}
		try {
			unlinkSync(legacyCmd);
			lines.push(`[完成] 已清理旧 .cmd 启动脚本：${legacyCmd}`);
		} catch (error) {
			lines.push(
				`[警告] 无法删除旧启动脚本 ${legacyCmd}：${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	return lines;
}

/**
 * Place sproutai.exe into the dedicated bin dir via hardlink, then symlink.
 * Returns the command path that PATH should resolve.
 */
function linkWindowsCommandExe(
	binDir: string,
	binaryPath: string,
): { commandPath: string; pathDir: string; lines: string[]; linked: boolean } {
	const lines: string[] = [];
	mkdirSync(binDir, { recursive: true });
	const commandPath = windowsCommandExePath(binDir);

	// Same path already — just ensure bin dir is on PATH.
	if (normalizeWinDir(dirname(binaryPath)) === normalizeWinDir(binDir)) {
		return { commandPath: binaryPath, pathDir: binDir, lines, linked: true };
	}

	try {
		removeFileIfPresent(commandPath);
	} catch (error) {
		lines.push(
			`[警告] 无法替换已有命令文件 ${commandPath}：${error instanceof Error ? error.message : String(error)}`,
		);
	}

	try {
		linkSync(binaryPath, commandPath);
		lines.push(`[完成] 已创建硬链接：`, `     ${commandPath}`, `     -> ${binaryPath}`);
		return { commandPath, pathDir: binDir, lines, linked: true };
	} catch {
		// cross-volume hardlinks fail; try symlink next
	}

	try {
		symlinkSync(binaryPath, commandPath, "file");
		lines.push(`[完成] 已创建符号链接：`, `     ${commandPath}`, `     -> ${binaryPath}`);
		return { commandPath, pathDir: binDir, lines, linked: true };
	} catch (error) {
		lines.push(
			`[信息] 无法在 ${binDir} 创建 exe 链接（${error instanceof Error ? error.message : String(error)}）。`,
			`       改为将二进制目录直接加入 PATH。`,
		);
		return { commandPath: binaryPath, pathDir: dirname(binaryPath), lines, linked: false };
	}
}

function installWindows(binaryPath: string): GlobalCommandResult {
	const binaryName = basename(binaryPath).toLowerCase();
	if (binaryName !== `${COMMAND_NAME}.exe`) {
		return {
			ok: false,
			output: [
				`[错误] Windows 全局命令要求二进制文件名为 ${COMMAND_NAME}.exe。`,
				`       当前文件：${binaryPath}`,
			].join("\n"),
		};
	}

	const preferredBinDir = windowsBinDir();
	const previous = readWindowsPathState();
	const installRoot = dirname(binaryPath);
	const lines: string[] = [...cleanupLegacyWindowsCmdShims([previous?.pathDir].filter((v): v is string => !!v))];

	const linked = linkWindowsCommandExe(preferredBinDir, binaryPath);
	lines.push(...linked.lines);
	const pathDir = linked.pathDir;
	const commandPath = linked.commandPath;

	// Remove previous PATH registrations (legacy home shim, old install-root, prior bin dir).
	// Also drop any PATH entry that still points at a directory containing sproutai.exe
	// except the directory we are about to register.
	const dirsToDrop = new Set<string>([LEGACY_WINDOWS_SHIM_DIR, preferredBinDir, installRoot]);
	if (previous?.pathDir) {
		dirsToDrop.add(previous.pathDir);
	}
	for (const entry of readWindowsUserPathEntries()) {
		if (normalizeWinDir(entry) === normalizeWinDir(pathDir)) {
			continue;
		}
		if (
			existsSync(join(entry, `${COMMAND_NAME}.exe`)) ||
			existsSync(join(entry, `${COMMAND_NAME}.cmd`))
		) {
			dirsToDrop.add(entry);
		}
	}
	for (const dir of dirsToDrop) {
		if (normalizeWinDir(dir) === normalizeWinDir(pathDir)) {
			continue;
		}
		const removed = updateWindowsUserPath(dir, "remove");
		if (!removed.output.includes("未找到")) {
			lines.push(removed.output);
		}
	}

	// If we fell back to install-root PATH, remove a leftover linked exe in LocalAppData.
	if (!linked.linked) {
		try {
			removeFileIfPresent(windowsCommandExePath(preferredBinDir));
		} catch {
			// ignore
		}
	}

	const pathResult = updateWindowsUserPath(pathDir, "add", { prepend: true });
	lines.push(pathResult.output);

	if (pathResult.ok) {
		writeWindowsPathState({ pathDir, binaryPath, commandPath });
	}

	lines.push(
		"",
		`[完成] 已注册全局命令（直接指向 exe，无 .cmd）：`,
		`     命令：${COMMAND_NAME}`,
		`     命令路径：${commandPath}`,
		`     二进制：${binaryPath}`,
		`     PATH 目录：${pathDir}`,
		"",
		"安装完成。重新打开终端后，CMD 与 PowerShell 均可使用：",
		`  ${COMMAND_NAME}`,
	);

	return { ok: pathResult.ok, output: lines.join("\n") };
}

function uninstallWindows(): GlobalCommandResult {
	const lines: string[] = [...cleanupLegacyWindowsCmdShims()];
	const state = readWindowsPathState();
	const binaryPath = resolveSproutaiBinaryPath();
	const binDir = windowsBinDir();
	const dirsToRemove = new Set<string>([binDir, LEGACY_WINDOWS_SHIM_DIR]);

	if (state?.pathDir) {
		dirsToRemove.add(state.pathDir);
	}
	if (binaryPath) {
		// Older installs / link fallback put the install root directly on PATH.
		dirsToRemove.add(dirname(binaryPath));
	}

	const fileCandidates = [
		state?.commandPath,
		state?.shimPath,
		windowsCommandExePath(binDir),
		windowsLegacyCmdPath(binDir),
		windowsLegacyCmdPath(LEGACY_WINDOWS_SHIM_DIR),
	].filter((v): v is string => !!v);

	for (const filePath of new Set(fileCandidates)) {
		// Never delete the real install binary — only links/shims under bin dirs.
		if (binaryPath && normalizeWinDir(filePath) === normalizeWinDir(binaryPath)) {
			continue;
		}
		if (state?.binaryPath && normalizeWinDir(filePath) === normalizeWinDir(state.binaryPath)) {
			continue;
		}
		try {
			if (removeFileIfPresent(filePath)) {
				lines.push(`[完成] 已删除：${filePath}`);
			}
		} catch (error) {
			lines.push(`[警告] 无法删除 ${filePath}：${error instanceof Error ? error.message : String(error)}`);
		}
	}

	let ok = true;
	for (const dir of dirsToRemove) {
		const result = updateWindowsUserPath(dir, "remove");
		lines.push(result.output);
		if (!result.ok) {
			ok = false;
		}
	}

	clearWindowsPathState();
	lines.push("", "卸载完成。");
	return { ok, output: lines.join("\n") };
}

function resolveUnixBinDir(): string {
	const override = process.env.SPROUTAI_BIN_DIR?.trim();
	if (override) {
		return override;
	}
	try {
		const local = "/usr/local/bin";
		if (existsSync(local)) {
			const probe = join(local, `.sproutai-write-probe-${process.pid}`);
			try {
				writeFileSync(probe, "");
				unlinkSync(probe);
				return local;
			} catch {
				// fall through
			}
		}
	} catch {
		// fall through
	}
	return join(homedir(), ".local", "bin");
}

function unixLinkPath(binDir: string): string {
	return join(binDir, COMMAND_NAME);
}

/** Remove path if it exists (including broken symlinks). */
function removeUnixPathIfPresent(targetPath: string): boolean {
	try {
		lstatSync(targetPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return false;
		}
		throw error;
	}
	unlinkSync(targetPath);
	return true;
}

function installUnix(binaryPath: string): GlobalCommandResult {
	try {
		chmodSync(binaryPath, 0o755);
	} catch {
		// ignore chmod failures on exotic FS
	}

	const binDir = resolveUnixBinDir();
	mkdirSync(binDir, { recursive: true });
	const linkPath = unixLinkPath(binDir);

	try {
		removeUnixPathIfPresent(linkPath);
		symlinkSync(binaryPath, linkPath);
	} catch (error) {
		return {
			ok: false,
			output: `创建软链接失败：${linkPath} -> ${binaryPath}\n${error instanceof Error ? error.message : String(error)}`,
		};
	}

	const lines = [`[完成] 已创建软链接（若已存在则覆盖）：`, `     ${linkPath} -> ${binaryPath}`];

	const homeLocal = join(homedir(), ".local", "bin");
	if (binDir === homeLocal) {
		const pathEnv = process.env.PATH || "";
		const parts = pathEnv.split(":").filter(Boolean);
		if (!parts.includes(binDir)) {
			lines.push(
				"",
				`[警告] ${binDir} 不在 PATH 中。`,
				"       请将下面一行加入 ~/.bashrc 或 ~/.zshrc，然后重新打开终端：",
				'         export PATH="$HOME/.local/bin:$PATH"',
			);
		}
	}

	lines.push("", "安装完成。可用命令：", `  ${COMMAND_NAME}`);
	return { ok: true, output: lines.join("\n") };
}

function uninstallUnix(): GlobalCommandResult {
	const candidates = [
		process.env.SPROUTAI_BIN_DIR?.trim(),
		"/usr/local/bin",
		join(homedir(), ".local", "bin"),
	].filter((v): v is string => !!v);

	const lines: string[] = [];
	let removed = false;
	for (const binDir of new Set(candidates)) {
		const linkPath = unixLinkPath(binDir);
		try {
			if (removeUnixPathIfPresent(linkPath)) {
				lines.push(`[完成] 已删除：${linkPath}`);
				removed = true;
			}
		} catch (error) {
			lines.push(
				`[警告] 无法删除 ${linkPath}：${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	if (!removed) {
		lines.push(`[信息] 常见 bin 目录中未找到 ${COMMAND_NAME} 命令。`);
	}
	lines.push("", "卸载完成。");
	return { ok: true, output: lines.join("\n") };
}

/** Register global `sproutai` command pointing at the compiled binary (overwrite if present). */
export function installSproutaiGlobalCommand(): GlobalCommandResult {
	const binaryPath = resolveSproutaiBinaryPath();
	if (!binaryPath) {
		return {
			ok: false,
			output: [
				`[错误] 未找到编译后的二进制文件（${binaryFileName()}）。`,
				"       请从发布版二进制运行，或先构建：",
				"         npm run build:binary",
			].join("\n"),
		};
	}

	if (process.platform === "win32") {
		return installWindows(binaryPath);
	}
	return installUnix(binaryPath);
}

/** Remove the global `sproutai` command registration. */
export function uninstallSproutaiGlobalCommand(): GlobalCommandResult {
	if (process.platform === "win32") {
		return uninstallWindows();
	}
	return uninstallUnix();
}

/** Exported for tests / diagnostics. */
export function getSproutaiGlobalCommandTarget(): {
	binaryPath: string | undefined;
	binDir: string;
	commandPath: string;
} {
	const binaryPath = resolveSproutaiBinaryPath();
	if (process.platform === "win32") {
		const binDir = windowsBinDir();
		return {
			binaryPath,
			binDir,
			commandPath: windowsCommandExePath(binDir),
		};
	}
	const binDir = resolveUnixBinDir();
	return { binaryPath, binDir, commandPath: unixLinkPath(binDir) };
}
