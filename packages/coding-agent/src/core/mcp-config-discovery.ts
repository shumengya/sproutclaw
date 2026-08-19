/**
 * Lightweight MCP config discovery for startup resource listing.
 * Mirrors the common paths used by pi-mcp-adapter without importing the extension.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "../config.ts";

function readMcpServerNames(configPath: string): string[] {
	try {
		if (!existsSync(configPath)) return [];
		const raw = readFileSync(configPath, "utf8");
		const data = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
		if (!data?.mcpServers || typeof data.mcpServers !== "object" || Array.isArray(data.mcpServers)) {
			return [];
		}
		return Object.keys(data.mcpServers).filter((name) => name.trim().length > 0);
	} catch {
		return [];
	}
}

/**
 * Collect configured MCP server names (enabled `mcpServers` only).
 * Later sources override earlier ones by name when merged for display.
 */
export function listConfiguredMcpServers(options?: { cwd?: string; agentDir?: string }): string[] {
	const cwd = options?.cwd ?? process.cwd();
	const agentDir = options?.agentDir ?? getAgentDir();

	const paths = [
		join(homedir(), ".config", "mcp", "mcp.json"),
		join(agentDir, "mcp.json"),
		join(cwd, ".mcp.json"),
		join(cwd, CONFIG_DIR_NAME, "mcp.json"),
	];

	// De-dupe paths while preserving order
	const seenPaths = new Set<string>();
	const merged = new Map<string, true>();

	for (const configPath of paths) {
		const normalized = configPath.replace(/\\/g, "/").toLowerCase();
		if (seenPaths.has(normalized)) continue;
		seenPaths.add(normalized);

		for (const name of readMcpServerNames(configPath)) {
			merged.set(name, true);
		}
	}

	return [...merged.keys()].sort((a, b) => a.localeCompare(b));
}
