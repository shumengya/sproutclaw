import { Marked, type Token, Tokenizer, type Tokens } from "marked";
import { getCapabilities, hyperlink, isImageLine } from "../terminal-image.ts";
import type { Component } from "../tui.ts";
import {
	applyBackgroundToLine,
	extractAnsiCode,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "../utils.ts";

const STRICT_STRIKETHROUGH_REGEX = /^(~~)(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\s~\\]))\1(?=[^~]|$)/;

class StrictStrikethroughTokenizer extends Tokenizer {
	override del(src: string): Tokens.Del | undefined {
		const match = STRICT_STRIKETHROUGH_REGEX.exec(src);
		if (!match) {
			return undefined;
		}

		const text = match[2];
		return {
			type: "del",
			raw: match[0],
			text,
			tokens: this.lexer.inlineTokens(text),
		};
	}
}

function trimPartialClosingFences(tokens: readonly Token[]): void {
	const token = tokens[tokens.length - 1];
	if (token?.type === "list") {
		trimPartialClosingFences(token.items[token.items.length - 1]?.tokens ?? []);
		return;
	}
	if (token?.type === "blockquote") {
		trimPartialClosingFences(token.tokens ?? []);
		return;
	}
	if (token?.type !== "code") {
		return;
	}

	// Trim streamed partial closing fences so code blocks do not shrink/flicker
	// when the final fence character arrives. See https://github.com/earendil-works/pi/issues/5825.
	const marker = /^(`{3,}|~{3,})/.exec(token.raw)?.[1];
	const lastLine = token.raw.split("\n").pop();
	if (!marker || !lastLine || lastLine.length >= marker.length || lastLine !== marker[0]?.repeat(lastLine.length)) {
		return;
	}

	token.text = token.text.slice(0, -lastLine.length).replace(/\n$/, "");
}

/** True when a rendered line is a markdown table box row (borders already fitted). */
function isMarkdownTableLine(line: string): boolean {
	let i = 0;
	while (i < line.length) {
		const ansi = extractAnsiCode(line, i);
		if (ansi) {
			i += ansi.length;
			continue;
		}
		break;
	}

	const first = line[i];
	if (first === "┌" || first === "├" || first === "└") {
		return true;
	}
	if (first !== "│") {
		return false;
	}

	// Table data/header rows have multiple │ borders; blockquotes use a single leading │.
	let borderCount = 0;
	for (let j = i; j < line.length; ) {
		const ansi = extractAnsiCode(line, j);
		if (ansi) {
			j += ansi.length;
			continue;
		}
		if (line[j] === "│") {
			borderCount++;
			if (borderCount >= 2) {
				return true;
			}
		}
		j++;
	}
	return false;
}

const markdownParser = new Marked();
markdownParser.setOptions({
	tokenizer: new StrictStrikethroughTokenizer(),
});

/**
 * Default text styling for markdown content.
 * Applied to all text unless overridden by markdown formatting.
 */
export interface DefaultTextStyle {
	/** Foreground color function */
	color?: (text: string) => string;
	/** Background color function */
	bgColor?: (text: string) => string;
	/** Bold text */
	bold?: boolean;
	/** Italic text */
	italic?: boolean;
	/** Strikethrough text */
	strikethrough?: boolean;
	/** Underline text */
	underline?: boolean;
}

/**
 * Theme functions for markdown elements.
 * Each function takes text and returns styled text with ANSI codes.
 */
export interface MarkdownTheme {
	heading: (text: string) => string;
	/** H3–H6; falls back to heading when omitted */
	headingMuted?: (text: string) => string;
	link: (text: string) => string;
	linkUrl: (text: string) => string;
	code: (text: string) => string;
	codeBlock: (text: string) => string;
	codeBlockBorder: (text: string) => string;
	quote: (text: string) => string;
	quoteBorder: (text: string) => string;
	hr: (text: string) => string;
	listBullet: (text: string) => string;
	/** Table box-drawing; falls back to codeBlockBorder when omitted */
	tableBorder?: (text: string) => string;
	/** HTML <kbd>; falls back to code when omitted */
	kbd?: (text: string) => string;
	/** HTML <mark>; falls back to bold+underline when omitted */
	mark?: (text: string) => string;
	bold: (text: string) => string;
	italic: (text: string) => string;
	strikethrough: (text: string) => string;
	underline: (text: string) => string;
	highlightCode?: (code: string, lang?: string) => string[];
	/** Prefix applied to each rendered code block line (default: "  ") */
	codeBlockIndent?: string;
}

export interface MarkdownOptions {
	/** Preserve source list markers instead of normalizing them. */
	preserveOrderedListMarkers?: boolean;
}

interface InlineStyleContext {
	applyText: (text: string) => string;
	stylePrefix: string;
}

export class Markdown implements Component {
	private text: string;
	private paddingX: number; // Left/right padding
	private paddingY: number; // Top/bottom padding
	private defaultTextStyle?: DefaultTextStyle;
	private theme: MarkdownTheme;
	private options: MarkdownOptions;
	private defaultStylePrefix?: string;

	// Cache for rendered output
	private cachedText?: string;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		text: string,
		paddingX: number,
		paddingY: number,
		theme: MarkdownTheme,
		defaultTextStyle?: DefaultTextStyle,
		options?: MarkdownOptions,
	) {
		this.text = text;
		this.paddingX = paddingX;
		this.paddingY = paddingY;
		this.theme = theme;
		this.defaultTextStyle = defaultTextStyle;
		this.options = options ? { ...options } : {};
	}

	setText(text: string): void {
		this.text = text;
		this.invalidate();
	}

	invalidate(): void {
		this.cachedText = undefined;
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	render(width: number): string[] {
		// Check cache
		if (this.cachedLines && this.cachedText === this.text && this.cachedWidth === width) {
			return this.cachedLines;
		}

		// Calculate available width for content (subtract horizontal padding)
		const contentWidth = Math.max(1, width - this.paddingX * 2);

		// Don't render anything if there's no actual text
		if (!this.text || this.text.trim() === "") {
			const result: string[] = [];
			// Update cache
			this.cachedText = this.text;
			this.cachedWidth = width;
			this.cachedLines = result;
			return result;
		}

		// Replace tabs with 3 spaces for consistent rendering
		const normalizedText = this.text.replace(/\t/g, "   ");

		// Parse markdown to HTML-like tokens
		const tokens = markdownParser.lexer(normalizedText);
		trimPartialClosingFences(tokens);

		// Convert tokens to styled terminal output
		const renderedLines: string[] = [];

		for (let i = 0; i < tokens.length; i++) {
			const token = tokens[i];
			const nextToken = tokens[i + 1];
			const tokenLines = this.renderToken(token, contentWidth, nextToken?.type);
			for (const tokenLine of tokenLines) {
				renderedLines.push(tokenLine);
			}
		}

		// Wrap lines (NO padding, NO background yet).
		// Table rows are already width-fitted with box borders — re-wrapping them
		// would slice mid-row and break vertical alignment (especially with CJK).
		const wrappedLines: string[] = [];
		for (const line of renderedLines) {
			if (isImageLine(line) || isMarkdownTableLine(line)) {
				wrappedLines.push(line);
			} else {
				for (const wrappedLine of wrapTextWithAnsi(line, contentWidth)) {
					wrappedLines.push(wrappedLine);
				}
			}
		}

		// Add margins and background to each wrapped line
		const leftMargin = " ".repeat(this.paddingX);
		const rightMargin = " ".repeat(this.paddingX);
		const bgFn = this.defaultTextStyle?.bgColor;
		const contentLines: string[] = [];

		for (const line of wrappedLines) {
			if (isImageLine(line)) {
				contentLines.push(line);
				continue;
			}

			const lineWithMargins = leftMargin + line + rightMargin;

			if (bgFn) {
				contentLines.push(applyBackgroundToLine(lineWithMargins, width, bgFn));
			} else {
				// No background - just pad to width
				const visibleLen = visibleWidth(lineWithMargins);
				const paddingNeeded = Math.max(0, width - visibleLen);
				contentLines.push(lineWithMargins + " ".repeat(paddingNeeded));
			}
		}

		// Add top/bottom padding (empty lines)
		const emptyLine = " ".repeat(width);
		const emptyLines: string[] = [];
		for (let i = 0; i < this.paddingY; i++) {
			const line = bgFn ? applyBackgroundToLine(emptyLine, width, bgFn) : emptyLine;
			emptyLines.push(line);
		}

		// Combine top padding, content, and bottom padding
		const result = emptyLines.concat(contentLines, emptyLines);

		// Update cache
		this.cachedText = this.text;
		this.cachedWidth = width;
		this.cachedLines = result;

		return result.length > 0 ? result : [""];
	}

	/**
	 * Apply default text style to a string.
	 * This is the base styling applied to all text content.
	 * NOTE: Background color is NOT applied here - it's applied at the padding stage
	 * to ensure it extends to the full line width.
	 */
	private applyDefaultStyle(text: string): string {
		if (!this.defaultTextStyle) {
			return text;
		}

		let styled = text;

		// Apply foreground color (NOT background - that's applied at padding stage)
		if (this.defaultTextStyle.color) {
			styled = this.defaultTextStyle.color(styled);
		}

		// Apply text decorations using this.theme
		if (this.defaultTextStyle.bold) {
			styled = this.theme.bold(styled);
		}
		if (this.defaultTextStyle.italic) {
			styled = this.theme.italic(styled);
		}
		if (this.defaultTextStyle.strikethrough) {
			styled = this.theme.strikethrough(styled);
		}
		if (this.defaultTextStyle.underline) {
			styled = this.theme.underline(styled);
		}

		return styled;
	}

	private getDefaultStylePrefix(): string {
		if (!this.defaultTextStyle) {
			return "";
		}

		if (this.defaultStylePrefix !== undefined) {
			return this.defaultStylePrefix;
		}

		const sentinel = "\u0000";
		let styled = sentinel;

		if (this.defaultTextStyle.color) {
			styled = this.defaultTextStyle.color(styled);
		}

		if (this.defaultTextStyle.bold) {
			styled = this.theme.bold(styled);
		}
		if (this.defaultTextStyle.italic) {
			styled = this.theme.italic(styled);
		}
		if (this.defaultTextStyle.strikethrough) {
			styled = this.theme.strikethrough(styled);
		}
		if (this.defaultTextStyle.underline) {
			styled = this.theme.underline(styled);
		}

		const sentinelIndex = styled.indexOf(sentinel);
		this.defaultStylePrefix = sentinelIndex >= 0 ? styled.slice(0, sentinelIndex) : "";
		return this.defaultStylePrefix;
	}

	private getStylePrefix(styleFn: (text: string) => string): string {
		const sentinel = "\u0000";
		const styled = styleFn(sentinel);
		const sentinelIndex = styled.indexOf(sentinel);
		return sentinelIndex >= 0 ? styled.slice(0, sentinelIndex) : "";
	}

	private getDefaultInlineStyleContext(): InlineStyleContext {
		return {
			applyText: (text: string) => this.applyDefaultStyle(text),
			stylePrefix: this.getDefaultStylePrefix(),
		};
	}

	private headingStyleFn(level: number): (text: string) => string {
		if (level === 1) {
			return (text: string) => this.theme.heading(this.theme.bold(this.theme.underline(text)));
		}
		if (level === 2) {
			return (text: string) => this.theme.heading(this.theme.bold(text));
		}
		const muted = this.theme.headingMuted ?? this.theme.heading;
		return (text: string) => muted(this.theme.bold(text));
	}

	private applyTableBorder(text: string): string {
		return (this.theme.tableBorder ?? this.theme.codeBlockBorder)(text);
	}

	private applyKbd(text: string): string {
		return (this.theme.kbd ?? this.theme.code)(` ${text} `);
	}

	private applyMark(text: string): string {
		if (this.theme.mark) {
			return this.theme.mark(text);
		}
		return this.theme.underline(this.theme.bold(text));
	}

	private decodeHtmlEntities(text: string): string {
		return text
			.replace(/&nbsp;/gi, " ")
			.replace(/&amp;/gi, "&")
			.replace(/&lt;/gi, "<")
			.replace(/&gt;/gi, ">")
			.replace(/&quot;/gi, '"')
			.replace(/&#39;/gi, "'")
			.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
			.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
	}

	/**
	 * Extract inner HTML for a matched open tag, respecting simple nesting of the same tag.
	 */
	private extractHtmlElement(
		html: string,
		start: number,
		tagName: string,
		openTagLength: number,
	): { content: string; end: number } {
		const lower = html.toLowerCase();
		const openPattern = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
		const closePattern = new RegExp(`</${tagName}\\s*>`, "gi");
		let depth = 1;
		let pos = start + openTagLength;

		while (pos < html.length && depth > 0) {
			openPattern.lastIndex = pos;
			closePattern.lastIndex = pos;
			const openMatch = openPattern.exec(lower);
			const closeMatch = closePattern.exec(lower);

			if (!closeMatch) {
				return { content: html.slice(start + openTagLength), end: html.length };
			}

			if (openMatch && openMatch.index < closeMatch.index) {
				depth++;
				pos = openMatch.index + openMatch[0].length;
			} else {
				depth--;
				if (depth === 0) {
					return {
						content: html.slice(start + openTagLength, closeMatch.index),
						end: closeMatch.index + closeMatch[0].length,
					};
				}
				pos = closeMatch.index + closeMatch[0].length;
			}
		}

		return { content: html.slice(start + openTagLength), end: html.length };
	}

	private styleHtmlElement(
		tagName: string,
		renderedInner: string,
		rawInner: string,
		styleContext: InlineStyleContext,
	): string {
		switch (tagName) {
			case "b":
			case "strong":
				return this.theme.bold(renderedInner);
			case "i":
			case "em":
				return this.theme.italic(renderedInner);
			case "code":
				return this.theme.code(this.decodeHtmlEntities(rawInner.trim()));
			case "kbd":
				return this.applyKbd(this.decodeHtmlEntities(rawInner.trim()));
			case "mark":
				return this.applyMark(renderedInner);
			case "sub":
				return styleContext.applyText("_(") + renderedInner + styleContext.applyText(")");
			case "sup":
				return styleContext.applyText("^(") + renderedInner + styleContext.applyText(")");
			case "details": {
				const summaryMatch = /<summary\b[^>]*>([\s\S]*?)<\/summary\s*>/i.exec(rawInner);
				if (summaryMatch) {
					const summary = this.renderHtmlSnippet(summaryMatch[1].trim(), styleContext);
					const bodyRaw = rawInner.slice(summaryMatch.index + summaryMatch[0].length).trim();
					const body = bodyRaw ? this.renderHtmlSnippet(bodyRaw, styleContext) : "";
					const bodyLines = body
						? body
								.split("\n")
								.map((line) => (line.length > 0 ? `  ${line}` : line))
								.join("\n")
						: "";
					return bodyLines ? `▸ ${summary}\n${bodyLines}` : `▸ ${summary}`;
				}
				return renderedInner;
			}
			case "summary":
				return `▸ ${renderedInner}`;
			case "p":
			case "div":
			case "span":
			case "a":
			default:
				return renderedInner;
		}
	}

	/**
	 * Lightweight semantic HTML → ANSI. Unknown tags are stripped; script/style discarded.
	 */
	private renderHtmlSnippet(html: string, styleContext?: InlineStyleContext): string {
		const resolvedStyleContext = styleContext ?? this.getDefaultInlineStyleContext();
		const { applyText, stylePrefix } = resolvedStyleContext;
		let result = "";
		let i = 0;

		while (i < html.length) {
			if (html[i] !== "<") {
				const next = html.indexOf("<", i);
				const text = next === -1 ? html.slice(i) : html.slice(i, next);
				const decoded = this.decodeHtmlEntities(text);
				result += decoded
					.split("\n")
					.map((segment) => applyText(segment))
					.join("\n");
				i = next === -1 ? html.length : next;
				continue;
			}

			const tagMatch = /^<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/.exec(html.slice(i));
			if (!tagMatch) {
				result += applyText("<");
				i++;
				continue;
			}

			const fullTag = tagMatch[0];
			const tagName = tagMatch[1].toLowerCase();
			const isClose = fullTag.startsWith("</");
			const selfClosing =
				/\/>$/.test(fullTag) || tagName === "br" || tagName === "hr" || tagName === "img" || tagName === "input";

			if (isClose) {
				i += fullTag.length;
				continue;
			}

			if (tagName === "br") {
				result += "\n";
				i += fullTag.length;
				continue;
			}

			if (tagName === "script" || tagName === "style") {
				const closeIdx = html.toLowerCase().indexOf(`</${tagName}>`, i + fullTag.length);
				i = closeIdx >= 0 ? closeIdx + tagName.length + 3 : html.length;
				continue;
			}

			if (selfClosing) {
				i += fullTag.length;
				continue;
			}

			const { content, end } = this.extractHtmlElement(html, i, tagName, fullTag.length);
			i = end;
			const inner = this.renderHtmlSnippet(content, resolvedStyleContext);
			result += this.styleHtmlElement(tagName, inner, content, resolvedStyleContext) + stylePrefix;
		}

		while (stylePrefix && result.endsWith(stylePrefix)) {
			result = result.slice(0, -stylePrefix.length);
		}

		return result;
	}

	private renderToken(
		token: Token,
		width: number,
		nextTokenType?: string,
		styleContext?: InlineStyleContext,
	): string[] {
		const lines: string[] = [];

		switch (token.type) {
			case "heading": {
				const headingLevel = token.depth;

				// Build a heading-specific style context so inline tokens (codespan, bold, etc.)
				// restore heading styling after their own ANSI resets instead of falling back to
				// the default text style. H1–H6 never show a `#` prefix.
				const headingStyleFn = this.headingStyleFn(headingLevel);

				const headingStyleContext: InlineStyleContext = {
					applyText: headingStyleFn,
					stylePrefix: this.getStylePrefix(headingStyleFn),
				};

				const headingText = this.renderInlineTokens(token.tokens || [], headingStyleContext);
				lines.push(headingText);
				if (nextTokenType && nextTokenType !== "space") {
					lines.push(""); // Add spacing after headings (unless space token follows)
				}
				break;
			}

			case "paragraph": {
				const paragraphText = this.renderInlineTokens(token.tokens || [], styleContext);
				lines.push(paragraphText);
				// Don't add spacing if next token is space or list
				if (nextTokenType && nextTokenType !== "list" && nextTokenType !== "space") {
					lines.push("");
				}
				break;
			}

			case "text":
				lines.push(this.renderInlineTokens([token], styleContext));
				break;

			case "code": {
				const indent = this.theme.codeBlockIndent ?? "  ";
				lines.push(this.theme.codeBlockBorder(`\`\`\`${token.lang || ""}`));
				if (this.theme.highlightCode) {
					const highlightedLines = this.theme.highlightCode(token.text, token.lang);
					for (const hlLine of highlightedLines) {
						lines.push(`${indent}${hlLine}`);
					}
				} else {
					// Split code by newlines and style each line
					const codeLines = token.text.split("\n");
					for (const codeLine of codeLines) {
						lines.push(`${indent}${this.theme.codeBlock(codeLine)}`);
					}
				}
				lines.push(this.theme.codeBlockBorder("```"));
				if (nextTokenType && nextTokenType !== "space") {
					lines.push(""); // Add spacing after code blocks (unless space token follows)
				}
				break;
			}

			case "list": {
				const listLines = this.renderList(token as Tokens.List, 0, width, styleContext);
				lines.push(...listLines);
				// Don't add spacing after lists if a space token follows
				// (the space token will handle it)
				break;
			}

			case "table": {
				const tableLines = this.renderTable(token as Tokens.Table, width, nextTokenType, styleContext);
				lines.push(...tableLines);
				break;
			}

			case "blockquote": {
				const quoteStyle = (text: string) => this.theme.quote(this.theme.italic(text));
				const quoteStylePrefix = this.getStylePrefix(quoteStyle);
				const applyQuoteStyle = (line: string): string => {
					if (!quoteStylePrefix) {
						return quoteStyle(line);
					}
					const lineWithReappliedStyle = line.replace(/\x1b\[0m/g, `\x1b[0m${quoteStylePrefix}`);
					return quoteStyle(lineWithReappliedStyle);
				};

				// Calculate available width for quote content (subtract border "│ " = 2 chars)
				const quoteContentWidth = Math.max(1, width - 2);

				// Blockquotes contain block-level tokens (paragraph, list, code, etc.), so render
				// children with renderToken() instead of renderInlineTokens().
				// Default message style should not apply inside blockquotes.
				const quoteInlineStyleContext: InlineStyleContext = {
					applyText: (text: string) => text,
					stylePrefix: quoteStylePrefix,
				};
				const quoteTokens = token.tokens || [];
				const renderedQuoteLines: string[] = [];
				for (let i = 0; i < quoteTokens.length; i++) {
					const quoteToken = quoteTokens[i];
					const nextQuoteToken = quoteTokens[i + 1];
					renderedQuoteLines.push(
						...this.renderToken(quoteToken, quoteContentWidth, nextQuoteToken?.type, quoteInlineStyleContext),
					);
				}

				// Avoid rendering an extra empty quote line before the outer blockquote spacing.
				while (renderedQuoteLines.length > 0 && renderedQuoteLines[renderedQuoteLines.length - 1] === "") {
					renderedQuoteLines.pop();
				}

				for (const quoteLine of renderedQuoteLines) {
					const styledLine = applyQuoteStyle(quoteLine);
					const wrappedLines = wrapTextWithAnsi(styledLine, quoteContentWidth);
					for (const wrappedLine of wrappedLines) {
						lines.push(this.theme.quoteBorder("│ ") + wrappedLine);
					}
				}
				if (nextTokenType && nextTokenType !== "space") {
					lines.push(""); // Add spacing after blockquotes (unless space token follows)
				}
				break;
			}

			case "hr":
				lines.push(this.theme.hr("─".repeat(Math.min(width, 80))));
				if (nextTokenType && nextTokenType !== "space") {
					lines.push(""); // Add spacing after horizontal rules (unless space token follows)
				}
				break;

			case "html":
				if ("raw" in token && typeof token.raw === "string") {
					const rendered = this.renderHtmlSnippet(token.raw.trim(), styleContext);
					if (rendered.length > 0) {
						for (const line of rendered.split("\n")) {
							lines.push(line);
						}
					}
				}
				break;

			case "space":
				// Space tokens represent blank lines in markdown
				lines.push("");
				break;

			default:
				// Handle any other token types as plain text
				if ("text" in token && typeof token.text === "string") {
					lines.push(token.text);
				}
		}

		return lines;
	}

	private renderInlineTokens(tokens: Token[], styleContext?: InlineStyleContext): string {
		let result = "";
		const resolvedStyleContext = styleContext ?? this.getDefaultInlineStyleContext();
		const { applyText, stylePrefix } = resolvedStyleContext;
		const applyTextWithNewlines = (text: string): string => {
			const segments: string[] = text.split("\n");
			return segments.map((segment: string) => applyText(segment)).join("\n");
		};

		for (const token of tokens) {
			switch (token.type) {
				case "text":
					// Text tokens in list items can have nested tokens for inline formatting
					if (token.tokens && token.tokens.length > 0) {
						result += this.renderInlineTokens(token.tokens, resolvedStyleContext);
					} else {
						result += applyTextWithNewlines(token.text);
					}
					break;

				case "paragraph":
					// Paragraph tokens contain nested inline tokens
					result += this.renderInlineTokens(token.tokens || [], resolvedStyleContext);
					break;

				case "strong": {
					const boldContent = this.renderInlineTokens(token.tokens || [], resolvedStyleContext);
					result += this.theme.bold(boldContent) + stylePrefix;
					break;
				}

				case "em": {
					const italicContent = this.renderInlineTokens(token.tokens || [], resolvedStyleContext);
					result += this.theme.italic(italicContent) + stylePrefix;
					break;
				}

				case "codespan":
					result += this.theme.code(token.text) + stylePrefix;
					break;

				case "link": {
					const linkText = this.renderInlineTokens(token.tokens || [], resolvedStyleContext);
					const styledLink = this.theme.link(this.theme.underline(linkText));
					if (getCapabilities().hyperlinks) {
						// OSC 8: render as a clickable hyperlink. The URL is not printed inline,
						// so we always show only the link text regardless of whether it matches href.
						result += hyperlink(styledLink, token.href) + stylePrefix;
					} else {
						// Fallback: print URL in parentheses when text differs from href.
						// Compare raw token.text (not styled) against href for the equality check.
						// For mailto: links strip the prefix (autolinked emails use text="foo@bar.com"
						// but href="mailto:foo@bar.com").
						const hrefForComparison = token.href.startsWith("mailto:") ? token.href.slice(7) : token.href;
						if (token.text === token.href || token.text === hrefForComparison) {
							result += styledLink + stylePrefix;
						} else {
							result += styledLink + this.theme.linkUrl(` (${token.href})`) + stylePrefix;
						}
					}
					break;
				}

				case "br":
					result += "\n";
					break;

				case "del": {
					const delContent = this.renderInlineTokens(token.tokens || [], resolvedStyleContext);
					result += this.theme.strikethrough(delContent) + stylePrefix;
					break;
				}

				case "html":
					if ("raw" in token && typeof token.raw === "string") {
						result += this.renderHtmlSnippet(token.raw, resolvedStyleContext);
					}
					break;

				default:
					// Handle any other inline token types as plain text
					if ("text" in token && typeof token.text === "string") {
						result += applyTextWithNewlines(token.text);
					}
			}
		}

		while (stylePrefix && result.endsWith(stylePrefix)) {
			result = result.slice(0, -stylePrefix.length);
		}

		return result;
	}

	private getOrderedListMarker(item: Tokens.ListItem): string | undefined {
		const match = /^(?: {0,3})(\d{1,9}[.)])[ \t]+/.exec(item.raw);
		return match ? `${match[1]} ` : undefined;
	}

	private getUnorderedListMarker(item: Tokens.ListItem): string | undefined {
		const match = /^(?: {0,3})([-+*])(?:[ \t]+|(?=\r?\n|$))/.exec(item.raw);
		return match ? `${match[1]} ` : undefined;
	}

	/**
	 * Render a list with proper nesting support
	 */
	private renderList(token: Tokens.List, depth: number, width: number, styleContext?: InlineStyleContext): string[] {
		const lines: string[] = [];
		const indent = "    ".repeat(depth);
		// Use the list's start property (defaults to 1 for ordered lists)
		const startNumber = typeof token.start === "number" ? token.start : 1;

		for (let i = 0; i < token.items.length; i++) {
			const item = token.items[i];
			const isLastItem = i === token.items.length - 1;
			const defaultUnordered = depth === 0 ? "• " : "◦ ";
			const bullet = token.ordered
				? this.options.preserveOrderedListMarkers
					? (this.getOrderedListMarker(item) ?? `${startNumber + i}. `)
					: `${startNumber + i}. `
				: this.options.preserveOrderedListMarkers
					? (this.getUnorderedListMarker(item) ?? defaultUnordered)
					: defaultUnordered;
			const taskMarker = item.task ? `${item.checked ? "☑" : "☐"} ` : "";
			const marker = bullet + taskMarker;
			const firstPrefix = indent + this.theme.listBullet(marker);
			const continuationPrefix = indent + " ".repeat(visibleWidth(marker));
			const itemWidth = Math.max(1, width - visibleWidth(firstPrefix));
			let renderedAnyLine = false;

			for (const itemToken of item.tokens) {
				if (itemToken.type === "list") {
					lines.push(...this.renderList(itemToken as Tokens.List, depth + 1, width, styleContext));
					renderedAnyLine = true;
					continue;
				}

				const itemLines = this.renderToken(itemToken, itemWidth, undefined, styleContext);
				for (const line of itemLines) {
					for (const wrappedLine of wrapTextWithAnsi(line, itemWidth)) {
						const linePrefix = renderedAnyLine ? continuationPrefix : firstPrefix;
						lines.push(linePrefix + wrappedLine);
						renderedAnyLine = true;
					}
				}
			}

			if (!renderedAnyLine) {
				lines.push(firstPrefix);
			}

			if (token.loose && !isLastItem) {
				lines.push("");
			}
		}

		return lines;
	}

	/**
	 * Get the visible width of the longest word in a string.
	 */
	private getLongestWordWidth(text: string, maxWidth?: number): number {
		const words = text.split(/\s+/).filter((word) => word.length > 0);
		let longest = 0;
		for (const word of words) {
			longest = Math.max(longest, visibleWidth(word));
		}
		if (maxWidth === undefined) {
			return longest;
		}
		return Math.min(longest, maxWidth);
	}

	/**
	 * Wrap a table cell to fit into a column.
	 *
	 * Delegates to wrapTextWithAnsi() so ANSI codes + long tokens are handled
	 * consistently with the rest of the renderer.
	 */
	private wrapCellText(text: string, maxWidth: number): string[] {
		return wrapTextWithAnsi(text, Math.max(1, maxWidth));
	}

	/** Pad or clamp cell text to an exact visible column width. */
	private padTableCell(text: string, width: number): string {
		const textWidth = visibleWidth(text);
		if (textWidth === width) {
			return text;
		}
		if (textWidth < width) {
			return text + " ".repeat(width - textWidth);
		}
		// Safety net: wrapped cells should already fit, but never let overflow
		// push box borders out of alignment.
		return truncateToWidth(text, width, "", true);
	}

	private buildTableRule(columnWidths: number[], kind: "top" | "mid" | "bottom"): string {
		const cells = columnWidths.map((w) => "─".repeat(w));
		if (kind === "top") {
			return this.applyTableBorder(`┌─${cells.join("─┬─")}─┐`);
		}
		if (kind === "bottom") {
			return this.applyTableBorder(`└─${cells.join("─┴─")}─┘`);
		}
		return this.applyTableBorder(`├─${cells.join("─┼─")}─┤`);
	}

	/**
	 * Render a table with width-aware cell wrapping.
	 * Cells that don't fit are wrapped to multiple lines.
	 */
	private renderTable(
		token: Tokens.Table,
		availableWidth: number,
		nextTokenType?: string,
		styleContext?: InlineStyleContext,
	): string[] {
		const lines: string[] = [];
		const numCols = token.header.length;

		if (numCols === 0) {
			return lines;
		}

		// Calculate border overhead: "│ " + (n-1) * " │ " + " │"
		// = 2 + (n-1) * 3 + 2 = 3n + 1
		const borderOverhead = 3 * numCols + 1;
		const availableForCells = availableWidth - borderOverhead;
		if (availableForCells < numCols) {
			// Too narrow to render a stable table. Fall back to raw markdown.
			const fallbackLines = token.raw ? wrapTextWithAnsi(token.raw, availableWidth) : [];
			if (nextTokenType && nextTokenType !== "space") {
				fallbackLines.push("");
			}
			return fallbackLines;
		}

		const maxUnbrokenWordWidth = 30;

		// Calculate natural column widths (what each column needs without constraints)
		const naturalWidths: number[] = [];
		const minWordWidths: number[] = [];
		for (let i = 0; i < numCols; i++) {
			const headerText = this.renderInlineTokens(token.header[i].tokens || [], styleContext);
			naturalWidths[i] = visibleWidth(headerText);
			minWordWidths[i] = Math.max(1, this.getLongestWordWidth(headerText, maxUnbrokenWordWidth));
		}
		for (const row of token.rows) {
			for (let i = 0; i < row.length; i++) {
				const cellText = this.renderInlineTokens(row[i].tokens || [], styleContext);
				naturalWidths[i] = Math.max(naturalWidths[i] || 0, visibleWidth(cellText));
				minWordWidths[i] = Math.max(
					minWordWidths[i] || 1,
					this.getLongestWordWidth(cellText, maxUnbrokenWordWidth),
				);
			}
		}

		let minColumnWidths = minWordWidths;
		let minCellsWidth = minColumnWidths.reduce((a, b) => a + b, 0);

		if (minCellsWidth > availableForCells) {
			minColumnWidths = new Array(numCols).fill(1);
			const remaining = availableForCells - numCols;

			if (remaining > 0) {
				const totalWeight = minWordWidths.reduce((total, width) => total + Math.max(0, width - 1), 0);
				const growth = minWordWidths.map((width) => {
					const weight = Math.max(0, width - 1);
					return totalWeight > 0 ? Math.floor((weight / totalWeight) * remaining) : 0;
				});

				for (let i = 0; i < numCols; i++) {
					minColumnWidths[i] += growth[i] ?? 0;
				}

				const allocated = growth.reduce((total, width) => total + width, 0);
				let leftover = remaining - allocated;
				for (let i = 0; leftover > 0 && i < numCols; i++) {
					minColumnWidths[i]++;
					leftover--;
				}
			}

			minCellsWidth = minColumnWidths.reduce((a, b) => a + b, 0);
		}

		// Calculate column widths that fit within available width
		const totalNaturalWidth = naturalWidths.reduce((a, b) => a + b, 0) + borderOverhead;
		let columnWidths: number[];

		if (totalNaturalWidth <= availableWidth) {
			// Everything fits naturally
			columnWidths = naturalWidths.map((width, index) => Math.max(width, minColumnWidths[index]));
		} else {
			// Need to shrink columns to fit
			const totalGrowPotential = naturalWidths.reduce((total, width, index) => {
				return total + Math.max(0, width - minColumnWidths[index]);
			}, 0);
			const extraWidth = Math.max(0, availableForCells - minCellsWidth);
			columnWidths = minColumnWidths.map((minWidth, index) => {
				const naturalWidth = naturalWidths[index];
				const minWidthDelta = Math.max(0, naturalWidth - minWidth);
				let grow = 0;
				if (totalGrowPotential > 0) {
					grow = Math.floor((minWidthDelta / totalGrowPotential) * extraWidth);
				}
				return minWidth + grow;
			});

			// Adjust for rounding errors - distribute remaining space
			const allocated = columnWidths.reduce((a, b) => a + b, 0);
			let remaining = availableForCells - allocated;
			while (remaining > 0) {
				let grew = false;
				for (let i = 0; i < numCols && remaining > 0; i++) {
					if (columnWidths[i] < naturalWidths[i]) {
						columnWidths[i]++;
						remaining--;
						grew = true;
					}
				}
				if (!grew) {
					break;
				}
			}
		}

		const pushRowLines = (cellLines: string[][], emphasize: boolean): void => {
			const rowLineCount = Math.max(...cellLines.map((c) => c.length), 1);
			for (let lineIdx = 0; lineIdx < rowLineCount; lineIdx++) {
				const rowParts = cellLines.map((linesForCell, colIdx) => {
					const text = linesForCell[lineIdx] || "";
					const padded = this.padTableCell(text, columnWidths[colIdx]);
					return emphasize ? this.theme.bold(padded) : padded;
				});
				const left = this.applyTableBorder("│");
				const mid = this.applyTableBorder("│");
				const right = this.applyTableBorder("│");
				lines.push(`${left} ${rowParts.join(` ${mid} `)} ${right}`);
			}
		};

		// Top border
		lines.push(this.buildTableRule(columnWidths, "top"));

		// Header
		const headerCellLines: string[][] = token.header.map((cell, i) => {
			const text = this.renderInlineTokens(cell.tokens || [], styleContext);
			return this.wrapCellText(text, columnWidths[i]);
		});
		pushRowLines(headerCellLines, true);
		lines.push(this.buildTableRule(columnWidths, "mid"));

		// Body rows with a horizontal rule after every row
		for (let rowIndex = 0; rowIndex < token.rows.length; rowIndex++) {
			const row = token.rows[rowIndex];
			const rowCellLines: string[][] = row.map((cell, i) => {
				const text = this.renderInlineTokens(cell.tokens || [], styleContext);
				return this.wrapCellText(text, columnWidths[i]);
			});
			pushRowLines(rowCellLines, false);
			if (rowIndex < token.rows.length - 1) {
				lines.push(this.buildTableRule(columnWidths, "mid"));
			}
		}

		// Bottom border
		lines.push(this.buildTableRule(columnWidths, "bottom"));

		if (nextTokenType && nextTokenType !== "space") {
			lines.push(""); // Add spacing after table
		}
		return lines;
	}
}
