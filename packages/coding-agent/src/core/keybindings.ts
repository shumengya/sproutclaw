import {
	type Keybinding,
	type KeybindingDefinitions,
	type KeybindingsConfig,
	type KeyId,
	TUI_KEYBINDINGS,
	KeybindingsManager as TuiKeybindingsManager,
} from "@earendil-works/pi-tui";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getAgentDir } from "../config.ts";

export interface AppKeybindings {
	"app.interrupt": true;
	"app.clear": true;
	"app.exit": true;
	"app.suspend": true;
	"app.thinking.cycle": true;
	"app.model.cycleForward": true;
	"app.model.cycleBackward": true;
	"app.model.select": true;
	"app.tools.expand": true;
	"app.thinking.toggle": true;
	"app.session.toggleNamedFilter": true;
	"app.editor.external": true;
	"app.message.followUp": true;
	"app.message.dequeue": true;
	"app.clipboard.pasteImage": true;
	"app.session.new": true;
	"app.session.tree": true;
	"app.session.fork": true;
	"app.session.resume": true;
	"app.tree.foldOrUp": true;
	"app.tree.unfoldOrDown": true;
	"app.tree.editLabel": true;
	"app.tree.toggleLabelTimestamp": true;
	"app.session.togglePath": true;
	"app.session.toggleSort": true;
	"app.session.rename": true;
	"app.session.delete": true;
	"app.session.deleteNoninvasive": true;
	"app.models.save": true;
	"app.models.enableAll": true;
	"app.models.clearAll": true;
	"app.models.toggleProvider": true;
	"app.models.reorderUp": true;
	"app.models.reorderDown": true;
	"app.tree.filter.default": true;
	"app.tree.filter.noTools": true;
	"app.tree.filter.userOnly": true;
	"app.tree.filter.labeledOnly": true;
	"app.tree.filter.all": true;
	"app.tree.filter.cycleForward": true;
	"app.tree.filter.cycleBackward": true;
}

export type AppKeybinding = keyof AppKeybindings;

declare module "@earendil-works/pi-tui" {
	interface Keybindings extends AppKeybindings {}
}

export const KEYBINDINGS = {
	...TUI_KEYBINDINGS,
	"app.interrupt": { defaultKeys: "escape", description: "取消或中止" },
	"app.clear": { defaultKeys: "ctrl+c", description: "清空编辑器" },
	"app.exit": { defaultKeys: "ctrl+d", description: "编辑器为空时退出" },
	"app.suspend": {
		defaultKeys: process.platform === "win32" ? [] : "ctrl+z",
		description: "挂起到后台",
	},
	"app.thinking.cycle": {
		defaultKeys: "shift+tab",
		description: "循环切换思考级别",
	},
	"app.model.cycleForward": {
		defaultKeys: "ctrl+p",
		description: "切换到下一个模型",
	},
	"app.model.cycleBackward": {
		defaultKeys: "shift+ctrl+p",
		description: "切换到上一个模型",
	},
	"app.model.select": { defaultKeys: "ctrl+l", description: "打开模型选择器" },
	"app.tools.expand": { defaultKeys: "ctrl+o", description: "切换工具输出展开" },
	"app.thinking.toggle": {
		defaultKeys: "ctrl+t",
		description: "切换思考块显示",
	},
	"app.session.toggleNamedFilter": {
		defaultKeys: "ctrl+n",
		description: "切换已命名会话筛选",
	},
	"app.editor.external": {
		defaultKeys: "ctrl+g",
		description: "打开外部编辑器",
	},
	"app.message.followUp": {
		defaultKeys: "alt+enter",
		description: "排队后续消息",
	},
	"app.message.dequeue": {
		defaultKeys: "alt+up",
		description: "恢复排队中的消息",
	},
	"app.clipboard.pasteImage": {
		// ctrl+v everywhere (Windows included): image → path attach → text fallback.
		defaultKeys: "ctrl+v",
		description: "从剪贴板粘贴图片或文本",
	},
	"app.session.new": { defaultKeys: [], description: "开始新会话" },
	"app.session.tree": { defaultKeys: [], description: "打开会话树" },
	"app.session.fork": { defaultKeys: [], description: "分叉当前会话" },
	"app.session.resume": { defaultKeys: [], description: "恢复会话" },
	"app.tree.foldOrUp": {
		defaultKeys: ["ctrl+left", "alt+left"],
		description: "折叠树分支或向上移动",
	},
	"app.tree.unfoldOrDown": {
		defaultKeys: ["ctrl+right", "alt+right"],
		description: "展开树分支或向下移动",
	},
	"app.tree.editLabel": {
		defaultKeys: "shift+l",
		description: "编辑树标签",
	},
	"app.tree.toggleLabelTimestamp": {
		defaultKeys: "shift+t",
		description: "切换树标签时间戳",
	},
	"app.session.togglePath": {
		defaultKeys: "ctrl+p",
		description: "切换会话路径显示",
	},
	"app.session.toggleSort": {
		defaultKeys: "ctrl+s",
		description: "切换会话排序方式",
	},
	"app.session.rename": {
		defaultKeys: "ctrl+r",
		description: "重命名会话",
	},
	"app.session.delete": {
		defaultKeys: "ctrl+d",
		description: "删除会话",
	},
	"app.session.deleteNoninvasive": {
		defaultKeys: "ctrl+backspace",
		description: "查询为空时删除会话",
	},
	"app.models.save": {
		defaultKeys: "ctrl+s",
		description: "保存模型选择",
	},
	"app.models.enableAll": {
		defaultKeys: "ctrl+a",
		description: "启用全部模型",
	},
	"app.models.clearAll": {
		defaultKeys: "ctrl+x",
		description: "清除全部模型",
	},
	"app.models.toggleProvider": {
		defaultKeys: "ctrl+p",
		description: "切换供应商下全部模型",
	},
	"app.models.reorderUp": {
		defaultKeys: "alt+up",
		description: "上移模型顺序",
	},
	"app.models.reorderDown": {
		defaultKeys: "alt+down",
		description: "下移模型顺序",
	},
	"app.tree.filter.default": {
		defaultKeys: "ctrl+d",
		description: "树筛选：默认视图",
	},
	"app.tree.filter.noTools": {
		defaultKeys: "ctrl+t",
		description: "树筛选：隐藏工具结果",
	},
	"app.tree.filter.userOnly": {
		defaultKeys: "ctrl+u",
		description: "树筛选：仅用户消息",
	},
	"app.tree.filter.labeledOnly": {
		defaultKeys: "ctrl+l",
		description: "树筛选：仅带标签条目",
	},
	"app.tree.filter.all": {
		defaultKeys: "ctrl+a",
		description: "树筛选：显示全部条目",
	},
	"app.tree.filter.cycleForward": {
		defaultKeys: "ctrl+o",
		description: "树筛选：向前循环",
	},
	"app.tree.filter.cycleBackward": {
		defaultKeys: "shift+ctrl+o",
		description: "树筛选：向后循环",
	},
} as const satisfies KeybindingDefinitions;

const KEYBINDING_NAME_MIGRATIONS = {
	cursorUp: "tui.editor.cursorUp",
	cursorDown: "tui.editor.cursorDown",
	cursorLeft: "tui.editor.cursorLeft",
	cursorRight: "tui.editor.cursorRight",
	cursorWordLeft: "tui.editor.cursorWordLeft",
	cursorWordRight: "tui.editor.cursorWordRight",
	cursorLineStart: "tui.editor.cursorLineStart",
	cursorLineEnd: "tui.editor.cursorLineEnd",
	jumpForward: "tui.editor.jumpForward",
	jumpBackward: "tui.editor.jumpBackward",
	pageUp: "tui.editor.pageUp",
	pageDown: "tui.editor.pageDown",
	deleteCharBackward: "tui.editor.deleteCharBackward",
	deleteCharForward: "tui.editor.deleteCharForward",
	deleteWordBackward: "tui.editor.deleteWordBackward",
	deleteWordForward: "tui.editor.deleteWordForward",
	deleteToLineStart: "tui.editor.deleteToLineStart",
	deleteToLineEnd: "tui.editor.deleteToLineEnd",
	yank: "tui.editor.yank",
	yankPop: "tui.editor.yankPop",
	undo: "tui.editor.undo",
	newLine: "tui.input.newLine",
	submit: "tui.input.submit",
	tab: "tui.input.tab",
	copy: "tui.input.copy",
	selectUp: "tui.select.up",
	selectDown: "tui.select.down",
	selectPageUp: "tui.select.pageUp",
	selectPageDown: "tui.select.pageDown",
	selectConfirm: "tui.select.confirm",
	selectCancel: "tui.select.cancel",
	interrupt: "app.interrupt",
	clear: "app.clear",
	exit: "app.exit",
	suspend: "app.suspend",
	cycleThinkingLevel: "app.thinking.cycle",
	cycleModelForward: "app.model.cycleForward",
	cycleModelBackward: "app.model.cycleBackward",
	selectModel: "app.model.select",
	expandTools: "app.tools.expand",
	toggleThinking: "app.thinking.toggle",
	toggleSessionNamedFilter: "app.session.toggleNamedFilter",
	externalEditor: "app.editor.external",
	followUp: "app.message.followUp",
	dequeue: "app.message.dequeue",
	pasteImage: "app.clipboard.pasteImage",
	newSession: "app.session.new",
	tree: "app.session.tree",
	fork: "app.session.fork",
	resume: "app.session.resume",
	treeFoldOrUp: "app.tree.foldOrUp",
	treeUnfoldOrDown: "app.tree.unfoldOrDown",
	treeEditLabel: "app.tree.editLabel",
	treeToggleLabelTimestamp: "app.tree.toggleLabelTimestamp",
	toggleSessionPath: "app.session.togglePath",
	toggleSessionSort: "app.session.toggleSort",
	renameSession: "app.session.rename",
	deleteSession: "app.session.delete",
	deleteSessionNoninvasive: "app.session.deleteNoninvasive",
} as const satisfies Record<string, Keybinding>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLegacyKeybindingName(key: string): key is keyof typeof KEYBINDING_NAME_MIGRATIONS {
	return key in KEYBINDING_NAME_MIGRATIONS;
}

function toKeybindingsConfig(value: unknown): KeybindingsConfig {
	if (!isRecord(value)) return {};

	const config: KeybindingsConfig = {};
	for (const [key, binding] of Object.entries(value)) {
		if (typeof binding === "string") {
			config[key] = binding as KeyId;
			continue;
		}
		if (Array.isArray(binding) && binding.every((entry) => typeof entry === "string")) {
			config[key] = binding as KeyId[];
		}
	}
	return config;
}

export function migrateKeybindingsConfig(rawConfig: Record<string, unknown>): {
	config: Record<string, unknown>;
	migrated: boolean;
} {
	const config: Record<string, unknown> = {};
	let migrated = false;

	for (const [key, value] of Object.entries(rawConfig)) {
		const nextKey = isLegacyKeybindingName(key) ? KEYBINDING_NAME_MIGRATIONS[key] : key;
		if (nextKey !== key) {
			migrated = true;
		}
		if (key !== nextKey && Object.hasOwn(rawConfig, nextKey)) {
			migrated = true;
			continue;
		}
		config[nextKey] = value;
	}

	return { config: orderKeybindingsConfig(config), migrated };
}

function orderKeybindingsConfig(config: Record<string, unknown>): Record<string, unknown> {
	const ordered: Record<string, unknown> = {};
	for (const keybinding of Object.keys(KEYBINDINGS)) {
		if (Object.hasOwn(config, keybinding)) {
			ordered[keybinding] = config[keybinding];
		}
	}

	const extras = Object.keys(config)
		.filter((key) => !Object.hasOwn(ordered, key))
		.sort();
	for (const key of extras) {
		ordered[key] = config[key];
	}

	return ordered;
}

function loadRawConfig(path: string): Record<string, unknown> | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

export class KeybindingsManager extends TuiKeybindingsManager {
	private configPath: string | undefined;

	constructor(userBindings: KeybindingsConfig = {}, configPath?: string) {
		super(KEYBINDINGS, userBindings);
		this.configPath = configPath;
	}

	static create(agentDir: string = getAgentDir()): KeybindingsManager {
		const configPath = join(agentDir, "keybindings.json");
		const userBindings = KeybindingsManager.loadFromFile(configPath);
		return new KeybindingsManager(userBindings, configPath);
	}

	/** Point at another agentDir's keybindings.json and reload (keeps same instance for editors). */
	switchAgentDir(agentDir: string): void {
		this.configPath = join(agentDir, "keybindings.json");
		this.setUserBindings(KeybindingsManager.loadFromFile(this.configPath));
	}

	reload(): void {
		if (!this.configPath) return;
		this.setUserBindings(KeybindingsManager.loadFromFile(this.configPath));
	}

	getEffectiveConfig(): KeybindingsConfig {
		return this.getResolvedBindings();
	}

	private static loadFromFile(path: string): KeybindingsConfig {
		const rawConfig = loadRawConfig(path);
		if (!rawConfig) return {};
		return toKeybindingsConfig(migrateKeybindingsConfig(rawConfig).config);
	}
}

export type { Keybinding, KeyId, KeybindingsConfig };
