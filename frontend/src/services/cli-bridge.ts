// ===== CLI Bridge 前端封装层（ADR-049 打通期）=====
// 封装 Wails ExecuteCLI 调用，处理 JSON 响应，提供类型安全的命令接口。
// 网页版（browserAdapter）走 web 降级实现，桌面/Android 走 Wails 原逻辑。
//
// 三层兜链（命令白名单判定）：
//   ① 动态拉取：getApp().GetAllowedCLICommands()（桌面端 Go 注册表 40 命令）
//   ② 硬编码兜底：CLI_ALLOWLIST（web 模式 + 桌面端拉取失败时的 curated 子集 21 项）
//   ③ web-only 短路：isWebPlatform() 直接走硬编码列表
//
// CLI_ALLOWLIST 是 curated 子集（有意排除需 Go 进程/落盘依赖的命令），数量差异是设计意图。
// 详情见 frontend/src/backend/cli-allowlist.ts 文件头注释。

import { getApp } from "@/backend/app.ts";
import { CLI_ALLOWLIST, type CLIAllowlistCommand } from "@/backend/cli-allowlist.ts";
import { isWebPlatform } from "@/backend/platform-web.ts";
import { WebUnsupportedError } from "@/backend/web-common.ts";
import { safeErrorMessage } from "@/utils/base/pure/safe-error-msg.ts";

// ===== 类型定义 =====

/** CLI 命令参数（统一格式：key-value map） */
export type CLIArgs = Record<string, string | number | boolean | undefined>;

/** CLI 响应状态的已知取值。**非穷尽**：`parseCLIResponse` 刻意放行未知状态字符串
 *  （防 Go 侧新增状态值被前端误判为 parse_error），故消费方按 status 分派时必须带
 *  default 分支兜底。`(string & {})` 保留字面量补全提示而不锁死取值，避免类型与
 *  「任意字符串放行」的运行时契约自相矛盾。 */
type CLIStatus = "success" | "error" | "not_supported" | (string & {});

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
  /** @non-ui 命令名回显。界面不渲染：调用方本就知道自己调了什么（`executeCLI(command)`）；
   * 保留在契约里是为了让**失败响应**能自证是哪条命令失败（排错/断言用），删掉会让
   * `parseErrorResponse` 的未知命令回退 "unknown" 失去对账面。 */
  command: string;
  data?: CLIData;
  error?: CLIError;
  /** 命令本身的墙钟耗时（Go `TimingInfo`，纳秒精度）。**已消费**：经区段头耗时徽标展示
   * （`perf-common.ts|sectionHeader` 第四参）——回答「这一节等了 4 秒，是命令慢还是渲染慢」。 */
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
      if (!list.length) {
        // 后端返回空列表 = 注册表异常（正常 40 命令，空集只可能来自故障/版本漂移）：
        // 不缓存空集——否则 isCommandAllowed 对所有命令恒 false，整会话 CLI 锁死
        //（not_supported）。与 catch 分支同语义：回退硬编码列表，下次调用重新拉取。
        dynamicFetchPromise = null;
        return new Set(CLI_ALLOWLIST);
      }
      cachedDynamicCommands = new Set(list);
      return cachedDynamicCommands;
    } catch {
      // 拉取失败：本次调用用硬编码列表兜底，但不持久化缓存——
      // 下次调用会重新拉取后端，避免一次性故障导致整会话拒绝新命令
      dynamicFetchPromise = null;
      return new Set(CLI_ALLOWLIST);
    }
  })();

  return dynamicFetchPromise;
}

/** 检查命令是否在白名单中（优先使用动态列表） */
async function isCommandAllowed(command: string): Promise<boolean> {
  if (isWebPlatform()) {
    return CLI_ALLOWLIST.includes(command as CLIAllowlistCommand);
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
 *
 * 参数链路：本层 buildArgsMap（仅滤 undefined/null）→ Wails map[string]interface{} →
 * Go ExecuteCLI 转 os.Args → CLI flag.Parse。参数序列化规则（声明序/显式空值/未知键）
 * 的单一事实源 = go/cli 注册表 ParamSpec（ADR-173），见 go/cli/registry.go 与
 * internal/app/cli_bridge.go buildCLIArgs——本层不承载损耗语义，空串/0/false 一律
 * 原样过桥，是否产出由 Go 侧按规格决定（AllowEmpty=false 时丢弃=与 flag 默认一致）。
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
    return parseCLIResponse(rawResp, command);
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
    return [...CLI_ALLOWLIST];
  }
  try {
    const allowed = await fetchDynamicCommands();
    return [...allowed];
  } catch {
    return [...CLI_ALLOWLIST];
  }
}

// ===== 便捷方法 =====

/** 搜索模型 */
export function cliSearch(
  args: { keyword?: string; format?: string; type?: string } = {},
): Promise<CLIResponse> {
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

/** 构造 parse_error 响应（语法错与形状错共用；message 区分细节便于定位）
 *  - `command` 由调用方透传，省略时回退 `"unknown"`（兼容直接调用的既有测试形态）
 *  - `meta` 与 `call_failed` / `not_supported` 分支同形，消费方可统一读 `meta.platform`
 *    （判定谓词为同步 Tier 派生，不引入异步依赖） */
function parseErrorResponse(message: string, command = "unknown"): CLIResponse {
  return {
    status: "error",
    command,
    error: { code: "parse_error", message },
    meta: { platform: isWebPlatform() ? "web" : "native" },
  };
}

/**
 * 解析 CLI JSON 响应（形状守卫：非响应对象一律报错，禁止 `as` 断言穿透）
 *
 * `JSON.parse` 成功 ≠ 拿到响应对象：`"null"` / `"[]"` / `"123"` / `"true"` 都是**合法 JSON**
 * 却非响应对象，旧实现 `return JSON.parse(raw) as CLIResponse` 是纯编译期断言，会把它们原样
 * 交给消费方（`result.status` 为 undefined）。本守卫属**协议边界防御**——Wails 桥另一侧返回
 * 的是不可信字符串，前端不该假设其形状。
 *
 * 现 Go 链路（`ExecuteCLI` → `go/cli` 的 `JsonResponse.ToJson`）恒产出「顶层对象 + 字符串
 * status」，无可达的畸形生产者；守卫防的是桥层异常输出与未来回归。该层历史上确曾出现
 * `json.Marshal` 吞错致前端收到 `"null"`（cli_quality_audit 规律六，2026-08 已全仓修复），
 * 那是本次补守卫的动机，但**非当前可达路径**。
 *
 * 两道守卫：
 *   ①必须是普通对象（排除 null / 数组 / 字符串 / 数字 / 布尔）
 *   ②`status` 必须是字符串——它是所有消费方的分派依据；只查类型不枚举取值，
 *     故 Go 侧新增状态值不会被误判为 parse_error
 *
 * `command` 参数仅供**失败响应**回填（成功时以 Go 响应体内的 command 为准），省略回退
 * `"unknown"` 兼容既有调用形态；`executeCLI` 传真实命令名，解析失败时能直接看出是哪个命令。
 */
export function parseCLIResponse(raw: string, command = "unknown"): CLIResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return parseErrorResponse(`无法解析 CLI 响应: ${raw.slice(0, 200)}`, command);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return parseErrorResponse(`CLI 响应不是对象: ${raw.slice(0, 200)}`, command);
  }
  if (typeof (parsed as { status?: unknown }).status !== "string") {
    return parseErrorResponse(`CLI 响应 status 非字符串: ${raw.slice(0, 200)}`, command);
  }
  return parsed as CLIResponse;
}
