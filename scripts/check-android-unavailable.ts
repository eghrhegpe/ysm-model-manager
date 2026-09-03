/**
 * 检测 ANDROID_UNAVAILABLE 黑名单的完整性。
 *
 * 逻辑：
 * 1. 从 frontend/src/backend/platform-web.ts 读取 ANDROID_UNAVAILABLE 黑名单
 * 2. 从 frontend/bindings/ysm-model-manager/internal/app/app.ts 提取全部 binding 名
 * 3. 识别 desktop-only binding（文件名/功能明显与桌面相关）
 * 4. 报告未覆盖的 desktop-only binding
 *
 * Desktop-only 识别规则：
 * - RevealInExplorer / OpenFolder / OpenInBrowser：桌面资源管理器操作
 * - RestartApplication：桌面重启
 * - ListVersionInstances：整合包扫描（Android 无 .minecraft 目录结构）
 * - GetMinecraftPaths：Minecraft 路径探测（Android 无标准路径）
 * - ValidateMinecraftDir：Minecraft 目录验证
 * - SetMainWindow / SetApp：Wails 窗口注入
 * - 广场相关（Navigate/Plaza*）：Android 暂不支持广场窗口
 *
 * 运行：node scripts/check-android-unavailable.ts
 */

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const BINDINGS_APP_TS = join(ROOT, "frontend", "bindings", "ysm-model-manager", "internal", "app", "app.ts");
const PLATFORM_WEB_TS = join(ROOT, "frontend", "src", "backend", "platform-web.ts");

/** 明确的 desktop-only binding 名（无需猜测） */
const KNOWN_DESKTOP_ONLY = new Set([
  // 文件管理
  "RevealInExplorer",
  "OpenFolder",
  "OpenInBrowser",
  // 系统操作
  "RestartApplication",
  "SetMainWindow",
  "SetApp",
  // Minecraft 专属
  "ListVersionInstances",
  "GetMinecraftPaths",
  "ValidateMinecraftDir",
  // 广场（Android 暂不支持多窗口）
  "NavigatePlazaWindow",
  "ClosePlazaWindow",
  "PlazaGoBack",
  "PlazaGoForward",
  "PlazaReload",
  "PlazaZoomIn",
  "PlazaZoomOut",
  "PlazaZoomReset",
  // 文件选择器（Android 有独立实现）
  "SelectDirectory",
  "SelectImportFile",
]);

/** 可能的 desktop-only binding（需人工确认） */
const MAYBE_DESKTOP_ONLY = new Set([
  "GetDefaultRepoRoot",  // Android 有固定路径，desktop 为空
  "GetWindowPosition",
  "SaveWindowPosition",
]);

async function extractBindings(): Promise<string[]> {
  const content = await readFile(BINDINGS_APP_TS, "utf-8");
  const names: string[] = [];
  for (const line of content.split("\n")) {
    const m = line.match(/^export function (\w+)\(/);
    if (m) names.push(m[1]);
  }
  return names;
}

async function readCurrentBlacklist(): Promise<Set<string>> {
  const content = await readFile(PLATFORM_WEB_TS, "utf-8");
  const blacklist = new Set<string>();
  // 匹配 Set([...]) 内所有 "xxx" 或 'xxx' 字符串字面量（忽略注释行）
  const matches = content.matchAll(/["']([A-Z][a-zA-Z]+)["']/g);
  for (const m of matches) {
    blacklist.add(m[1]);
  }
  return blacklist;
}

async function main() {
  try {
    const bindings = await extractBindings();
    const blacklist = await readCurrentBlacklist();

    // 检查 KNOWN_DESKTOP_ONLY 是否全部在黑名单里
    const uncoveredKnown = [...KNOWN_DESKTOP_ONLY].filter(name => !blacklist.has(name));
    const extraInBlacklist = [...blacklist].filter(name => !KNOWN_DESKTOP_ONLY.has(name) && !MAYBE_DESKTOP_ONLY.has(name));

    let exitCode = 0;

    if (uncoveredKnown.length > 0) {
      console.error("[android-guard] ⚠️ 以下明确 desktop-only binding 未在 ANDROID_UNAVAILABLE 中声明：");
      for (const name of uncoveredKnown) {
        console.error(`  - ${name}`);
      }
      console.error("");
      console.error("请在 frontend/src/backend/platform-web.ts 的 ANDROID_UNAVAILABLE 中添加。");
      exitCode = 1;
    }

    if (extraInBlacklist.length > 0) {
      console.warn("[android-guard] ℹ️ 黑名单中有以下非明确 desktop-only binding（请人工确认是否需要移除）：");
      for (const name of extraInBlacklist) {
        console.warn(`  - ${name}`);
      }
    }

    if (exitCode === 0) {
      console.log(`[android-guard] ✅ ${bindings.length} 个 binding，${blacklist.size} 个 desktop-only 声明完整`);
    }
    return exitCode;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.log("[android-guard] ⏭️ bindings/app.ts 未生成，跳过检测（build 后自动检测）");
      return 0;
    }
    console.error("[android-guard] 检测失败:", err);
    return 1;
  }
}

process.exit(await main());
