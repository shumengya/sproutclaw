import { describe, expect, test } from "vitest";
import {
	filterImagesByMarkers,
	formatImageMarkerFromPath,
	isImageFilePath,
	makeUniqueImageMarker,
	parsePastedFilePathCandidates,
	preparePathsForSubmit,
	styleEditorImageMarkers,
	type PendingClipboardImage,
} from "../src/utils/clipboard-image-markers.ts";

function pending(path: string, marker?: string): PendingClipboardImage {
	const resolvedMarker = marker ?? formatImageMarkerFromPath(path);
	return { id: 1, path, marker: resolvedMarker };
}

describe("clipboard-image-markers", () => {
	test("formatImageMarkerFromPath uses basename", () => {
		expect(formatImageMarkerFromPath("D:\\shots\\screenshot-2026-05-13-205547.png")).toBe(
			"[screenshot-2026-05-13-205547.png]",
		);
		expect(formatImageMarkerFromPath("D:\\work\\my-album.zip")).toBe("[my-album.zip]");
	});

	test("isImageFilePath detects images only", () => {
		expect(isImageFilePath("a.png")).toBe(true);
		expect(isImageFilePath("a.zip")).toBe(false);
	});

	test("makeUniqueImageMarker keeps original basename without numbering", () => {
		const first = makeUniqueImageMarker("/tmp/a.png", []);
		const second = makeUniqueImageMarker("/other/a.png", [first]);
		expect(first).toBe("[a.png]");
		expect(second).toBe("[a.png]");
	});

	test("filterImagesByMarkers keeps only markers still in text", () => {
		const pendingImages = [
			pending("/tmp/a.png", "[a.png]"),
			pending("/tmp/b.png", "[b.png]"),
		];
		expect(filterImagesByMarkers(pendingImages, "look [b.png]")).toEqual([pendingImages[1]]);
	});

	test("parsePastedFilePathCandidates detects image and non-image paths", () => {
		expect(parsePastedFilePathCandidates('"/home/user/shots/a.png"')).toEqual(["/home/user/shots/a.png"]);
		expect(
			parsePastedFilePathCandidates(
				'"D:\\user\\Pictures\\Screenshots\\my-album\\my-album.zip"',
			),
		).toEqual(["D:\\user\\Pictures\\Screenshots\\my-album\\my-album.zip"]);
		expect(parsePastedFilePathCandidates("/tmp/a.png\n/tmp/b.jpg\nreadme.md")).toEqual([
			"/tmp/a.png",
			"/tmp/b.jpg",
		]);
		expect(parsePastedFilePathCandidates("hello world")).toEqual([]);
		expect(parsePastedFilePathCandidates("readme.md")).toEqual([]);
	});

	test("parsePastedFilePathCandidates detects directory paths", () => {
		expect(
			parsePastedFilePathCandidates(
				"D:\\work\\AI\\sproutai\\release\\sproutai\\sproutai-core\\agents\\.codepilot",
			),
		).toEqual(["D:\\work\\AI\\sproutai\\release\\sproutai\\sproutai-core\\agents\\.codepilot"]);
		expect(parsePastedFilePathCandidates("D:\\projects\\src")).toEqual(["D:\\projects\\src"]);
		expect(parsePastedFilePathCandidates("D:\\projects\\src\\")).toEqual(["D:\\projects\\src\\"]);
		expect(parsePastedFilePathCandidates("/home/user/projects/src")).toEqual(["/home/user/projects/src"]);
		expect(parsePastedFilePathCandidates("src")).toEqual([]);
	});

	test("formatImageMarkerFromPath uses directory basename", () => {
		expect(formatImageMarkerFromPath("D:\\agents\\.codepilot")).toBe("[.codepilot]");
		expect(formatImageMarkerFromPath("/home/user/projects/src")).toBe("[src]");
	});

	test("preparePathsForSubmit appends directory path on its own line", () => {
		const dirPath = "D:\\agents\\.codepilot";
		const marker = "[.codepilot]";
		const result = preparePathsForSubmit([pending(dirPath, marker)], `查看 ${marker}`);
		expect(result.text).toBe(`查看\n\n"${dirPath}"`);
	});

	test("preparePathsForSubmit appends a single path on its own line", () => {
		const shotPath = "D:\\user\\Pictures\\Screenshots\\screenshot-2026-05-13-205547.png";
		const marker = "[screenshot-2026-05-13-205547.png]";
		const result = preparePathsForSubmit([pending(shotPath, marker)], `请看 ${marker}`);
		expect(result.text).toBe(`请看\n\n"${shotPath}"`);
	});

	test("preparePathsForSubmit lists multiple paths one per line", () => {
		const base = "D:\\user\\Pictures\\Screenshots\\my-album";
		const paths = [
			`${base}\\screenshot-2026-05-13-210135.png`,
			`${base}\\screenshot-2026-05-13-215541.png`,
			`${base}\\screenshot-2026-05-13-220920.png`,
		];
		const markers = paths.map((path) => formatImageMarkerFromPath(path));
		const pendingImages = paths.map((path, index) => pending(path, markers[index]!));
		const body = `分析这三张 ${markers.join(" ")}`;
		const result = preparePathsForSubmit(pendingImages, body);

		expect(result.text).toBe(
			`分析这三张\n\n"${paths[0]}"\n"${paths[1]}"\n"${paths[2]}"`,
		);
	});

	test("preparePathsForSubmit leaves text unchanged when no markers match", () => {
		expect(preparePathsForSubmit([], "hello")).toEqual({ text: "hello" });
	});

	test("preparePathsForSubmit emits one path line per identical marker occurrence", () => {
		const path = "D:\\shots\\screenshot-2026-05-13-205547.png";
		const marker = "[screenshot-2026-05-13-205547.png]";
		const result = preparePathsForSubmit([pending(path, marker)], `${marker} ${marker}`);
		expect(result.text).toBe(`"${path}"\n"${path}"`);
	});

	test("styleEditorImageMarkers only colors provided markers", () => {
		const styled = styleEditorImageMarkers(
			"[a.png] hello [b.jpg] [c.zip]",
			(marker) => `<${marker}>`,
			["[a.png]", "[c.zip]"],
		);
		expect(styled).toBe("<[a.png]> hello [b.jpg] <[c.zip]>");
	});
});
