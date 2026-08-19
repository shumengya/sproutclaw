import { afterEach, describe, expect, it } from "vitest";
import { wrapToolDefinition } from "../src/core/tools/tool-definition-wrapper.ts";
import {
	executeWithToolTimeout,
	formatToolTimeoutMessage,
	getToolTimeoutMs,
	isToolTimeoutError,
	setToolTimeoutResolver,
	ToolTimeoutError,
} from "../src/core/tools/tool-timeout.ts";

afterEach(() => {
	setToolTimeoutResolver(undefined);
});

describe("getToolTimeoutMs", () => {
	it("returns 0 when no resolver is installed", () => {
		expect(getToolTimeoutMs("bash")).toBe(0);
	});

	it("returns 0 for non-positive resolver values", () => {
		setToolTimeoutResolver(() => 0);
		expect(getToolTimeoutMs("bash")).toBe(0);
		setToolTimeoutResolver(() => -1);
		expect(getToolTimeoutMs("bash")).toBe(0);
		setToolTimeoutResolver(() => Number.NaN);
		expect(getToolTimeoutMs("bash")).toBe(0);
	});

	it("floors a positive timeout", () => {
		setToolTimeoutResolver((name) => (name === "bash" ? 1500.9 : 0));
		expect(getToolTimeoutMs("bash")).toBe(1500);
		expect(getToolTimeoutMs("read")).toBe(0);
	});
});

describe("executeWithToolTimeout", () => {
	it("returns the tool result when it finishes in time", async () => {
		const result = await executeWithToolTimeout(async () => "ok", {
			timeoutMs: 200,
			toolName: "fast",
		});
		expect(result).toBe("ok");
	});

	it("skips the timer when timeoutMs is 0", async () => {
		const result = await executeWithToolTimeout(async () => "ok", {
			timeoutMs: 0,
			toolName: "unlimited",
		});
		expect(result).toBe("ok");
	});

	it("rejects with ToolTimeoutError when the tool hangs", async () => {
		const started = Date.now();
		await expect(
			executeWithToolTimeout(
				async (signal) => {
					await new Promise<void>((resolve) => {
						const timer = setTimeout(resolve, 5_000);
						signal?.addEventListener("abort", () => {
							clearTimeout(timer);
							resolve();
						});
					});
					return "late";
				},
				{ timeoutMs: 40, toolName: "hang" },
			),
		).rejects.toSatisfy((error: unknown) => {
			expect(isToolTimeoutError(error)).toBe(true);
			expect(error).toBeInstanceOf(ToolTimeoutError);
			expect((error as ToolTimeoutError).toolName).toBe("hang");
			expect((error as ToolTimeoutError).timeoutMs).toBe(40);
			expect((error as Error).message).toContain("hang");
			expect((error as Error).message).toContain("工具调用超时");
			return true;
		});
		expect(Date.now() - started).toBeLessThan(1_000);
	});

	it("still unblocks when the tool ignores abort", async () => {
		await expect(
			executeWithToolTimeout(
				async () =>
					new Promise(() => {
						/* never settles and never observes abort */
					}),
				{ timeoutMs: 30, toolName: "deaf" },
			),
		).rejects.toBeInstanceOf(ToolTimeoutError);
	});

	it("does not surface a late rejection after timeout", async () => {
		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => {
			unhandled.push(reason);
		};
		process.on("unhandledRejection", onUnhandled);
		try {
			await expect(
				executeWithToolTimeout(
					async () => {
						await new Promise((resolve) => setTimeout(resolve, 60));
						throw new Error("late-failure");
					},
					{ timeoutMs: 20, toolName: "late" },
				),
			).rejects.toBeInstanceOf(ToolTimeoutError);
			await new Promise((resolve) => setTimeout(resolve, 80));
			expect(unhandled).toEqual([]);
		} finally {
			process.off("unhandledRejection", onUnhandled);
		}
	});

	it("propagates user abort instead of a timeout", async () => {
		const controller = new AbortController();
		const pending = executeWithToolTimeout(
			async (signal) =>
				new Promise<string>((_, reject) => {
					signal?.addEventListener("abort", () => reject(new Error("aborted-by-signal")));
				}),
			{ timeoutMs: 5_000, signal: controller.signal, toolName: "bash" },
		);
		controller.abort();
		await expect(pending).rejects.toThrow(/aborted/i);
	});

	it("forwards the combined abort signal into execute", async () => {
		let sawAbort = false;
		await expect(
			executeWithToolTimeout(
				async (signal) => {
					await new Promise<void>((resolve) => {
						signal?.addEventListener("abort", () => {
							sawAbort = true;
							resolve();
						});
					});
					return "aborted-run";
				},
				{ timeoutMs: 25, toolName: "signalled" },
			),
		).rejects.toBeInstanceOf(ToolTimeoutError);
		expect(sawAbort).toBe(true);
	});
});

describe("wrapToolDefinition timeout hook", () => {
	it("lets a fast tool succeed without a resolver", async () => {
		const tool = wrapToolDefinition({
			name: "echo",
			label: "echo",
			description: "echo",
			parameters: {} as never,
			execute: async () => ({
				content: [{ type: "text", text: "ok" }],
				details: {},
			}),
		});
		const result = await tool.execute("id-1", {});
		expect(result.content[0]).toMatchObject({ type: "text", text: "ok" });
	});

	it("throws ToolTimeoutError so the agent loop can return isError to the model", async () => {
		setToolTimeoutResolver(() => 20);
		const tool = wrapToolDefinition({
			name: "stuck",
			label: "stuck",
			description: "stuck",
			parameters: {} as never,
			execute: async () =>
				new Promise(() => {
					/* hang */
				}),
		});
		await expect(tool.execute("id-2", {})).rejects.toBeInstanceOf(ToolTimeoutError);
	});
});

describe("formatToolTimeoutMessage", () => {
	it("includes the tool name and both languages", () => {
		const message = formatToolTimeoutMessage("bash", 300_000);
		expect(message).toContain("`bash`");
		expect(message).toContain("300");
		expect(message).toContain("5m");
		expect(message).toContain("Tool call timed out");
		expect(message).toContain("工具调用超时");
	});
});
