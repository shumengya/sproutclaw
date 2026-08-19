import { describe, expect, it, vi } from "vitest";
import { InteractiveMode } from "../../../src/modes/interactive/interactive-mode.ts";

type RebindContext = {
	session: object;
	unsubscribe?: () => void;
	applyRuntimeSettings: () => void;
	renderCurrentSessionState: () => void;
	bindCurrentSessionExtensions: () => Promise<void>;
	subscribeToAgent: () => void;
	updateAvailableProviderCount: () => void;
	updateEditorBorderColor: () => void;
	updateTerminalTitle: () => void;
};

type SubscribeContext = {
	unsubscribe?: () => void;
	session: { subscribe: (listener: (event: unknown) => void) => () => void };
};

type InteractiveModePrototype = {
	rebindCurrentSession(this: RebindContext, options?: { renderBeforeBind?: boolean }): Promise<void>;
	subscribeToAgent(this: SubscribeContext): void;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as InteractiveModePrototype;

describe("overlapping startup and replacement session rebinds", () => {
	it("does not subscribe from the stale startup rebind", async () => {
		const startupSession = {};
		const replacementSession = {};
		let resolveStartupBind!: () => void;
		let resolveReplacementBind!: () => void;

		const startupBind = new Promise<void>((resolve) => {
			resolveStartupBind = resolve;
		});
		const replacementBind = new Promise<void>((resolve) => {
			resolveReplacementBind = resolve;
		});

		const subscribeToAgent = vi.fn();
		const updateTerminalTitle = vi.fn();
		let bindCount = 0;

		const context: RebindContext = {
			session: startupSession,
			applyRuntimeSettings: () => {},
			renderCurrentSessionState: () => {},
			bindCurrentSessionExtensions: () => {
				bindCount += 1;
				return bindCount === 1 ? startupBind : replacementBind;
			},
			subscribeToAgent,
			updateAvailableProviderCount: () => {},
			updateEditorBorderColor: () => {},
			updateTerminalTitle,
		};

		const startupRebind = interactiveModePrototype.rebindCurrentSession.call(context);
		expect(bindCount).toBe(1);

		context.session = replacementSession;
		const replacementRebind = interactiveModePrototype.rebindCurrentSession.call(context, {
			renderBeforeBind: true,
		});

		expect(bindCount).toBe(2);
		expect(subscribeToAgent).toHaveBeenCalledTimes(1);

		resolveStartupBind();
		await startupRebind;

		expect(subscribeToAgent).toHaveBeenCalledTimes(1);
		expect(updateTerminalTitle).not.toHaveBeenCalled();

		resolveReplacementBind();
		await replacementRebind;

		expect(subscribeToAgent).toHaveBeenCalledTimes(1);
		expect(updateTerminalTitle).toHaveBeenCalledTimes(1);
	});

	it("does not subscribe twice when two /new rebinds overlap", async () => {
		const firstSession = {};
		const secondSession = {};
		let resolveFirstBind!: () => void;
		let resolveSecondBind!: () => void;

		const firstBind = new Promise<void>((resolve) => {
			resolveFirstBind = resolve;
		});
		const secondBind = new Promise<void>((resolve) => {
			resolveSecondBind = resolve;
		});

		const subscribeToAgent = vi.fn();
		const updateTerminalTitle = vi.fn();
		let bindCount = 0;

		const context: RebindContext = {
			session: firstSession,
			applyRuntimeSettings: () => {},
			renderCurrentSessionState: () => {},
			bindCurrentSessionExtensions: () => {
				bindCount += 1;
				return bindCount === 1 ? firstBind : secondBind;
			},
			subscribeToAgent,
			updateAvailableProviderCount: () => {},
			updateEditorBorderColor: () => {},
			updateTerminalTitle,
		};

		const firstRebind = interactiveModePrototype.rebindCurrentSession.call(context, {
			renderBeforeBind: true,
		});
		expect(subscribeToAgent).toHaveBeenCalledTimes(1);

		context.session = secondSession;
		const secondRebind = interactiveModePrototype.rebindCurrentSession.call(context, {
			renderBeforeBind: true,
		});
		expect(subscribeToAgent).toHaveBeenCalledTimes(2);

		resolveFirstBind();
		await firstRebind;
		expect(subscribeToAgent).toHaveBeenCalledTimes(2);
		expect(updateTerminalTitle).not.toHaveBeenCalled();

		resolveSecondBind();
		await secondRebind;
		expect(subscribeToAgent).toHaveBeenCalledTimes(2);
		expect(updateTerminalTitle).toHaveBeenCalledTimes(1);
	});
});

describe("subscribeToAgent", () => {
	it("replaces the previous listener instead of stacking another one", () => {
		const firstUnsubscribe = vi.fn();
		const secondUnsubscribe = vi.fn();
		const subscribe = vi.fn().mockReturnValueOnce(firstUnsubscribe).mockReturnValueOnce(secondUnsubscribe);
		const context: SubscribeContext = {
			session: { subscribe },
		};

		interactiveModePrototype.subscribeToAgent.call(context);
		interactiveModePrototype.subscribeToAgent.call(context);

		expect(subscribe).toHaveBeenCalledTimes(2);
		expect(firstUnsubscribe).toHaveBeenCalledTimes(1);
		expect(secondUnsubscribe).not.toHaveBeenCalled();
		expect(context.unsubscribe).toBe(secondUnsubscribe);
	});
});
