import { Box, type Component, Container, getCapabilities, Image, Spacer, Text, type TUI, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import chalk from "chalk";
import type { ToolDefinition, ToolRenderContext } from "../../../core/extensions/types.ts";
import { createAllToolDefinitions, type ToolName } from "../../../core/tools/index.ts";
import { getTextOutput as getRenderedTextOutput } from "../../../core/tools/render-utils.ts";
import { stripAnsi } from "../../../utils/ansi.ts";
import { convertToPng } from "../../../utils/image-convert.ts";
import { theme } from "../theme/theme.ts";

/** Compact argument preview for collapsed tool-call rows. */
const COLLAPSED_MAX_ARGS_CHARS = 240;

function isVisuallyBlankLine(line: string): boolean {
	return stripAnsi(line).trim() === "";
}

/** Text/Box renderers pad lines to the requested width; drop that before appending args. */
function trimTrailingPadding(line: string): string {
	return line.replace(/[ \t]+$/g, "");
}

function normalizeForCompact(value: unknown, depth = 0): unknown {
	if (depth > 3 || value == null) return value;
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (
			(trimmed.startsWith("{") && trimmed.endsWith("}")) ||
			(trimmed.startsWith("[") && trimmed.endsWith("]"))
		) {
			try {
				return normalizeForCompact(JSON.parse(trimmed), depth + 1);
			} catch {
				return value;
			}
		}
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((item) => normalizeForCompact(item, depth + 1));
	}
	if (typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
			out[key] = normalizeForCompact(nested, depth + 1);
		}
		return out;
	}
	return value;
}

function formatCompactToolArgs(args: unknown, maxChars = COLLAPSED_MAX_ARGS_CHARS): string {
	if (args == null) return "";
	let compact: string;
	if (typeof args === "string") {
		const trimmed = args.replace(/\s+/g, " ").trim();
		if (!trimmed) return "";
		try {
			compact = JSON.stringify(normalizeForCompact(JSON.parse(trimmed)));
		} catch {
			compact = trimmed;
		}
	} else if (typeof args !== "object") {
		compact = String(args);
	} else if (Array.isArray(args)) {
		if (args.length === 0) return "";
		try {
			compact = JSON.stringify(normalizeForCompact(args));
		} catch {
			return "";
		}
	} else if (Object.keys(args as Record<string, unknown>).length === 0) {
		return "";
	} else {
		try {
			compact = JSON.stringify(normalizeForCompact(args));
		} catch {
			return "";
		}
	}
	if (compact.length <= maxChars) return compact;
	return `${compact.slice(0, Math.max(0, maxChars - 3))}...`;
}

/**
 * Collapsed tool-call row: one line, optional compact args, truncated with "...".
 * Custom renderers keep their title; args are appended when the title has none yet.
 */
class CollapsedCallLine implements Component {
	private readonly child: Component;
	private readonly args: unknown;

	constructor(child: Component, args: unknown) {
		this.child = child;
		this.args = args;
	}

	invalidate(): void {
		this.child.invalidate?.();
	}

	render(width: number): string[] {
		const maxWidth = Math.max(1, width);
		const lines = this.child.render(Math.max(maxWidth, 10_000));
		let start = 0;
		while (start < lines.length && isVisuallyBlankLine(lines[start]!)) {
			start++;
		}
		const firstRaw = lines[start];
		if (firstRaw === undefined) {
			return [];
		}
		const first = trimTrailingPadding(firstRaw);

		const compact = formatCompactToolArgs(this.args);
		const stripped = stripAnsi(first);
		if (compact && !/:\s*(\{|\[|")/.test(stripped)) {
			const sep = theme.fg("muted", ": ");
			const remaining = maxWidth - visibleWidth(first) - visibleWidth(sep);
			if (remaining >= 4) {
				const argsText = truncateToWidth(compact, remaining, "...");
				return [`${first}${sep}${theme.fg("muted", argsText)}`];
			}
		}
		return [truncateToWidth(first, maxWidth, "...")];
	}
}

/** Prefix the first rendered line (status glyph for compact tool rows). */
class PrefixedComponent implements Component {
	private readonly prefix: string;
	private readonly child: Component;

	constructor(prefix: string, child: Component) {
		this.prefix = prefix;
		this.child = child;
	}

	invalidate(): void {
		this.child.invalidate?.();
	}

	render(width: number): string[] {
		const prefixWidth = visibleWidth(this.prefix);
		const childWidth = Math.max(1, width - prefixWidth);
		const lines = this.child.render(childWidth);
		// Empty call (e.g. suppressed self-render) → take no layout space.
		if (lines.length === 0) {
			return [];
		}
		const pad = " ".repeat(prefixWidth);
		return lines.map((line, i) => (i === 0 ? this.prefix + line : pad + line));
	}
}

export interface ToolExecutionOptions {
	showImages?: boolean;
	imageWidthCells?: number;
}

export class ToolExecutionComponent extends Container {
	private contentBox: Box;
	private contentText: Text;
	private selfRenderContainer: Container;
	private callRendererComponent?: Component;
	private resultRendererComponent?: Component;
	private rendererState: any = {};
	private imageComponents: Image[] = [];
	private imageSpacers: Spacer[] = [];
	private toolName: string;
	private toolCallId: string;
	private args: any;
	private expanded = false;
	private showImages: boolean;
	private imageWidthCells: number;
	private isPartial = true;
	private toolDefinition?: ToolDefinition<any, any>;
	private builtInToolDefinition?: ToolDefinition<any, any>;
	private ui: TUI;
	private cwd: string;
	private executionStarted = false;
	private argsComplete = false;
	private result?: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		isError: boolean;
		details?: any;
	};
	private convertedImages: Map<number, { data: string; mimeType: string }> = new Map();
	private hideComponent = false;

	constructor(
		toolName: string,
		toolCallId: string,
		args: any,
		options: ToolExecutionOptions = {},
		toolDefinition: ToolDefinition<any, any> | undefined,
		ui: TUI,
		cwd: string,
	) {
		super();
		this.toolName = toolName;
		this.toolCallId = toolCallId;
		this.args = args;
		this.toolDefinition = toolDefinition;
		this.builtInToolDefinition = createAllToolDefinitions(cwd)[toolName as ToolName];
		this.showImages = options.showImages ?? true;
		this.imageWidthCells = options.imageWidthCells ?? 60;
		this.ui = ui;
		this.cwd = cwd;

		// Compact shell: no spacer gap, no vertical padding (avoids fat colored bars).
		this.contentBox = new Box(0, 0, undefined);
		this.contentText = new Text("", 0, 0, undefined);
		this.selfRenderContainer = new Container();

		if (this.hasRendererDefinition()) {
			this.addChild(this.getRenderShell() === "self" ? this.selfRenderContainer : this.contentBox);
		} else {
			this.addChild(this.contentText);
		}

		this.updateDisplay();
	}

	private getCallRenderer(): ToolDefinition<any, any>["renderCall"] | undefined {
		if (!this.builtInToolDefinition) {
			return this.toolDefinition?.renderCall;
		}
		if (!this.toolDefinition) {
			return this.builtInToolDefinition.renderCall;
		}
		return this.toolDefinition.renderCall ?? this.builtInToolDefinition.renderCall;
	}

	private getResultRenderer(): ToolDefinition<any, any>["renderResult"] | undefined {
		if (!this.builtInToolDefinition) {
			return this.toolDefinition?.renderResult;
		}
		if (!this.toolDefinition) {
			return this.builtInToolDefinition.renderResult;
		}
		return this.toolDefinition.renderResult ?? this.builtInToolDefinition.renderResult;
	}

	private hasRendererDefinition(): boolean {
		return this.builtInToolDefinition !== undefined || this.toolDefinition !== undefined;
	}

	private getRenderShell(): "default" | "self" {
		if (!this.builtInToolDefinition) {
			return this.toolDefinition?.renderShell ?? "default";
		}
		if (!this.toolDefinition) {
			return this.builtInToolDefinition.renderShell ?? "default";
		}
		return this.toolDefinition.renderShell ?? this.builtInToolDefinition.renderShell ?? "default";
	}

	private getRenderContext(lastComponent: Component | undefined): ToolRenderContext {
		return {
			args: this.args,
			toolCallId: this.toolCallId,
			invalidate: () => {
				this.invalidate();
				this.ui.requestRender();
			},
			lastComponent,
			state: this.rendererState,
			cwd: this.cwd,
			executionStarted: this.executionStarted,
			argsComplete: this.argsComplete,
			isPartial: this.isPartial,
			expanded: this.expanded,
			showImages: this.showImages,
			isError: this.result?.isError ?? false,
		};
	}

	private statusPrefix(): string {
		if (this.isPartial) {
			return `${chalk.hex("#fbbf24")("○")} `;
		}
		if (this.result?.isError) {
			return `${chalk.hex("#ef4444")("●")} `;
		}
		return `${chalk.hex("#22c55e")("●")} `;
	}

	private createCallFallback(): Component {
		return new Text(theme.fg("toolTitle", theme.bold(this.toolName)), 0, 0);
	}

	private decorateCall(component: Component): Component {
		const body = this.expanded ? component : new CollapsedCallLine(component, this.args);
		return new PrefixedComponent(this.statusPrefix(), body);
	}

	private createResultFallback(): Component | undefined {
		const output = this.getTextOutput();
		if (!output) {
			return undefined;
		}
		return new Text(theme.fg("toolOutput", output), 0, 0);
	}

	updateArgs(args: any): void {
		this.args = args;
		this.updateDisplay();
	}

	markExecutionStarted(): void {
		this.executionStarted = true;
		this.updateDisplay();
		this.ui.requestRender();
	}

	setArgsComplete(): void {
		this.argsComplete = true;
		this.updateDisplay();
		this.ui.requestRender();
	}

	updateResult(
		result: {
			content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
			details?: any;
			isError: boolean;
		},
		isPartial = false,
	): void {
		this.result = result;
		this.isPartial = isPartial;
		this.updateDisplay();
		this.maybeConvertImagesForKitty();
	}

	private maybeConvertImagesForKitty(): void {
		const caps = getCapabilities();
		if (caps.images !== "kitty") return;
		if (!this.result) return;

		const imageBlocks = this.result.content.filter((c) => c.type === "image");
		for (let i = 0; i < imageBlocks.length; i++) {
			const img = imageBlocks[i];
			if (!img.data || !img.mimeType) continue;
			if (img.mimeType === "image/png") continue;
			if (this.convertedImages.has(i)) continue;

			const index = i;
			convertToPng(img.data, img.mimeType).then((converted) => {
				if (converted) {
					this.convertedImages.set(index, converted);
					this.updateDisplay();
					this.ui.requestRender();
				}
			});
		}
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.updateDisplay();
	}

	setShowImages(show: boolean): void {
		this.showImages = show;
		this.updateDisplay();
	}

	setImageWidthCells(width: number): void {
		this.imageWidthCells = Math.max(1, Math.floor(width));
		this.updateDisplay();
	}

	override invalidate(): void {
		super.invalidate();
		this.updateDisplay();
	}

	override render(width: number): string[] {
		if (this.hideComponent) {
			return [];
		}

		if (this.hasRendererDefinition() && this.getRenderShell() === "self") {
			const contentLines = this.selfRenderContainer.render(width);
			if (contentLines.length === 0 && this.imageComponents.length === 0) {
				return [];
			}

			const lines: string[] = [];
			if (contentLines.length > 0) {
				lines.push("");
				lines.push(...contentLines);
			}
			for (let i = 0; i < this.imageComponents.length; i++) {
				const spacer = this.imageSpacers[i];
				if (spacer) {
					lines.push(...spacer.render(width));
				}
				const imageComponent = this.imageComponents[i];
				if (imageComponent) {
					lines.push(...imageComponent.render(width));
				}
			}
			return lines;
		}

		return super.render(width);
	}

	private updateDisplay(): void {
		// Collapsed: no full-width background (avoids loud green/red banners).
		// Expanded: soft tinted panel with a little horizontal inset.
		const bgFn = this.expanded
			? this.isPartial
				? (text: string) => theme.bg("toolPendingBg", text)
				: this.result?.isError
					? (text: string) => theme.bg("toolErrorBg", text)
					: (text: string) => theme.bg("toolSuccessBg", text)
			: undefined;

		let hasContent = false;
		this.hideComponent = false;
		if (this.hasRendererDefinition()) {
			const renderContainer = this.getRenderShell() === "self" ? this.selfRenderContainer : this.contentBox;
			if (renderContainer instanceof Box) {
				renderContainer.setBgFn(bgFn);
				renderContainer.setPadding(this.expanded ? 1 : 0, 0);
			}
			renderContainer.clear();

			const callRenderer = this.getCallRenderer();
			if (!callRenderer) {
				renderContainer.addChild(this.decorateCall(this.createCallFallback()));
				hasContent = true;
			} else {
				try {
					const component = callRenderer(this.args, theme, this.getRenderContext(this.callRendererComponent));
					this.callRendererComponent = component;
					renderContainer.addChild(this.decorateCall(component));
					hasContent = true;
				} catch {
					this.callRendererComponent = undefined;
					renderContainer.addChild(this.decorateCall(this.createCallFallback()));
					hasContent = true;
				}
			}

			if (this.result) {
				const resultRenderer = this.getResultRenderer();
				if (!resultRenderer) {
					const component = this.createResultFallback();
					if (component) {
						renderContainer.addChild(this.maybeClampResult(component));
						hasContent = true;
					}
				} else {
					try {
						const component = resultRenderer(
							{ content: this.result.content as any, details: this.result.details },
							{ expanded: this.expanded, isPartial: this.isPartial },
							theme,
							this.getRenderContext(this.resultRendererComponent),
						);
						this.resultRendererComponent = component;
						renderContainer.addChild(this.maybeClampResult(component));
						hasContent = true;
					} catch {
						this.resultRendererComponent = undefined;
						const component = this.createResultFallback();
						if (component) {
							renderContainer.addChild(this.maybeClampResult(component));
							hasContent = true;
						}
					}
				}
			}
		} else {
			this.contentText.setCustomBgFn(bgFn);
			this.contentText.setText(this.formatToolExecution());
			hasContent = true;
		}

		for (const img of this.imageComponents) {
			this.removeChild(img);
		}
		this.imageComponents = [];
		for (const spacer of this.imageSpacers) {
			this.removeChild(spacer);
		}
		this.imageSpacers = [];

		if (this.result && this.expanded) {
			const imageBlocks = this.result.content.filter((c) => c.type === "image");
			const caps = getCapabilities();
			for (let i = 0; i < imageBlocks.length; i++) {
				const img = imageBlocks[i];
				if (caps.images && this.showImages && img.data && img.mimeType) {
					const converted = this.convertedImages.get(i);
					const imageData = converted?.data ?? img.data;
					const imageMimeType = converted?.mimeType ?? img.mimeType;
					if (caps.images === "kitty" && imageMimeType !== "image/png") continue;

					const spacer = new Spacer(1);
					this.addChild(spacer);
					this.imageSpacers.push(spacer);
					const imageComponent = new Image(
						imageData,
						imageMimeType,
						{ fallbackColor: (s: string) => theme.fg("toolOutput", s) },
						{ maxWidthCells: this.imageWidthCells },
					);
					this.imageComponents.push(imageComponent);
					this.addChild(imageComponent);
				}
			}
		}

		if (this.hasRendererDefinition() && !hasContent && this.imageComponents.length === 0) {
			this.hideComponent = true;
		}
	}

	private getTextOutput(): string {
		return getRenderedTextOutput(this.result, this.showImages);
	}

	private maybeClampResult(component: Component): Component {
		if (this.expanded) {
			return component;
		}
		// Collapsed: hide result body entirely — title line is enough.
		return new Text("", 0, 0);
	}

	private formatToolExecution(): string {
		const title = theme.fg("toolTitle", theme.bold(this.toolName));
		let text = `${this.statusPrefix()}${title}`;
		if (!this.expanded) {
			const compact = formatCompactToolArgs(this.args);
			if (compact) {
				text += theme.fg("muted", `: ${compact}`);
			}
			return text;
		}
		const content = JSON.stringify(this.args, null, 2);
		if (content) {
			text += `\n\n${content}`;
		}
		const output = this.getTextOutput();
		if (output) {
			text += `\n${output}`;
		}
		return text;
	}
}
