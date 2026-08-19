import { Container, getKeybindings, Spacer, Text } from "@earendil-works/pi-tui";
import { APP_NAME } from "../../../config.ts";
import { type TerminalTheme, theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyHint, rawKeyHint } from "./keybinding-hints.ts";

export interface FirstTimeSetupResult {
	theme: string;
}

export interface FirstTimeSetupOptions {
	detectedTheme: TerminalTheme;
	onThemePreview: (themeName: string) => void;
	onSubmit: (result: FirstTimeSetupResult) => void;
	onCancel: () => void;
}

const THEME_OPTIONS: Array<{ value: string; label: string }> = [
	{ value: "pink", label: "樱花粉" },
	{ value: "purple", label: "紫色" },
	{ value: "ocean", label: "海洋" },
	{ value: "nord", label: "极光" },
	{ value: "dark", label: "深色" },
	{ value: "light", label: "浅色" },
];

const SETUP_LOGO_LINES = ["██████", "██  ██", "████  ██", "██    ██"];

/** First-time setup dialog: theme choice only. */
export class FirstTimeSetupComponent extends Container {
	private themeIndex: number;
	private readonly options: FirstTimeSetupOptions;

	constructor(options: FirstTimeSetupOptions) {
		super();
		this.options = options;
		// Dark terminals default to purple; light stays on light.
		const preferred = options.detectedTheme === "light" ? "light" : "purple";
		this.themeIndex = Math.max(
			0,
			THEME_OPTIONS.findIndex((option) => option.value === preferred),
		);
		this.update();
	}

	// Rebuild the whole dialog on every change so theme previews recolor all text.
	private update(): void {
		this.clear();
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("accent", SETUP_LOGO_LINES.join("\n")), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(
			new Text(theme.fg("accent", theme.bold(`欢迎使用 ${APP_NAME}，一款极简编程助手。`)), 1, 0),
		);
		this.addChild(new Spacer(1));

		this.addChild(new Text(theme.fg("text", "选择主题。"), 1, 0));
		this.addChild(new Text(theme.fg("muted", `检测到的系统外观：${this.options.detectedTheme}`), 1, 0));
		this.addChild(new Spacer(1));
		this.addOptionList(
			THEME_OPTIONS.map((option) => option.label),
			this.themeIndex,
		);

		this.addChild(new Spacer(1));
		this.addChild(
			new Text(
				rawKeyHint("↑↓", "导航") +
					"  " +
					keyHint("tui.select.confirm", "完成") +
					"  " +
					keyHint("tui.select.cancel", "跳过设置"),
				1,
				0,
			),
		);
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
	}

	private addOptionList(labels: string[], selectedIndex: number): void {
		for (let i = 0; i < labels.length; i++) {
			const isSelected = i === selectedIndex;
			const prefix = isSelected ? theme.fg("accent", "→ ") : "  ";
			const label = isSelected ? theme.fg("accent", labels[i]) : theme.fg("text", labels[i]);
			this.addChild(new Text(`${prefix}${label}`, 1, 0));
		}
	}

	private moveSelection(delta: number): void {
		const next = Math.max(0, Math.min(THEME_OPTIONS.length - 1, this.themeIndex + delta));
		if (next !== this.themeIndex) {
			this.themeIndex = next;
			this.options.onThemePreview(THEME_OPTIONS[this.themeIndex].value);
		}
		this.update();
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		if (kb.matches(keyData, "tui.select.up") || keyData === "k") {
			this.moveSelection(-1);
		} else if (kb.matches(keyData, "tui.select.down") || keyData === "j") {
			this.moveSelection(1);
		} else if (kb.matches(keyData, "tui.select.confirm") || keyData === "\n") {
			this.options.onSubmit({
				theme: THEME_OPTIONS[this.themeIndex].value,
			});
		} else if (kb.matches(keyData, "tui.select.cancel")) {
			this.options.onCancel();
		}
	}
}
