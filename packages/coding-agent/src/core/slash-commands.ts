import { APP_NAME } from "../config.ts";
import type { SourceInfo } from "./source-info.ts";

export type SlashCommandSource = "extension" | "prompt" | "skill";

export interface SlashCommandInfo {
	name: string;
	description?: string;
	source: SlashCommandSource;
	sourceInfo: SourceInfo;
}

export interface BuiltinSlashCommand {
	name: string;
	description: string;
}

export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<BuiltinSlashCommand> = [
	{ name: "settings", description: "打开设置菜单" },
	{ name: "model", description: "选择模型（打开选择器界面）" },
	{ name: "scoped-models", description: "启用/禁用 Ctrl+P 循环切换的模型" },
	{ name: "export", description: "导出会话（默认 HTML，或指定路径：.html/.jsonl）" },
	{ name: "import", description: "从 JSONL 文件导入并恢复会话" },
	{ name: "share", description: "将会话分享为私密 GitHub gist" },
	{ name: "copy", description: "将最后一条助手消息复制到剪贴板" },
	{ name: "name", description: "设置会话显示名称" },
	{ name: "session", description: "显示会话信息与统计" },
	{ name: "changelog", description: "显示更新日志" },
	{ name: "hotkeys", description: "显示所有快捷键" },
	{ name: "fork", description: "从先前的用户消息创建新分支" },
	{ name: "clone", description: "在当前位置复制当前会话" },
	{ name: "tree", description: "浏览会话树（切换分支）" },
	{ name: "trust", description: "保存项目信任决定以供后续会话使用" },
	{ name: "login", description: "配置供应商身份验证" },
	{ name: "logout", description: "移除供应商身份验证" },
	{ name: "new", description: "开始新会话" },
	{ name: "compact", description: "手动压缩会话上下文" },
	{ name: "resume", description: "恢复其他会话" },
	{ name: "reload", description: "重新加载快捷键、扩展、技能、提示词和主题" },
	{ name: "config", description: "切换 Agent 配置（热切换并开始新会话）" },
	{ name: "config-add", description: "添加 Agent 配置：/config-add <名字> <配置目录>" },
	{ name: "sproutai-install", description: "注册全局 sproutai 命令（指向编译后的二进制，可覆盖）" },
	{ name: "sproutai-uninstall", description: "卸载全局 sproutai 命令" },
	{ name: "simplify", description: "开关简约输出（思考内容 + 工具调用）" },
	{ name: "simplify-collapse", description: "收缩思考内容与工具调用输出" },
	{ name: "simplify-expand", description: "展开思考内容与工具调用输出" },
	{ name: "quit", description: `退出 ${APP_NAME}` },
	{ name: "exit", description: `退出 ${APP_NAME}` },
];
