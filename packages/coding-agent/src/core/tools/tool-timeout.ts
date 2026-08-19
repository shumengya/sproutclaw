/**
 * Optional per-tool execution timeout.
 *
 * Unset resolver (or timeoutMs <= 0) keeps the previous unbounded behavior.
 * Extensions such as pi-tool-timeout install a resolver; wrapToolDefinition
 * then races execute() so a hung tool still returns an error result to the model.
 */

export type ToolTimeoutResolver = (toolName: string) => number | undefined;

export const TOOL_TIMEOUT_ERROR_NAME = "ToolTimeoutError";

let resolver: ToolTimeoutResolver | undefined;

/** Install or clear the process-wide tool timeout resolver. */
export function setToolTimeoutResolver(next: ToolTimeoutResolver | undefined): void {
	resolver = next;
}

/** Resolved timeout in milliseconds. 0 means no timeout. */
export function getToolTimeoutMs(toolName: string): number {
	if (!resolver) {
		return 0;
	}
	const value = resolver(toolName);
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return 0;
	}
	return Math.floor(value);
}

export class ToolTimeoutError extends Error {
	readonly toolName: string;
	readonly timeoutMs: number;

	constructor(toolName: string, timeoutMs: number) {
		super(formatToolTimeoutMessage(toolName, timeoutMs));
		this.name = TOOL_TIMEOUT_ERROR_NAME;
		this.toolName = toolName;
		this.timeoutMs = timeoutMs;
	}
}

export function isToolTimeoutError(error: unknown): error is ToolTimeoutError {
	return error instanceof ToolTimeoutError || (error instanceof Error && error.name === TOOL_TIMEOUT_ERROR_NAME);
}

export function formatToolTimeoutLabel(timeoutMs: number): string {
	if (timeoutMs <= 0) {
		return "off";
	}
	if (timeoutMs % 3_600_000 === 0) {
		return `${timeoutMs / 3_600_000}h`;
	}
	if (timeoutMs % 60_000 === 0) {
		return `${timeoutMs / 60_000}m`;
	}
	if (timeoutMs % 1000 === 0) {
		return `${timeoutMs / 1000}s`;
	}
	return `${timeoutMs}ms`;
}

export function formatToolTimeoutMessage(toolName: string, timeoutMs: number): string {
	const seconds = Math.max(1, Math.round(timeoutMs / 1000));
	const label = formatToolTimeoutLabel(timeoutMs);
	return [
		`Tool call timed out: \`${toolName}\` exceeded ${seconds} seconds (${label}) and was stopped.`,
		"Retry with a smaller or faster request; do not wait for this call to finish.",
		`工具调用超时：\`${toolName}\` 已超过 ${seconds} 秒（${label}）仍未返回，本次调用已中止。`,
		"请缩小范围或换更快的方式重试，不要继续等待这次调用。",
	].join(" ");
}

export async function executeWithToolTimeout<T>(
	run: (signal: AbortSignal | undefined) => Promise<T>,
	options: {
		timeoutMs: number;
		signal?: AbortSignal;
		toolName: string;
	},
): Promise<T> {
	const { timeoutMs, signal, toolName } = options;
	if (!(timeoutMs > 0)) {
		return run(signal);
	}

	const timeoutController = new AbortController();
	const combined = combineSignals(signal, timeoutController.signal);
	let timedOut = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let abortListener: (() => void) | undefined;

	const timeoutPromise = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			if (signal?.aborted) {
				reject(toAbortError(signal));
				return;
			}
			timedOut = true;
			timeoutController.abort();
			reject(new ToolTimeoutError(toolName, timeoutMs));
		}, timeoutMs);
	});

	const abortPromise =
		signal === undefined
			? undefined
			: new Promise<never>((_, reject) => {
					if (signal.aborted) {
						reject(toAbortError(signal));
						return;
					}
					abortListener = () => reject(toAbortError(signal));
					signal.addEventListener("abort", abortListener, { once: true });
				});

	const runPromise = run(combined.signal);
	// If the tool ignores abort and later rejects after we already timed out,
	// this prevents an unhandledRejection from crashing the process.
	void runPromise.catch(() => {});

	try {
		const racers: Array<Promise<T>> = [runPromise, timeoutPromise];
		if (abortPromise) {
			racers.push(abortPromise);
		}
		return await Promise.race(racers);
	} finally {
		if (timer !== undefined) {
			clearTimeout(timer);
		}
		if (signal && abortListener) {
			signal.removeEventListener("abort", abortListener);
		}
		combined.cleanup();
		if (timedOut) {
			timeoutController.abort();
		}
	}
}

function toAbortError(signal: AbortSignal): Error {
	if (signal.reason instanceof Error) {
		return signal.reason;
	}
	const error = new Error("Operation aborted");
	error.name = "AbortError";
	return error;
}

function combineSignals(
	userSignal: AbortSignal | undefined,
	timeoutSignal: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
	if (!userSignal) {
		return { signal: timeoutSignal, cleanup: () => {} };
	}

	const controller = new AbortController();
	const onAbort = () => {
		if (!controller.signal.aborted) {
			controller.abort();
		}
	};

	if (userSignal.aborted || timeoutSignal.aborted) {
		onAbort();
		return { signal: controller.signal, cleanup: () => {} };
	}

	userSignal.addEventListener("abort", onAbort);
	timeoutSignal.addEventListener("abort", onAbort);
	return {
		signal: controller.signal,
		cleanup: () => {
			userSignal.removeEventListener("abort", onAbort);
			timeoutSignal.removeEventListener("abort", onAbort);
		},
	};
}
