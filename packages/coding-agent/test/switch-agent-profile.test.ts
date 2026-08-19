import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	type CreateAgentSessionRuntimeFactory,
	AgentSessionRuntime,
} from "../src/core/agent-session-runtime.ts";
import type { AgentSessionServices } from "../src/core/agent-session-services.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { resolvePath } from "../src/utils/paths.ts";

type StubSession = {
	sessionFile: string | undefined;
	sessionManager: SessionManager;
	extensionRunner: {
		hasHandlers: (event: string) => boolean;
		emit: (event: unknown) => Promise<undefined>;
	};
	dispose: () => void;
	createReplacedSessionContext: () => { sessionFile: string | undefined };
};

function createStubSession(sessionManager: SessionManager): StubSession {
	return {
		sessionFile: sessionManager.getSessionFile(),
		sessionManager,
		extensionRunner: {
			hasHandlers: () => false,
			emit: async () => undefined,
		},
		dispose: () => {},
		createReplacedSessionContext: () => ({ sessionFile: sessionManager.getSessionFile() }),
	};
}

function createStubServices(cwd: string, agentDir: string): AgentSessionServices {
	return {
		cwd,
		agentDir: resolvePath(agentDir),
		modelRuntime: {} as AgentSessionServices["modelRuntime"],
		settingsManager: {} as AgentSessionServices["settingsManager"],
		resourceLoader: {} as AgentSessionServices["resourceLoader"],
		diagnostics: [],
	};
}

describe("AgentSessionRuntime.switchAgentProfile", () => {
	const cleanups: Array<() => void> = [];

	afterEach(() => {
		while (cleanups.length > 0) {
			cleanups.pop()?.();
		}
	});

	function makeTempDir(prefix: string): string {
		const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(dir, { recursive: true });
		cleanups.push(() => {
			if (existsSync(dir)) {
				rmSync(dir, { recursive: true, force: true });
			}
		});
		return dir;
	}

	it("recreates services under a new agentDir and starts a blank session", async () => {
		const cwd = makeTempDir("pi-switch-profile-cwd");
		const agentDirA = makeTempDir("pi-switch-profile-a");
		const agentDirB = makeTempDir("pi-switch-profile-b");

		const sessionManagerA = SessionManager.create(cwd, join(agentDirA, "sessions", "cwd-a"));
		sessionManagerA.appendMessage({
			role: "user",
			content: [{ type: "text", text: "hello" }],
			timestamp: Date.now(),
		});
		const previousSessionFile = sessionManagerA.getSessionFile();

		const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd: nextCwd, agentDir, sessionManager }) => {
			const services = createStubServices(nextCwd, agentDir);
			const session = createStubSession(sessionManager);
			return {
				session: session as never,
				modelFallbackMessage: undefined,
				services,
				diagnostics: [],
			};
		};

		const runtime = new AgentSessionRuntime(
			createStubSession(sessionManagerA) as never,
			createStubServices(cwd, agentDirA),
			createRuntime,
		);

		let rebound = false;
		runtime.setRebindSession(async () => {
			rebound = true;
		});

		const result = await runtime.switchAgentProfile({ agentDir: agentDirB });
		expect(result.cancelled).toBe(false);
		expect(rebound).toBe(true);
		expect(runtime.services.agentDir).toBe(resolvePath(agentDirB));
		expect(runtime.session.sessionFile).not.toBe(previousSessionFile);
		expect(runtime.session.sessionManager.getEntries()).toEqual([]);
	});

	it("honors session_before_switch cancellation", async () => {
		const cwd = makeTempDir("pi-switch-profile-cancel-cwd");
		const agentDirA = makeTempDir("pi-switch-profile-cancel-a");
		const agentDirB = makeTempDir("pi-switch-profile-cancel-b");
		const sessionManager = SessionManager.create(cwd, join(agentDirA, "sessions", "cwd-a"));
		const session = createStubSession(sessionManager);
		session.extensionRunner = {
			hasHandlers: (event) => event === "session_before_switch",
			emit: async () => ({ cancel: true }) as never,
		};

		const createRuntime: CreateAgentSessionRuntimeFactory = async () => {
			throw new Error("should not create runtime when cancelled");
		};

		const runtime = new AgentSessionRuntime(
			session as never,
			createStubServices(cwd, agentDirA),
			createRuntime,
		);

		const result = await runtime.switchAgentProfile({ agentDir: agentDirB });
		expect(result.cancelled).toBe(true);
		expect(runtime.services.agentDir).toBe(resolvePath(agentDirA));
	});
});
