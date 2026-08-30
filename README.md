# Sprout

>注意,Sprout项目仍处于早期实验性开发中,许多特性仍然不稳定,请依据最新版本为准

`Sprout` (又称 SproutAI , SproutClaw)是一个面向服务器运维与日常开发,办公协作的通用 AI Agent 助手，基于 [pi-agent](https://github.com/earendil-works/pi) 改造而来，重点开发插件扩展系统,定时任务系统,WebUI界面,以及各种深度定制魔改,致力于打造一款个人专属Agent

## 代码结构

本仓库核心是一个 Bun monorepo，核心逻辑按包拆分：

| 路径 | 说明 |
| --- | --- |
| `packages/coding-agent` | 交互式 Agent CLI 与 TUI 主入口。含对话循环、工具执行、交互界面；本仓库的定制补丁集中在这里 |
| `packages/agent` | Agent 运行时：会话管理、工具调用、状态持久化、harness 编排 |
| `packages/ai` | LLM 接入层：多 provider / 多模型抽象（Anthropic、OpenAI、Google、Bedrock 等） |
| `packages/tui` | 终端 UI 渲染库（组件、布局、渲染循环） |


CLI 入口：`packages/coding-agent/src/cli.ts`（bin 名 `pi`），打包为 `dist/sproutai`。

## 附属仓库

本仓库为核心运行时，配套以下附属仓库协作完成完整闭环：

| 仓库 | 说明 |
| --- | --- |
| [sproutai-web](https://github.com/shumengya/sproutai-web) | WebUI 前端，与终端 TUI 双入口配合 |
| [sproutai-cron](https://github.com/shumengya/sproutai-cron) | 定时任务调度（cronctl），负责 cron 任务的注册、调度、日志与通知 |
| [sproutai-extension](https://github.com/shumengya/sproutai-extension) | 扩展库，承载技能 / 扩展与相关能力 |

## 常用命令

需要 [Bun](https://bun.sh) 1.4.0+：

```bash
bun install --ignore-scripts
bun run build          # 构建全部 package 的 TS
bun run build:binary   # 编译为本机可执行二进制（→ dist/）
# 或在 monorepo 根目录：bun build.ts core
bun run check          # 类型检查 + lint + 依赖检查
```

运行：

```bash
./dist/sproutai           # 已编译二进制
# Windows: dist\sproutai.exe
# 或直接跑源码编译产物：
node packages/coding-agent/dist/cli.js
```

## 与Pi-Agent的核心区别
- Sprout Agent所有核心和系列扩展强制使用bun打包构建,release发布会不定期上传二进制构建产物,方便用户直接下载直接使用,您也可以自己下载仓库源码,自行构建
- 提供简洁美观的WebUI界面,方便不习惯TUI控制台界面的用户使用,专业编码需求请仍然选择TUI界面
- 提供各种内置插件扩展,SKills和MCP合集,可直接将各个插件包,Skills,MCP放到Agent的配置随开随用,不需要强制npm安装
- Agent会不断更新融入和同步各大Agent,如Claudecode,Codex,OpenCode,Pi的新特性和新玩法,也是作为我学习Agent开发的心路历程

## 友情链接

Sprout 的很多设计灵感与特性都源自以下各大主流 Agent 开源项目,向它们致敬并保持同步学习:

| Agent | GitHub 仓库 | 说明 |
| --- | --- | --- |
| Codex CLI | [openai/codex](https://github.com/openai/codex) | OpenAI 出品的轻量级终端编码 Agent |
| OpenCode | [anomalyco/opencode](https://github.com/anomalyco/opencode) | 开源编码 Agent(原 sst/opencode),支持 75+ 模型 Provider |
| pi | [earendil-works/pi](https://github.com/earendil-works/pi) | AI Agent 工具包,本仓库的前身与持续同步来源 |
| grok build | [xai-org/grok-build](https://github.com/xai-org/grok-build) | xAI 出品的终端编码 Agent,全屏 TUI |
| Hermes Agent | [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) | Nous Research 出品,主打自我进化的 Agent |
| Claude Code | [anthropics/claude-code](https://github.com/anthropics/claude-code) | Anthropic 出品的终端编码 Agent(CLI) |
| Gemini CLI | [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) | Google 出品的开源终端 Agent |
