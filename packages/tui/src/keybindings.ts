import { type KeyId, matchesKey } from "./keys.ts";

/**
 * Global keybinding registry.
 * Downstream packages can add keybindings via declaration merging.
 */
export interface Keybindings {
	// Editor navigation and editing
	"tui.editor.cursorUp": true;
	"tui.editor.cursorDown": true;
	"tui.editor.cursorLeft": true;
	"tui.editor.cursorRight": true;
	"tui.editor.cursorWordLeft": true;
	"tui.editor.cursorWordRight": true;
	"tui.editor.cursorLineStart": true;
	"tui.editor.cursorLineEnd": true;
	"tui.editor.jumpForward": true;
	"tui.editor.jumpBackward": true;
	"tui.editor.pageUp": true;
	"tui.editor.pageDown": true;
	"tui.editor.deleteCharBackward": true;
	"tui.editor.deleteCharForward": true;
	"tui.editor.deleteWordBackward": true;
	"tui.editor.deleteWordForward": true;
	"tui.editor.deleteToLineStart": true;
	"tui.editor.deleteToLineEnd": true;
	"tui.editor.yank": true;
	"tui.editor.yankPop": true;
	"tui.editor.undo": true;
	// Generic input actions
	"tui.input.newLine": true;
	"tui.input.submit": true;
	"tui.input.tab": true;
	"tui.input.copy": true;
	// Generic selection actions
	"tui.select.up": true;
	"tui.select.down": true;
	"tui.select.pageUp": true;
	"tui.select.pageDown": true;
	"tui.select.confirm": true;
	"tui.select.cancel": true;
}

export type Keybinding = keyof Keybindings;

export interface KeybindingDefinition {
	defaultKeys: KeyId | KeyId[];
	description?: string;
}

export type KeybindingDefinitions = Record<string, KeybindingDefinition>;
export type KeybindingsConfig = Record<string, KeyId | KeyId[] | undefined>;

export const TUI_KEYBINDINGS = {
	"tui.editor.cursorUp": { defaultKeys: "up", description: "光标上移" },
	"tui.editor.cursorDown": { defaultKeys: "down", description: "光标下移" },
	"tui.editor.cursorLeft": {
		defaultKeys: ["left", "ctrl+b"],
		description: "光标左移",
	},
	"tui.editor.cursorRight": {
		defaultKeys: ["right", "ctrl+f"],
		description: "光标右移",
	},
	"tui.editor.cursorWordLeft": {
		defaultKeys: ["alt+left", "ctrl+left", "alt+b"],
		description: "按词左移光标",
	},
	"tui.editor.cursorWordRight": {
		defaultKeys: ["alt+right", "ctrl+right", "alt+f"],
		description: "按词右移光标",
	},
	"tui.editor.cursorLineStart": {
		defaultKeys: ["home", "ctrl+a"],
		description: "移到行首",
	},
	"tui.editor.cursorLineEnd": {
		defaultKeys: ["end", "ctrl+e"],
		description: "移到行尾",
	},
	"tui.editor.jumpForward": {
		defaultKeys: "ctrl+]",
		description: "向前跳到字符",
	},
	"tui.editor.jumpBackward": {
		defaultKeys: "ctrl+alt+]",
		description: "向后跳到字符",
	},
	"tui.editor.pageUp": { defaultKeys: "pageUp", description: "向上翻页" },
	"tui.editor.pageDown": { defaultKeys: "pageDown", description: "向下翻页" },
	"tui.editor.deleteCharBackward": {
		defaultKeys: "backspace",
		description: "向后删除字符",
	},
	"tui.editor.deleteCharForward": {
		defaultKeys: ["delete", "ctrl+d"],
		description: "向前删除字符",
	},
	"tui.editor.deleteWordBackward": {
		defaultKeys: ["ctrl+w", "alt+backspace"],
		description: "向后删除单词",
	},
	"tui.editor.deleteWordForward": {
		defaultKeys: ["alt+d", "alt+delete"],
		description: "向前删除单词",
	},
	"tui.editor.deleteToLineStart": {
		defaultKeys: "ctrl+u",
		description: "删除至行首",
	},
	"tui.editor.deleteToLineEnd": {
		defaultKeys: "ctrl+k",
		description: "删除至行尾",
	},
	"tui.editor.yank": { defaultKeys: "ctrl+y", description: "粘贴（Yank）" },
	"tui.editor.yankPop": { defaultKeys: "alt+y", description: "循环粘贴（Yank pop）" },
	"tui.editor.undo": { defaultKeys: "ctrl+-", description: "撤销" },
	"tui.input.newLine": { defaultKeys: "shift+enter", description: "插入换行" },
	"tui.input.submit": { defaultKeys: "enter", description: "提交输入" },
	"tui.input.tab": { defaultKeys: "tab", description: "Tab / 自动补全" },
	"tui.input.copy": { defaultKeys: "ctrl+c", description: "复制选中内容" },
	"tui.select.up": { defaultKeys: "up", description: "选择项上移" },
	"tui.select.down": { defaultKeys: "down", description: "选择项下移" },
	"tui.select.pageUp": { defaultKeys: "pageUp", description: "选择项向上翻页" },
	"tui.select.pageDown": {
		defaultKeys: "pageDown",
		description: "选择项向下翻页",
	},
	"tui.select.confirm": { defaultKeys: "enter", description: "确认选择" },
	"tui.select.cancel": {
		defaultKeys: ["escape", "ctrl+c"],
		description: "取消选择",
	},
} as const satisfies KeybindingDefinitions;

export interface KeybindingConflict {
	key: KeyId;
	keybindings: string[];
}

function normalizeKeys(keys: KeyId | KeyId[] | undefined): KeyId[] {
	if (keys === undefined) return [];
	const keyList = Array.isArray(keys) ? keys : [keys];
	const seen = new Set<KeyId>();
	const result: KeyId[] = [];
	for (const key of keyList) {
		if (!seen.has(key)) {
			seen.add(key);
			result.push(key);
		}
	}
	return result;
}

export class KeybindingsManager {
	private definitions: KeybindingDefinitions;
	private userBindings: KeybindingsConfig;
	private keysById = new Map<Keybinding, KeyId[]>();
	private conflicts: KeybindingConflict[] = [];

	constructor(definitions: KeybindingDefinitions, userBindings: KeybindingsConfig = {}) {
		this.definitions = definitions;
		this.userBindings = userBindings;
		this.rebuild();
	}

	private rebuild(): void {
		this.keysById.clear();
		this.conflicts = [];

		const userClaims = new Map<KeyId, Set<Keybinding>>();
		for (const [keybinding, keys] of Object.entries(this.userBindings)) {
			if (!(keybinding in this.definitions)) continue;
			for (const key of normalizeKeys(keys)) {
				const claimants = userClaims.get(key) ?? new Set<Keybinding>();
				claimants.add(keybinding as Keybinding);
				userClaims.set(key, claimants);
			}
		}

		for (const [key, keybindings] of userClaims) {
			if (keybindings.size > 1) {
				this.conflicts.push({ key, keybindings: [...keybindings] });
			}
		}

		for (const [id, definition] of Object.entries(this.definitions)) {
			const userKeys = this.userBindings[id];
			const keys = userKeys === undefined ? normalizeKeys(definition.defaultKeys) : normalizeKeys(userKeys);
			this.keysById.set(id as Keybinding, keys);
		}
	}

	matches(data: string, keybinding: Keybinding): boolean {
		const keys = this.keysById.get(keybinding) ?? [];
		for (const key of keys) {
			if (matchesKey(data, key)) return true;
		}
		return false;
	}

	getKeys(keybinding: Keybinding): KeyId[] {
		return [...(this.keysById.get(keybinding) ?? [])];
	}

	getDefinition(keybinding: Keybinding): KeybindingDefinition {
		return this.definitions[keybinding];
	}

	getConflicts(): KeybindingConflict[] {
		return this.conflicts.map((conflict) => ({ ...conflict, keybindings: [...conflict.keybindings] }));
	}

	setUserBindings(userBindings: KeybindingsConfig): void {
		this.userBindings = userBindings;
		this.rebuild();
	}

	getUserBindings(): KeybindingsConfig {
		return { ...this.userBindings };
	}

	getResolvedBindings(): KeybindingsConfig {
		const resolved: KeybindingsConfig = {};
		for (const id of Object.keys(this.definitions)) {
			const keys = this.keysById.get(id as Keybinding) ?? [];
			resolved[id] = keys.length === 1 ? keys[0]! : [...keys];
		}
		return resolved;
	}
}

let globalKeybindings: KeybindingsManager | null = null;

export function setKeybindings(keybindings: KeybindingsManager): void {
	globalKeybindings = keybindings;
}

export function getKeybindings(): KeybindingsManager {
	if (!globalKeybindings) {
		globalKeybindings = new KeybindingsManager(TUI_KEYBINDINGS);
	}
	return globalKeybindings;
}
