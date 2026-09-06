#!/usr/bin/env node
/**
 * check-android-unavailable.ts — ANDROID_UNAVAILABLE 黑名单完整性检测（2026-09-04 新增）
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
 * 用法：
 *   node scripts/check-android-unavailable.ts         # 文本报告，退出码判定
 *   node scripts/check-android-unavailable.ts --json  # 子代理/CI 机器消费（_summary JSON）
 *
 * 依赖：零外部依赖（node:fs/promises + node:path + node:url）；bindings/app.ts 未生成时自动跳过
 *
 * 退出码：0 = 黑名单完整 / bindings 未生成跳过；1 = 存在未覆盖的 desktop-only binding
 *
 * 设计意图：Android 侧缺桌面专属绑定能力时降级隐藏对应 UI（platform-web.ts 黑名单），
 * 本脚本防止新增桌面 binding 时漏登黑名单导致 Android 崩溃或空 UI。
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
    const sig = m?.[1];
    if (sig) names.push(sig);
  }
  return names;
}

async function readCurrentBlacklist(): Promise<Set<string>> {
  const content = await readFile(PLATFORM_WEB_TS, "utf-8");
  const blacklist = new Set<string>();
  // 匹配 Set([...]) 内所有 "xxx" 或 'xxx' 字符串字面量（忽略注释行）
  const matches = content.matchAll(/["']([A-Z][a-zA-Z]+)["']/g);
  for (const m of matches) {
    const name = m[1];
    if (name) blacklist.add(name);
  }
  return blacklist;
}

async function main() {
  const wantJson = process.argv.includes("--json");
  try {
    const bindings = await extractBindings();
    const blacklist = await readCurrentBlacklist();

    // 检查 KNOWN_DESKTOP_ONLY 是否全部在黑名单里
    const uncoveredKnown = [...KNOWN_DESKTOP_ONLY].filter(name => !blacklist.has(name));
    const extraInBlacklist = [...blacklist].filter(name => !KNOWN_DESKTOP_ONLY.has(name) && !MAYBE_DESKTOP_ONLY.has(name));

    const ok = uncoveredKnown.length === 0;

    if (wantJson) {
      // 门禁/子代理机器消费：_summary.ok 判定（pre-push-gate 契约）
      console.log(JSON.stringify({
        _summary: { ok, scanned: bindings.length, desktopOnly: blacklist.size, uncovered: uncoveredKnown.length },
        uncovered: uncoveredKnown,
        extraInBlacklist,
      }));
      return ok ? 0 : 1;
    }

    if (uncoveredKnown.length > 0) {
      console.error("[android-guard] ⚠️ 以下明确 desktop-only binding 未在 ANDROID_UNAVAILABLE 中声明：");
      for (const name of uncoveredKnown) {
        console.error(`  - ${name}`);
      }
      console.error("");
      console.error("请在 frontend/src/backend/platform-web.ts 的 ANDROID_UNAVAILABLE 中添加。");
    }

    if (extraInBlacklist.length > 0) {
      console.warn("[android-guard] ℹ️ 黑名单中有以下非明确 desktop-only binding（请人工确认是否需要移除）：");
      for (const name of extraInBlacklist) {
        console.warn(`  - ${name}`);
      }
    }

    if (ok) {
      console.log(`[android-guard] ✅ ${bindings.length} 个 binding，${blacklist.size} 个 desktop-only 声明完整`);
    }
    return ok ? 0 : 1;
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
