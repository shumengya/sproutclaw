# sproutai-core

`sproutai-core` 是一个面向服务器运维与开发工作的 AI Agent 助手，基于 [pi-mono](https://github.com/badlogic/pi-mono) 改造而来，重点服务于日常服务器管理、Docker 部署、本地开发、故障排查与自动化工作流。提供终端 TUI 与 WebUI 双入口。

## 代码结构

本仓库是一个 Bun monorepo，核心逻辑按包拆分：

| 路径 | 说明 |
| --- | --- |
| `packages/coding-agent` | 交互式 Agent CLI 与 TUI 主入口。含对话循环、工具执行、交互界面；本仓库的定制补丁集中在这里 |
| `packages/agent` | Agent 运行时：会话管理、工具调用、状态持久化、harness 编排 |
| `packages/ai` | LLM 接入层：多 provider / 多模型抽象（Anthropic、OpenAI、Google、Bedrock 等） |
| `packages/tui` | 终端 UI 渲染库（组件、布局、渲染循环） |

其他关键目录：

- `scripts/` — 构建、发布、诊断等工具脚本（如 `build-release-binary.mjs`、`build-extensions.mjs`）
- `dist/` — 编译后的可执行二进制与旁路资源（构建产物，不进 Git）
- `agents/.sproutai/agent/` — 运行期配置与数据（`settings.json`、`models.json`、`auth.json`、`sessions/` 等，不进 Git）

CLI 入口：`packages/coding-agent/src/cli.ts`（bin 名 `pi`），打包为 `dist/sproutai`。

## 常用命令

需要 [Bun](https://bun.sh) 1.4.0+：

```bash
bun install --ignore-scripts
bun run build          # 构建全部 package 的 TS
bun run build:binary   # 编译为可执行二进制（输出到 dist/）
bun run check          # 类型检查 + lint + 依赖检查
```

运行：

```bash
./dist/sproutai           # 已编译二进制
# Windows: dist\sproutai.exe
# 或直接跑源码编译产物：
node packages/coding-agent/dist/cli.js
```
