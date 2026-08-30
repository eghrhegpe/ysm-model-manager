// ===== CLI Bridge 前端封装层（ADR-049 打通期）=====
// 封装 Wails ExecuteCLI 调用，处理 JSON 响应，提供类型安全的命令接口。
// 网页版（browserAdapter）走 web 降级实现，桌面/Android 走 Wails 原逻辑。

import { getApp } from "../backend/app.ts";
import { CLI_ALLOWLIST, type CLIAllowlistCommand } from "../backend/cli-allowlist.ts";
import { isWebPlatform } from "../backend/platform-web.ts";
import { WebUnsupportedError } from "../backend/web-common.ts";
import { safeErrorMessage } from "../utils/safe-error-msg.ts";

// 兼容旧导出名（tests 仍 import ALLOWED_CLI_COMMANDS）
export const ALLOWED_CLI_COMMANDS = CLI_ALLOWLIST;

// ===== 类型定义 =====

/** CLI 命令参数（统一格式：key-value map） */
export type CLIArgs = Record<string, string | number | boolean | undefined>;

/** CLI 响应状态 */
type CLIStatus = "success" | "error" | "not_supported";

/** CLI 错误详情 */
interface CLIError {
  code: string;
  message: string;
  details?: string;
}

/** CLI 响应数据 */
interface CLIData {
  output?: string;
  lines?: string[];
  platform?: string;
  filesRoot?: string;
  [key: string]: unknown;
}

/** CLI 统一响应 */
export interface CLIResponse {
  status: CLIStatus;
  command: string;
  data?: CLIData;
  error?: CLIError;
  timing?: { total_ms: number };
  meta?: { platform: string };
}

/** 动态白名单缓存（从后端 GetAllowedCLICommands 拉取，null=未拉取） */
let cachedDynamicCommands: Set<string> | null = null;
let dynamicFetchPromise: Promise<Set<string>> | null = null;

/** 重置动态白名单缓存（供测试使用） */
export function resetDynamicCommandsCache(): void {
  cachedDynamicCommands = null;
  dynamicFetchPromise = null;
}

/** 从后端拉取并缓存动态命令列表 */
async function fetchDynamicCommands(): Promise<Set<string>> {
  if (cachedDynamicCommands) return cachedDynamicCommands;
  if (dynamicFetchPromise) return dynamicFetchPromise;

  dynamicFetchPromise = (async () => {
    try {
      const app = await getApp();
      const raw = await app.GetAllowedCLICommands();
      const list: string[] = JSON.parse(raw);
      cachedDynamicCommands = new Set(list);
      return cachedDynamicCommands;
    } catch {
      // 拉取失败：本次调用用硬编码列表兜底，但不持久化缓存——
      // 下次调用会重新拉取后端，避免一次性故障导致整会话拒绝新命令
      dynamicFetchPromise = null;
      return new Set(ALLOWED_CLI_COMMANDS);
    }
  })();

  return dynamicFetchPromise;
}

/** 检查命令是否在白名单中（优先使用动态列表） */
async function isCommandAllowed(command: string): Promise<boolean> {
  if (isWebPlatform()) {
    return ALLOWED_CLI_COMMANDS.includes(command as CLIAllowlistCommand);
  }
  const allowed = await fetchDynamicCommands();
  return allowed.has(command);
}


// ===== 核心 API =====

/**
 * 执行 CLI 命令（核心入口）
 * @param command 命令名（必须在白名单中）
 * @param args 命令参数
 * @returns 统一 JSON 响应
 */
export async function executeCLI(command: string, args: CLIArgs = {}): Promise<CLIResponse> {
  // 动态白名单校验（优先后端拉取，降级硬编码列表）
  const allowed = await isCommandAllowed(command);
  if (!allowed) {
    return {
      status: "not_supported",
      command,
      error: {
        code: "command_not_allowed",
        message: `命令 [${command}] 不在白名单中`,
      },
      meta: { platform: isWebPlatform() ? "web" : "native" },
    };
  }

  try {
    const app = await getApp();
    const argsMap = buildArgsMap(args);

    // 调用 Wails 绑定（返回 JSON 字符串）
    const rawResp = await app.ExecuteCLI(command, argsMap);
    return parseCLIResponse(rawResp);
  } catch (err) {
    // 捕获 browserAdapter 抛出的 WebUnsupportedError
    if (err instanceof WebUnsupportedError) {
      return {
        status: "not_supported",
        command,
        error: {
          code: "web_not_supported",
          message: err.message,
        },
        meta: { platform: "web" },
      };
    }
    return {
      status: "error",
      command,
      error: {
        code: "call_failed",
        message: safeErrorMessage(err),
      },
      // 与 not_supported 分支形状一致，消费方可统一读 meta.platform
      meta: { platform: isWebPlatform() ? "web" : "native" },
    };
  }
}

/**
 * 获取允许的 CLI 命令列表（优先使用动态缓存）
 */
export async function getAllowedCLICommands(): Promise<string[]> {
  if (isWebPlatform()) {
    return [...ALLOWED_CLI_COMMANDS];
  }
  try {
    const allowed = await fetchDynamicCommands();
    return [...allowed];
  } catch {
    return [...ALLOWED_CLI_COMMANDS];
  }
}

// ===== 便捷方法 =====

/** 搜索模型 */
export function cliSearch(args: {
  keyword?: string;
  format?: string;
  type?: string;
} = {}): Promise<CLIResponse> {
  return executeCLI("search", args);
}

/** 列出所有模型 */
export function cliList(args: { format?: string } = {}): Promise<CLIResponse> {
  return executeCLI("list", args);
}

/** 分析模型 */
export function cliAnalyze(args: { model: string }): Promise<CLIResponse> {
  return executeCLI("analyze", args);
}

/** 缓存状态查询 */
export function cliCacheStatus(): Promise<CLIResponse> {
  return executeCLI("cache-status", {});
}

// ===== 内部工具（导出供测试使用） =====

/** 构建参数 map（过滤 undefined 和 null） */
export function buildArgsMap(args: CLIArgs): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined && value !== null) {
      result[key] = value;
    }
  }
  return result;
}

/** 解析 CLI JSON 响应 */
export function parseCLIResponse(raw: string): CLIResponse {
  try {
    return JSON.parse(raw) as CLIResponse;
  } catch {
    return {
      status: "error",
      command: "unknown",
      error: {
        code: "parse_error",
        message: `无法解析 CLI 响应: ${raw.slice(0, 200)}`,
      },
    };
  }
}
