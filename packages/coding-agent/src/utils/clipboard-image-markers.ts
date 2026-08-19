import { basename } from "node:path";

/**
 * Draft file attachment (images, zip, etc.).
 * Path-first: show `[filename]` in the composer; submit replaces markers with quoted paths for `read`.
 */
export interface PendingClipboardImage {
	id: number;
	path: string;
	/** Exact marker text inserted in the editor, e.g. `[screenshot.png]`. */
	marker: string;
}

/** Image extensions (clipboard bytes / blockImages). */
const IMAGE_PATH_EXT_REGEX = /\.(png|jpe?g|gif|webp)$/i;

/** Any normal file extension (zip, pdf, source files, …). */
const FILE_EXT_REGEX = /\.[a-zA-Z][a-zA-Z0-9]{0,19}$/;

export function isImageFilePath(filePath: string): boolean {
	return IMAGE_PATH_EXT_REGEX.test(filePath);
}

export function formatImageMarkerFromPath(filePath: string): string {
	return `[${basename(filePath)}]`;
}

/**
 * Style known attachment markers (display only). Prefer explicit marker list so
 * typed `[foo.ts]` text is not colored unless it was attached.
 */
export function styleEditorImageMarkers(
	text: string,
	color: (marker: string) => string,
	markers?: Iterable<string>,
): string {
	const list = markers
		? [...new Set([...markers].filter((marker) => marker.length > 0))].sort((a, b) => b.length - a.length)
		: [];

	if (list.length === 0) {
		return text;
	}

	let result = text;
	for (const marker of list) {
		result = result.split(marker).join(color(marker));
	}
	return result;
}

/**
 * Marker for an attached file. Same basename always keeps the original name
 * (no `(2)` suffix) so repeated pastes of the same file look identical.
 */
export function makeUniqueImageMarker(filePath: string, _existingMarkers?: Iterable<string>): string {
	return formatImageMarkerFromPath(filePath);
}

/**
 * Filter pending attachments to only those whose markers are still present in text.
 */
export function filterImagesByMarkers(
	pendingImages: PendingClipboardImage[],
	text: string,
): PendingClipboardImage[] {
	return pendingImages.filter((pending) => text.includes(pending.marker));
}

function looksLikeLocalFilePath(value: string): boolean {
	if (!value || !FILE_EXT_REGEX.test(value)) {
		return false;
	}
	// Prefer real filesystem paths (drag/drop / Explorer copy). Avoid turning
	// bare words like `readme.md` in prose into attachments unless path-like.
	return /[\\/]/.test(value) || /^[a-zA-Z]:/.test(value);
}

function looksLikeLocalDirectoryPath(value: string): boolean {
	if (!value) {
		return false;
	}
	const normalized = value.replace(/[\\/]+$/, "");
	if (!normalized || FILE_EXT_REGEX.test(normalized)) {
		return false;
	}
	return /[\\/]/.test(normalized) || /^[a-zA-Z]:/.test(normalized);
}

function looksLikeLocalPath(value: string): boolean {
	return looksLikeLocalFilePath(value) || looksLikeLocalDirectoryPath(value);
}

/**
 * Parse pasted text that looks like one or more local file or directory paths
 * (drag-drop / path clipboard) — images, zip, other files, and folders.
 */
export function parsePastedFilePathCandidates(text: string): string[] {
	const trimmed = text.trim();
	if (!trimmed) {
		return [];
	}

	const unquote = (value: string): string => value.trim().replace(/^['"]+|['"]+$/g, "");

	if (!trimmed.includes("\n") && !trimmed.includes("\r")) {
		const single = unquote(trimmed);
		return looksLikeLocalPath(single) ? [single] : [];
	}

	return trimmed
		.split(/\r?\n/)
		.map(unquote)
		.filter((line) => line.length > 0 && looksLikeLocalPath(line));
}

/** @deprecated Use parsePastedFilePathCandidates */
export const parsePastedImagePathCandidates = parsePastedFilePathCandidates;

/**
 * Replace `[filename]` markers with quoted absolute paths so the model can `read` them.
 * Markers are removed from the message body; each path is appended on its own line
 * (one line per marker occurrence, so repeated identical markers stay one-per-line).
 */
export function preparePathsForSubmit(pendingImages: PendingClipboardImage[], text: string): { text: string } {
	const pathByMarker = new Map<string, string>();
	for (const pending of pendingImages) {
		if (!pathByMarker.has(pending.marker)) {
			pathByMarker.set(pending.marker, pending.path);
		}
	}
	if (pathByMarker.size === 0) {
		return { text };
	}

	const markers = [...pathByMarker.keys()].sort((a, b) => b.length - a.length);
	const hits: Array<{ start: number; end: number; path: string }> = [];
	for (const marker of markers) {
		let from = 0;
		while (from < text.length) {
			const index = text.indexOf(marker, from);
			if (index < 0) break;
			const end = index + marker.length;
			const overlaps = hits.some((hit) => index < hit.end && end > hit.start);
			if (!overlaps) {
				hits.push({ start: index, end, path: pathByMarker.get(marker)! });
			}
			from = end;
		}
	}
	hits.sort((a, b) => a.start - b.start);
	if (hits.length === 0) {
		return { text };
	}

	let body = text;
	for (let i = hits.length - 1; i >= 0; i--) {
		const hit = hits[i]!;
		body = body.slice(0, hit.start) + body.slice(hit.end);
	}
	body = body
		.replace(/[ \t]+/g, " ")
		.replace(/ *\n */g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();

	const pathLines = hits.map((hit) => `"${hit.path}"`);

	if (body.length === 0) {
		return { text: pathLines.join("\n") };
	}

	return { text: `${body}\n\n${pathLines.join("\n")}` };
}
