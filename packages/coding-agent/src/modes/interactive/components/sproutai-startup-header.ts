/**
 * Built-in SproutAI startup header: gradient logo, Chinese onboarding, keybinding hints.
 * Expanded/collapsed via app.tools.expand (ctrl+o).
 * Extensions may register a tip line via setStartupTipProvider().
 */

import type { Component, Keybinding } from "@earendil-works/pi-tui";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { getGlobalConfigDir } from "../../../config.ts";
import type { AppKeybinding } from "../../../core/keybindings.ts";
import { theme } from "../theme/theme.ts";
import { keyText, rawKeyHint } from "./keybinding-hints.ts";

/** Optional tip text shown under the startup onboarding lines */
export type StartupTipProvider = () => string | undefined;

let startupTipProvider: StartupTipProvider | undefined;

/** Register a provider that returns one tip string for the startup header (or undefined to hide). */
export function setStartupTipProvider(provider: StartupTipProvider | undefined): void {
	startupTipProvider = provider;
}

export function getStartupTipProvider(): StartupTipProvider | undefined {
	return startupTipProvider;
}
/** Wide-terminal SPROUTAI glyph (requires width ≥ WIDE_LOGO_MIN_WIDTH) */
const SPROUTAI_LOGO = [
	"███████╗██████╗ ██████╗  ██████╗ ██╗   ██╗████████╗ █████╗ ██╗",
	"██╔════╝██╔══██╗██╔══██╗██╔═══██╗██║   ██║╚══██╔══╝██╔══██╗██║",
	"███████╗██████╔╝██████╔╝██║   ██║██║   ██║   ██║   ███████║██║",
	"╚════██║██╔═══╝ ██╔══██╗██║   ██║██║   ██║   ██║   ██╔══██║██║",
	"███████║██║     ██║  ██║╚██████╔╝╚██████╔╝   ██║   ██║  ██║██║",
	"╚══════╝╚═╝     ╚═╝  ╚═╝ ╚═════╝  ╚═════╝    ╚═╝   ╚═╝  ╚═╝╚═╝",
];

/** Logo gradient palette (teal → yellow → pink → violet) */
const LOGO_PALETTE = [
	[125, 255, 230],
	[154, 255, 140],
	[255, 245, 135],
	[255, 176, 235],
	[150, 210, 255],
	[190, 170, 255],
];

const WIDE_LOGO_MIN_WIDTH = 64;

/** Defaults aligned with packages/coding-agent + packages/tui KEYBINDINGS */
const KEY_FALLBACKS = {
	interrupt: "escape",
	clear: "ctrl+c",
	exit: "ctrl+d",
	suspend: "ctrl+z",
	deleteToLineEnd: "ctrl+k",
	thinkingCycle: "shift+tab",
	modelCycleForward: "ctrl+p",
	modelCycleBackward: "shift+ctrl+p",
	modelSelect: "ctrl+l",
	toolsExpand: "ctrl+o",
	thinkingToggle: "ctrl+t",
	editorExternal: "ctrl+g",
	followUp: "alt+enter",
	dequeue: "alt+up",
	pasteImage: "ctrl+v",
} as const;

function rgb(text: string, color: number[]): string {
	return `\x1b[38;2;${color[0]};${color[1]};${color[2]}m${text}\x1b[39m`;
}

function lerp(a: number, b: number, t: number): number {
	return Math.round(a + (b - a) * t);
}

/** Per-character palette gradient; offset staggers phase across logo rows */
function gradientText(text: string, offset = 0): string {
	const chars = [...text];
	const last = Math.max(1, chars.length - 1);
	return chars
		.map((char, index) => {
			if (char === " ") return char;
			const position = (index / last + offset) % 1;
			const scaled = position * (LOGO_PALETTE.length - 1);
			const startIndex = Math.floor(scaled);
			const endIndex = Math.min(LOGO_PALETTE.length - 1, startIndex + 1);
			const t = scaled - startIndex;
			const start = LOGO_PALETTE[startIndex];
			const end = LOGO_PALETTE[endIndex];
			return rgb(char, [
				lerp(start[0], end[0], t),
				lerp(start[1], end[1], t),
				lerp(start[2], end[2], t),
			]);
		})
		.join("");
}

function startupLine(label: string, text: string, color: number[]): string {
	return `${rgb(label, color)} ${rgb(text, [210, 235, 255])}`;
}

function keyTextOr(action: Keybinding, fallback: string): string {
	try {
		const text = keyText(action).trim();
		return text || fallback;
	} catch {
		return fallback;
	}
}

function actionHint(action: AppKeybinding | Keybinding, fallback: string, description: string): string {
	return rawKeyHint(keyTextOr(action, fallback), description);
}

function renderDivider(width: number): string {
	return theme.fg("dim", "─".repeat(Math.max(1, width)));
}

function fitWidth(lines: string[], width: number): string[] {
	const result: string[] = [];
	for (const line of lines) {
		for (const segment of line.split("\n")) {
			for (const wrapped of wrapTextWithAnsi(segment, width)) {
				result.push(truncateToWidth(wrapped, width));
			}
		}
	}
	return result;
}

function renderSproutaiLogo(version: string, width: number): string[] {
	if (width < WIDE_LOGO_MIN_WIDTH) {
		return [
			[
				rgb("❯ ", [100, 200, 255]),
				theme.bold(gradientText("SproutAI")),
				rgb("-萌芽Bot ", [190, 170, 255]),
				rgb(`v${version}`, [170, 235, 255]),
			].join(""),
		];
	}

	const lines: string[] = [];
	for (let i = 0; i < SPROUTAI_LOGO.length; i++) {
		lines.push(theme.bold(gradientText(SPROUTAI_LOGO[i], i * 0.08)));
	}
	return lines;
}

function buildExpandedInstructions(): string {
	const clear = keyTextOr("app.clear", KEY_FALLBACKS.clear);
	const cycleForward = keyTextOr("app.model.cycleForward", KEY_FALLBACKS.modelCycleForward);
	const cycleBackward = keyTextOr("app.model.cycleBackward", KEY_FALLBACKS.modelCycleBackward);
	const lines = [
		actionHint("app.interrupt", KEY_FALLBACKS.interrupt, "中断当前任务"),
		actionHint("app.clear", KEY_FALLBACKS.clear, "清空输入"),
		rawKeyHint(`${clear} twice`, "退出"),
		actionHint("app.exit", KEY_FALLBACKS.exit, "空输入退出"),
	];

	if (process.platform !== "win32") {
		lines.push(actionHint("app.suspend", KEY_FALLBACKS.suspend, "挂起进程"));
	}

	lines.push(
		actionHint("tui.editor.deleteToLineEnd", KEY_FALLBACKS.deleteToLineEnd, "删除到行尾"),
		actionHint("app.thinking.cycle", KEY_FALLBACKS.thinkingCycle, "切换思考强度"),
		rawKeyHint(`${cycleForward}/${cycleBackward}`, "切换模型"),
		actionHint("app.model.select", KEY_FALLBACKS.modelSelect, "选择模型"),
		actionHint("app.tools.expand", KEY_FALLBACKS.toolsExpand, "展开工具输出"),
		actionHint("app.thinking.toggle", KEY_FALLBACKS.thinkingToggle, "展开思考过程"),
		actionHint("app.editor.external", KEY_FALLBACKS.editorExternal, "外部编辑器"),
		rawKeyHint("/", "Agent 命令"),
		rawKeyHint("!", "执行 shell"),
		rawKeyHint("!!", "执行 shell 且不进上下文"),
		actionHint("app.message.followUp", KEY_FALLBACKS.followUp, "追加后续消息"),
		actionHint("app.message.dequeue", KEY_FALLBACKS.dequeue, "编辑队列消息"),
		actionHint("app.clipboard.pasteImage", KEY_FALLBACKS.pasteImage, "粘贴图片/文件/文本"),
		rawKeyHint("drop file", "附加文件（显示文件名）"),
	);

	return lines.join("\n");
}

function buildCompactInstructions(): string {
	const clear = keyTextOr("app.clear", KEY_FALLBACKS.clear);
	const exit = keyTextOr("app.exit", KEY_FALLBACKS.exit);
	const expand = keyTextOr("app.tools.expand", KEY_FALLBACKS.toolsExpand);
	return [
		actionHint("app.interrupt", KEY_FALLBACKS.interrupt, "中断"),
		rawKeyHint(`${clear}/${exit}`, "清空/退出"),
		rawKeyHint("/", "命令"),
		rawKeyHint("!", "shell"),
		rawKeyHint(expand, "更多信息"),
	].join(" · ");
}

export class SproutaiStartupHeader implements Component {
	private expanded: boolean;
	private readonly version: string;

	constructor(version: string, expanded = false) {
		this.version = version;
		this.expanded = expanded;
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const divider = renderDivider(width);
		const lines: string[] = [divider, ...renderSproutaiLogo(this.version, width), divider];

		const compactOnboarding = startupLine(
			"[CLI和WebUI]",
			"描述要处理的代码、部署或服务器问题，我会执行命令、修改文件并同步进度",
			[150, 255, 210],
		);
		const onboarding = startupLine(
			"[SproutAI]",
			"负责代码修改审查、服务部署、服务器运维、排障和知识检索",
			[255, 232, 140],
		);
		const configPathLine = startupLine("[Agent配置]", getGlobalConfigDir(), [170, 210, 255]);

		// Rebuild key hints every render so fallbacks always apply
		if (this.expanded) {
			lines.push(buildExpandedInstructions());
			lines.push(onboarding);
			lines.push(configPathLine);
		} else {
			lines.push(buildCompactInstructions());
			lines.push(compactOnboarding);
			lines.push(onboarding);
			lines.push(configPathLine);
		}

		const tip = startupTipProvider?.()?.trim();
		if (tip) {
			lines.push(startupLine("[Tips]", tip, [255, 200, 120]));
		}
		return fitWidth(lines, width);
	}
}
