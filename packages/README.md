# sproutai 核心包（packages）模块说明

本目录是 sproutai（基于 pi 项目二次开发）的四个核心 npm 包。它们共同构成了一个完整的 AI 终端编码助手体系：**底层 LLM 调用 → 智能体编排 → 终端交互 → 编码代理 CLI**。

| 包名 | 模块目录 | 定位 |
|------|---------|------|
| `@earendil-works/pi-ai` | `ai` | 统一 LLM 接入层（provider / 认证 / 工具） |
| `@earendil-works/pi-agent-core` | `agent` | 有状态 Agent 引擎（工具执行、事件流） |
| `@earendil-works/pi-tui` | `tui` | 终端 UI 框架（差分渲染、组件化） |
| `@earendil-works/pi-coding-agent` | `coding-agent` | 编码代理 CLI（sproutai / pi，整合上面三者） |

> 依赖关系：`coding-agent` 同时依赖 `agent`、`ai`、`tui`；`agent` 依赖 `ai`；三者最终都由 `coding-agent` 组装为可执行 CLI。

---

## 一、`ai` — @earendil-works/pi-ai

**一句话定位**：统一 LLM API，聚合多家 provider，自动解析鉴权、统计 token 与成本、支持上下文持久化与模型间无缝交接。

### 核心能力
- **Provider 集合**：用 `Models` 集合持有多个 provider 并统一路由；每个 provider 持有自己的模型目录、鉴权（API key / OAuth）与流式行为。
- **Provider 工厂**：每个内置 provider 有独立子路径导入（如 `pi-ai/providers/anthropic`），按需打包；`builtinModels()` 一次性注册全部。
- **工具调用（Tool Calling）**：仅收录支持工具调用的模型（agentic 工作流必需）。用 TypeBox 定义工具 schema，自动校验参数。
- **图像输入 / 图像生成**：vision 模型处理图片；图像生成走独立的 `ImagesModels` 集合与 `generateImages()`。
- **推理/思考（Thinking）**：`thinking` 字段支持推理档位，`streamSimple()/completeSimple()` 提供统一接口，`stream()/complete()` 提供 provider 专属高级选项。
- **跨 provider 交接**：同一会话内切换 provider，自动把思考块转成 `<thinking>` 文本、保留工具调用与结果。
- **上下文序列化**：`Context` 对象可直接 JSON 序列化/反序列化，便于持久化对话与传递。

### 支持的 Provider（节选）
OpenAI、Anthropic、Google（Gemini）、Vertex AI、Azure OpenAI、OpenAI Codex、DeepSeek、Mistral、Groq、Cerebras、xAI、OpenRouter、NVIDIA NIM、Cloudflare AI Gateway / Workers AI、Vercel AI Gateway、Amazon Bedrock、MiniMax、Moonshot(Kimi)、ZAI、Hugging Face、GitHub Copilot、Fireworks、Together AI、Xiaomi MiMo，以及任意 OpenAI 兼容端点（Ollama、vLLM、LM Studio 等）。

### 鉴权 Auth
- 每个 provider 自管鉴权：存储凭据、环境变量、环境源（AWS profile / gcloud ADC）、OAuth 登录/刷新。
- `CredentialStore`：注入持久化存储；OAuth token 刷新在 `modify` 内加锁，避免并发重复刷新。
- 环境变量：每种 provider 有对应 env（如 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`GEMINI_API_KEY`、`XAI_API_KEY`、`AWS_*` 等）。
- OAuth 订阅：Anthropic（Claude Pro/Max）、OpenAI Codex（ChatGPT Plus/Pro）、GitHub Copilot、OpenRouter。

### 流式事件（Event Reference）
`start` / `text_start` / `text_delta` / `text_end`、`thinking_*`、`toolcall_start` / `toolcall_delta`（流式解析部分 JSON）/ `toolcall_end`、`done` / `error`、`stopReason`（`stop` / `length` / `toolUse` / `error` / `aborted`）。不同块事件可能交错，需用 `contentIndex` 关联。

### 其它要点
- **自定义 provider**：`createProvider()` + `createModels()`，支持动态模型列表（`fetchModels`）、混合 API（按 `model.api` 分派）、`compat` 兼容开关。
- **Faux Provider**：`fauxProvider()` 造内存假 provider，用于测试与 demo，可脚本化回复。
- **错误/中止**：请求错误不抛出而是发 `error` 事件；支持 `AbortController` 中断与中断后继续。
- **调试**：`onPayload` 查看发送给 provider 的原始 payload。
- **浏览器/打包**：核心入口无副作用可打树摇（tree-shaking），按 provider 分包；Bedrock 仅 Node。
- **旧 API 迁移**：旧的全局 API 挪到 `pi-ai/compat`（兼容入口，未来移除），推荐改 `createModels()` + provider 工厂。
- **开发扩展**：新增 provider 需改 `src/types.ts`、`src/api/<id>.ts`、模型生成脚本、provider 工厂、测试、coding-agent 集成与文档。

---

## 二、`agent` — @earendil-works/pi-agent-core

**一句话定位**：有状态 Agent 引擎，负责工具执行与事件流式处理，构建在 `pi-ai` 之上。

### 核心概念
- **AgentMessage vs LLM Message**：agent 使用灵活的 `AgentMessage` 类型（可含自定义消息类型，通过 declaration merging 扩展）；LLM 只认 `user` / `assistant` / `toolResult`，由 `convertToLlm` 转换。
- **消息流程**：`AgentMessage[] → transformContext() → AgentMessage[] → convertToLlm() → Message[] → LLM`（前者可选、后者必选，用于剪枝/压缩/外部上下文注入）。

### 事件流（Event Flow）
`prompt()` 触发：`agent_start → turn_start → message_start/end → message_update(流式分块) → message_end → turn_end → agent_end`。
有工具调用时会循环：`tool_execution_start → tool_execution_update → tool_execution_end → toolResult message → turn_end → 下一 turn`。

事件类型：`agent_start` / `agent_end` / `turn_start` / `turn_end` / `message_start` / `message_update` / `message_end` / `tool_execution_start` / `tool_execution_update` / `tool_execution_end`。

- `agent_end` 是最终事件；订阅者被 await，`waitForIdle()` / `prompt()` 在 `agent_end` 监听器完成后才结算。

### 关键配置与钩子
- `initialState`（systemPrompt、model、thinkingLevel、tools、messages）
- `convertToLlm`、`transformContext`（剪枝/压缩）
- `steeringMode` / `followUpMode`（`one-at-a-time` 或 `all`）
- `streamFn`（代理后端）、`sessionId`（provider 缓存）、`getApiKey`（动态 key，OAuth 刷新）
- `toolExecution`：`parallel`（默认，预检后并发执行）或 `sequential`（逐个执行）
- `beforeToolCall`（在参数校验后、工具执行前，可阻断）/ `afterToolCall`（工具执行结束后，可返回 `terminate: true`）
- `thinkingBudgets`、`shouldStopAfterTurn`（低层循环优雅停止）

### 工具（Tools）
用 `AgentTool` 定义，含 TypeBox `parameters`，可选 `executionMode`（覆盖全局模式）、`label`（UI 展示）。
- 工具失败应 **抛错**，不要返回错误内容；抛错会被捕获并以 `isError: true` 报告给 LLM。
- 支持流式进度 `onUpdate`、`terminate: true`（提示跳过自动后续 LLM 调用，仅当整批结果都 terminate 才生效）。

### 方法
- **Prompting**：`prompt(text/img/AgentMessage)`、`continue()`
- **状态管理**：直接读写 `agent.state`（顶层数组赋值会被复制）
- **控制**：`abort()`、`waitForIdle()`
- **事件**：`subscribe(callback)`
- **Steering / Follow-up**：`steer()`、`followUp()`、`clearSteeringQueue()`、`clearFollowUpQueue()`、`clearAllQueues()`——steering 在工具运行中中断，follow-up 在 agent 停止后排队。

### 入口与低层 API
- 默认入口 `pi-agent-core` 全量注册；`pi-agent-core/base` + `pi-ai/base` 用于按需打包仅含选定 provider 的应用。
- **低层 API**：`agentLoop()` / `agentLoopContinue()`，观察式流（不等待异步处理结算）；若需消息处理作为工具预检前的屏障，应使用 `Agent` 类。

---

## 三、`tui` — @earendil-works/pi-tui

**一句话定位**：极简终端 UI 框架，采用差分渲染与同步输出，实现无闪烁、高效的交互式 CLI 应用。

### 核心特性
- **差分渲染（Differential Rendering）**：三/四种策略只更新变化部分（首次渲染、宽高变化全屏重绘、视口上方变化定点重绘、常规增量更新）。
- **同步输出**：用 CSI 2026（`\x1b[?2026h`/`\x1b[?2026l`）原子化刷新屏幕，避免闪烁。
- **Bracketed paste mode**：正确处理大段粘贴（>10 行显示 `[paste #1 +50 lines]` 标记）。
- **组件化**：简单 `Component` 接口（`render()` / `handleInput?()` / `invalidate?()`）。
- **主题支持**：组件接收主题接口定制样式。
- **内联图像**：支持 Kitty / iTerm2 图形协议，不支持时回退为文本占位。
- **自动补全**：文件路径与斜杠命令。

### 内置组件
`Text`、`TruncatedText`、`Input`（单行+水平滚动）、`Editor`（多行+自动补全+粘贴处理）、`Markdown`（语法高亮+主题）、`Loader` / `CancellableLoader`（加载动画+Escape/AbortSignal）、`SelectList`、`SettingsList`、`Spacer`、`Image`、`Box`、`Container`。

### 核心 API
- **TUI**：主容器，`addChild` / `removeChild` / `start` / `stop` / `requestRender`。
- **Overlays（浮层）**：`showOverlay()` 在现有内容之上渲染，不做替换；支持宽高、锚点/百分比/绝对定位、边距、可见性回调、焦点控制（`hide`/`setHidden`/`focus`/`unfocus`）。
- **Component 接口**：`render(width)` 返回逐行字符串，每行**不得超过 width**（否则报错）；`handleInput(data)` 处理原始终端输入；`invalidate()` 清缓存。
- **Focusable（IME 支持）**：显示光标、需要输入法（中文/日文/韩文等）的组件实现该接口；容器内含 `Input`/`Editor` 时必须传递焦点状态给子组件，否则 IME 候选窗位置错乱。
- **Terminal 接口**：`start/stop/write/get columns/rows/moveBy/hideCursor/...`；内置 `ProcessTerminal`（真实终端）与 `VirtualTerminal`（测试）。
- **按键检测**：`matchesKey()` + `Key.*` 帮助器（支持 Kitty 键盘协议）。

### 常用工具函数
`visibleWidth()`（去 ANSI 算宽）、`truncateToWidth()`（保留 ANSI 截断加省略号）、`wrapTextWithAnsi()`（保留 ANSI 换行）。

### 自定义组件注意事项
- 每行返回不得超过 `width`，用 `truncateToWidth()` / 手动换行保证。
- `visibleWidth` / `truncateToWidth` 正确处理 ANSI 转义序列。
- 为性能缓存渲染结果，仅在必要时重渲染。

---

## 四、`coding-agent` — @earendil-works/pi-coding-agent

**一句话定位**：极简终端编码代理 CLI（即本产品 `sproutai` / `pi`），默认给模型 `read`/`write`/`edit`/`bash` 四个工具，可通过 扩展/技能/提示词模板/主题/包 高度定制，无需 fork 修改内部。

### 快速开始
```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
export ANTHROPIC_API_KEY=sk-ant-...   # 或用 /login 选订阅
pi
```
`piConfig.name = "sproutai"`，config dir 为 `.sproutai`；CLI bin 名 `pi`。

### 运行模式
| 模式 | 说明 |
|------|------|
| `(默认)` | 交互式 |
| `-p / --print` | 打印结果并退出 |
| `--mode json` | 输出所有事件为 JSONL |
| `--mode rpc` | RPC 模式（进程集成，LF 分隔 JSONL） |
| `--export` | 导出会话为 HTML |

### 交互式界面
- **编辑器**：文件引用 `@`、Tab 补全路径、多行 (Shift+Enter)、图片粘贴 (Ctrl+V)、`!command`（发给 LLM）/ `!!command`（仅执行不发）。
- **命令（/）**：`/login`、`/logout`、`/model`、`/settings`、`/resume`、`/new`、`/tree`、`/fork`、`/clone`、`/compact`、`/copy`、`/export`、`/share`、`/hotkeys`、`/quit` 等。
- **快捷键**：Ctrl+C 清空/两次退出、Escape 取消/两次开 `/tree`、Ctrl+L 选模型、Shift+Tab 切换思考档位、Ctrl+O 折叠工具输出、Ctrl+T 折叠思考块。
- **消息队列**：Enter 排队 *steering*（当前轮工具执行完送达）、Alt+Enter 排队 *follow-up*（全部工作完送达）。

### 会话（Sessions）
- JSONL 文件 + 树形结构（`id` / `parentId`），可原地分支不产生新文件；自动存到 `~/.pi/agent/sessions/`。
- **分支**：`/tree`、`/fork`、`/clone`、`--fork <path|id>`。
- **压缩（Compaction）**：手动 `/compact`，自动（上下文溢出时触发并重试，或接近上限时主动）；压缩有损，完整历史仍在 JSONL 中。

### 设置 / 信任
- 设置文件：`~/.pi/agent/settings.json`（全局）、`.pi/settings.json`（项目）。
- **项目信任**：启动时询问是否信任含项目本地设置/资源的文件夹；`--approve` / `--no-approve` 覆盖，`/trust` 保存决定，`defaultProjectTrust`（`ask`/`always`/`never`）控制回退。非交互模式不弹信任提示。
- **遥测/更新检查**：默认不联网检查，`PI_CHECK_VERSION=1` 开启，`PI_OFFLINE=1` 关闭所有启动网络操作。

### 上下文文件
- 启动时读取 `AGENTS.md` / `CLAUDE.md`（全局 `~/.pi/agent/`、父目录、当前目录，全部拼接）；`--no-context-files` 关闭。
- 系统提示：`.pi/SYSTEM.md`（项目）或 `~/.pi/agent/SYSTEM.md`（全局）替换默认提示；`APPEND_SYSTEM.md` 追加。

### 自定义（强扩展点）
- **Prompt Templates**：Markdown 复用提示，`/name` 展开，`{{var}}` 变量。
- **Skills**：按需加载的能力包（遵循 Agent Skills 标准），`/skill:name` 或用模型自动加载，目录如 `~/.pi/agent/skills/`、`.agents/skills/`。
- **Extensions**：TS 模块，扩展自定义工具/命令/快捷键/事件处理器/UI 组件；可做子代理、计划模式、自定义压缩、权限门、沙箱、SSH、MCP 等。
- **Themes**：内置 `dark`/`light`，热重载。
- **Pi Packages**：把扩展/技能/提示/主题打包经 npm 或 git 分享；`pi install/remove/update/list/config`。（注：包有完全系统权限，安装第三方需审源码）

### 哲学（Philosophy）
默认**不含** MCP、子代理、权限弹窗、计划模式、内置 to-do、后台 bash；倡导用扩展/技能/包按需构建，或用 tmux 保持可观测。

### CLI / 环境变量要点
- 工具集：内置 `read`、`bash`、`edit`、`write`、`grep`、`find`、`ls`；`--tools <list>`、`--exclude-tools`、`--no-tools`、`--no-builtin-tools`。
- 模型选项：`--provider`、`--model <provider/id:thinking>`、`--thinking`、`--models`、`--list-models`。
- 会话选项：`-c/-r/--session/--fork/--session-dir/--no-session/--name`。
- 资源：`-e/--extension`、`--skill`、`--prompt-template`、`--theme`、`--no-*`。
- 环境变量：`PI_CODING_AGENT_DIR`、`PI_PACKAGE_DIR`、`PI_OFFLINE`、`PI_CHECK_VERSION`、`PI_CACHE_RETENTION`、`VISUAL/EDITOR` 等。

### 编程用法（SDK / RPC）
```typescript
import { AuthStorage, createAgentSession, ModelRegistry, SessionManager } from "@earendil-works/pi-coding-agent";
const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage);
const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(), authStorage, modelRegistry,
});
await session.prompt("What files are in the current directory?");
```
- 高级多会话运行时替换用 `createAgentSessionRuntime()` / `AgentSessionRuntime`。
- 非 Node 集成用 `pi --mode rpc`（严格 LF 分隔 JSONL，勿用 `readline`）。

---

## 五、模块间协作关系

```
┌────────────────────────────────────────────────────────────┐
│  coding-agent (sproutai / pi CLI)                          │
│  · 交互界面 · 会话 · 工具 · 扩展/技能/主题/包 · SDK/RPC     │
└──────────────┬──────────────────────────┬──────────────────┘
               │ 依赖                         │ 依赖
        ┌──────▼──────┐              ┌──────▼──────┐
        │ agent       │              │ tui         │
        │ Agent引擎    │              │ 终端UI框架   │
        └──────┬──────┘              └─────────────┘
               │ 依赖
        ┌──────▼──────┐
        │ ai          │
        │ LLM统一接入层 │
        └─────────────┘
```

- `ai` 提供底层模型/鉴权/工具调用；`agent` 在其上做有状态编排与事件流；`tui` 提供终端渲染；`coding-agent` 把三者组装成完整的编码代理 CLI，并开放大量扩展点。

---

## 六、快速开发指引

| 操作 | 位置 |
|------|------|
| 构建单包 | 进入对应模块 `bun run build`（ai 走 `build:offline` 前需生成模型目录） |
| 运行测试 | `npm test` / `vitest --run` |
| 打包产物 | 各包 `dist/`；coding-agent 可 `build:binary` 编出单二进制 `dist/sproutai` |
| 新增 provider | 按 `ai` README「Development」清单逐项处理 |
| 编码代理文档 | `coding-agent/docs/`（providers、sdk、rpc、extensions、skills、themes、packages 等） |

> 所有包采用 TypeScript / ESM，Node >= 22.19.0，MIT 协议。
