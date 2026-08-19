import { describe, expect, it } from "vitest";
import { localizeErrorText } from "../src/utils/localize-error.ts";

const bunSocketClosedDisplay = "流式连接中途断开。通常是网关/代理超时或上游断流，可自动重试。";

describe("localizeErrorText", () => {
	it("translates Bun socket-closed fetch errors", () => {
		const english =
			"The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()";
		expect(localizeErrorText(english)).toBe(bunSocketClosedDisplay);
	});

	it("translates Bun socket-closed messages with a line break before to fetch()", () => {
		const english =
			"The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument\n to fetch()";
		expect(localizeErrorText(english)).toBe(bunSocketClosedDisplay);
	});

	it("translates short Bun socket-closed messages without the verbose hint", () => {
		expect(localizeErrorText("The socket connection was closed unexpectedly.")).toBe(bunSocketClosedDisplay);
	});

	it("leaves unrelated messages unchanged", () => {
		expect(localizeErrorText("rate limit exceeded")).toBe("rate limit exceeded");
	});
});
