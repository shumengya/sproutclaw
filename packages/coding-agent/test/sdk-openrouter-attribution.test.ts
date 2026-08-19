import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { mergeProviderAttributionHeaders } from "../src/core/provider-attribution.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

function createModel(provider: string, baseUrl: string, id = `${provider}-test-model`): Model<Api> {
	return {
		id,
		name: `${provider} Test Model`,
		api: "openai-completions",
		provider,
		baseUrl,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
	};
}

describe("mergeProviderAttributionHeaders", () => {
	const settingsManager = SettingsManager.inMemory();

	it("does not add remote attribution headers for OpenRouter, NVIDIA, or Cloudflare", () => {
		for (const model of [
			createModel("openrouter", "https://openrouter.ai/api/v1"),
			createModel("nvidia", "https://integrate.api.nvidia.com/v1"),
			createModel("cloudflare-workers-ai", "https://api.cloudflare.com/v1"),
		]) {
			const headers = mergeProviderAttributionHeaders(model, settingsManager, undefined);
			expect(headers?.["HTTP-Referer"]).toBeUndefined();
			expect(headers?.["X-OpenRouter-Title"]).toBeUndefined();
			expect(headers?.["X-BILLING-INVOKE-ORIGIN"]).toBeUndefined();
			expect(headers?.["User-Agent"]).toBeUndefined();
		}
	});

	it("preserves caller-provided headers", () => {
		const headers = mergeProviderAttributionHeaders(
			createModel("openrouter", "https://openrouter.ai/api/v1"),
			settingsManager,
			undefined,
			{ "HTTP-Referer": "https://provider.example" },
			{ "X-Custom": "request" },
		);

		expect(headers?.["HTTP-Referer"]).toBe("https://provider.example");
		expect(headers?.["X-Custom"]).toBe("request");
	});

	it("adds OpenCode session headers", () => {
		const headers = mergeProviderAttributionHeaders(
			createModel("opencode", "https://opencode.ai/zen/v1"),
			settingsManager,
			"opencode-session",
		);

		expect(headers?.["x-opencode-session"]).toBe("opencode-session");
		expect(headers?.["x-opencode-client"]).toBe("pi");
	});

	it("lets configured OpenCode headers override the defaults", () => {
		const headers = mergeProviderAttributionHeaders(
			createModel("opencode", "https://opencode.ai/zen/v1"),
			settingsManager,
			"opencode-session",
			{
				"x-opencode-session": "configured-session",
				"x-opencode-client": "configured-client",
			},
		);

		expect(headers?.["x-opencode-session"]).toBe("configured-session");
		expect(headers?.["x-opencode-client"]).toBe("configured-client");
	});
});
