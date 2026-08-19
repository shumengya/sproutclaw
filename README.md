# sproutai-core

`sproutai-core` 是一个面向服务器运维与开发工作的 Agent 助手，基于 [pi-mono](https://github.com/badlogic/pi-mono) 改造，重点服务于日常服务器管理、Docker 部署、项目开发、故障排查和自动化工作流。

## 定位

- 服务器运维助手：协助 SSH 登录、服务状态检查、日志分析、配置调整和部署排障。
- 开发协作助手：理解本地项目结构，执行代码修改、测试验证和 Git 工作流。
- Docker 部署助手：按项目目录组织 `docker compose` 服务，关注数据持久化、端口规划和资源限制。
- 内网服务助手：适配自建内网服务器的使用习惯。
- WebUI/TUI 双入口：保留控制台 TUI，同时提供独立的网页前端（`sproutai-web`）。

## 项目结构

| 路径 | 说明 |
| --- | --- |
| `packages/coding-agent` | 交互式 Agent CLI 与 TUI 主体（含 sproutai-core 定制补丁） |
| `packages/agent` | Agent 运行时、工具调用和状态管理 |
| `packages/ai` | 多模型、多 provider 的 LLM 接入层 |
| `packages/tui` | 终端 UI 渲染库 |
| `sproutai` / `sproutai.cmd` | 启动已构建版（`dist/` 或便携二进制） |
| `scripts/sync-upstream.sh` | 合并上游 pi-mono 更新 |
| `scripts/push-sproutai.sh` | 推送到 GitHub / Gitea |

> 持久化配置一律在安装目录下的 `agents/.sproutai/agent/`（便携二进制与 `sproutai.exe` 同级；源码运行则在包目录下）。**不会写入用户 home**（无 `~/.sproutai`）。已加入 `.gitignore`。

## 常用命令

安装依赖并构建（需要 [Bun](https://bun.sh) 1.3.14+）：

```bash
bun install --ignore-scripts
bun run build
```

构建可执行二进制（扁平布局，默认输出到本仓库 `dist/`）：

```bash
bun run build:binary
```

产物目录：

```text
dist/
  sproutai.exe | sproutai
  package.json, photon_rs_bg.wasm
  theme/, assets/, docs/, examples/, export-html/, native/, node_modules/
  agents/                   # 便携配置根目录（.sproutai、.codedevagent 等）
    .sproutai/agent/        # 当前默认 agent 配置
```

常用选项：

```bash
# 已编过 TS，只重打二进制 + 资源
bun run build:binary:skip-build

# 自定义输出目录
node scripts/build-release-binary.mjs --out D:/path/to/out
```

> 需要本机已安装 [Bun](https://bun.sh)。该命令会先 `bun run build`（可用 `--skip-build` 跳过），再 Bun compile，并调用 `assemble-binary-runtime` 组装旁路资源。

运行（需先 `bun run build` 或 `bun run build:binary`）：

```bash
./sproutai
# Windows:
# sproutai.cmd
```

或直接使用构建产物：

```bash
node packages/coding-agent/dist/cli.js
```

检查代码：

```bash
bun run check
```

## WebUI（sproutai-web）

WebUI 是独立项目，位于 `../sproutai-web/`。生产环境由仓库根目录的 launcher 拉起（`sproutai start` / `sproutai.exe`），内部 spawn core `--mode rpc`。

整包构建（推荐）：

```bash
cd ..   # sproutai monorepo 根目录
node build.mjs
```

本地只跑 Web 后端（需先 `bun run build` core）：

```bash
cd ../sproutai-web/backend
go run ./cmd/server --port 19133 \
  --agent-dir ../../sproutai-core/agents/.sproutai/agent \
  --repo-root ../../sproutai-core \
  --pi-cmd "node ../../sproutai-core/packages/coding-agent/dist/cli.js"
```

前端开发：

```bash
cd ../sproutai-web/frontend
npm ci && npm run dev
```

不要再使用 `build.sh` / systemd `sproutai-web` 服务脚本。

## Git 分支策略

本仓库是 pi-mono 的 fork，同时维护**上游同步**和 **sproutai-core 定制**。

| 分支 | 用途 |
| --- | --- |
| `main` | 稳定可跑版本：已合并的上游 + sproutai-core 定制，推送到 GitHub / Gitea |
| `feature/*` | 日常开发：WebUI、扩展、补丁等，完成后 merge 进 `main` |

### Remote 配置

```text
origin    → https://github.com/shumengya/sproutai.git
upstream  → https://github.com/badlogic/pi-mono.git
gitlab     → （可选）自建 Gitea，按需配置
```

首次配置 upstream：

```bash
git remote add upstream https://github.com/badlogic/pi-mono.git
```

### 日常开发

```bash
git checkout -b feature/my-fix
# ... 开发、测试 ...
git add <改动的具体文件>
git commit -m "fix: ..."
git checkout main
git merge feature/my-fix
./scripts/push-sproutai.sh
git branch -d feature/my-fix
```

### 推送到 GitHub / Gitea

```bash
./scripts/push-sproutai.sh
# 或手动
git push origin main && git push gitea main
```

### 合并上游 pi-mono 更新

主仓依赖用 `bun.lock` 管理，不再合并上游 `package-lock.json`。`extensions/` 仍各自保留 npm lockfile，互不影响。

```bash
git fetch upstream
git merge upstream/main --no-commit --no-ff
# 解决冲突（见下方惯例），然后：
git add <resolved-files>
git commit
./scripts/push-sproutai.sh
```

**合并冲突处理惯例：**

| 文件类型 | 处理方式 |
| --- | --- |
| `README.md`、sproutai-core 定制代码 | 保留本仓库版本 |
| `*.generated.ts` | 采用 upstream |
| `bun.lock` / 根 `package.json` | 保留本仓库，再 `bun install --ignore-scripts` |
| 测试/文档/新增上游功能 | 采用 upstream |

合并后必做：

```bash
bun install --ignore-scripts
bun run build
./sproutai
```

### sproutai-core 相对 upstream 的定制改动

合并上游时，以下内容**不要误删**：

- `packages/coding-agent/package.json` 中 `piConfig.name = sproutai`、`configDir = .sproutai`（命名空间隔离）
- `showChangelogOnStartup` 设置项（关闭启动 What's New）
- RPC 扩展：`reload` 命令、bash 流式输出（`bash_update`）、`get_extensions` 接口
- `sproutai` / `sproutai.cmd` 等启动脚本
- `scripts/sync-upstream.sh`、`scripts/push-sproutai.sh` 等工具脚本
- 本 README 及中文版 CONTRIBUTING.md / SECURITY.md

## 本地配置

`agents/.sproutai/agent/` 中以下内容不进 Git：

- `settings.json` → 参考 `settings.example.json` 本地复制
- `models.json`、`auth.json`、`mcp.json`
- `sessions/`、`skills/`、`extensions/`、`prompts/`

环境变量（可选）：

- `SPROUTAI_CODING_AGENT_DIR` — 覆盖 agent 配置目录；默认 `<installRoot>/agents/.sproutai/agent`

首次部署：

```bash
cp agents/.sproutai/agent/settings.example.json agents/.sproutai/agent/settings.json
# 编辑 settings.json 填入 provider / model / auth 信息
```

### 与原版 pi 并存

| | 原版 pi | SproutAI |
|---|---|---|
| 命令 | `pi` | `sproutai` |
| 全局配置 | `~/.pi/agent/` | `<installRoot>/agents/.sproutai/agent/`（不写 home） |
| 项目配置 | `.pi/` | `.sproutai/` |
| 环境变量 | `PI_CODING_AGENT_DIR` | `SPROUTAI_CODING_AGENT_DIR` |

## 说明

这个仓库是自用 fork，默认围绕个人服务器的部署规范和日常开发习惯调整。上游能力来自 pi-mono，通过 `git fetch upstream && git merge upstream/main` 定期同步，sproutai-core 定制在 `feature/*` 开发后合入 `main`。
