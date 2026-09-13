#!/usr/bin/env node
/**
 * check-android-unavailable.ts — ANDROID_UNAVAILABLE 黑名单完整性守卫（多事实源，2026-09-08 重写）
 *
 * 背景：初版（2026-09-04）只比对硬编码 KNOWN_DESKTOP_ONLY 常量集合，与真实 binding 全集
 * 零交集校验 → 「新增未登记桌面 binding」这一最危险场景恒不可达；且 bindings 缺失时
 * ENOENT → exit 0 静默放行。本版换轨为从 Go 源码派生的四级事实源，见下方口径表。
 *
 * 检测口径（T0 硬 → T4 软）：
 *   T0 契约层  bindings/app.ts 为 git 入库文件，缺失 = 异常（不再静默跳过；--allow-missing 逃生阀）
 *   T1 编译期  `GOOS=android go list -f '{{.GoFiles}}' ./internal/app/` 与默认 GOOS 的文件差集
 *              → 差集文件内的 `*App` 导出方法 = Android 二进制中不存在（硬失败）
 *   T2 运行期  desktop 构建 GoFiles 内 `*App` 方法体出现 ADR-047 平台守卫
 *              （`runtime.GOOS == "android"` / `case "android":`）→ Android 上明确不可用（硬失败）
 *   T3 命名式  真实 binding 全集 × 桌面语义正则（Plaza、Select*、Minecraft、Explorer…）→ 候选（提示）
 *   T4 反向    Stale（黑名单项已从 bindings 消失）+ 测试名单漂移（platform-web.test.ts 硬编码副本）
 *              + 基线回退（旧 KNOWN 名单项被移出黑名单）→ 三类提示
 *
 * 降级：go 工具链缺失 / go list 失败 → 仅跑 T3/T4，`_summary.degraded = true` 显式标记，
 *       绝不静默 exit 0（旧版 ENOENT 分支的教训）。
 *
 * 依赖：node:fs/promises + node:child_process；共享层 scripts/_lib/{scan-files,parse-args}.ts
 *
 * 用法：
 *   node scripts/check-android-unavailable.ts         # 全量（T0–T4），文本报告，退出码判定
 *   node scripts/check-android-unavailable.ts --json  # 子代理/CI 机器消费（_summary JSON）
 *   node scripts/check-android-unavailable.ts --lite  # 秒级档（缺陷#3）：跳过 T1/T2 的 go list，
 *                                                  仅跑 T3/T4 纯文本扫描；pre-commit 专用，
 *                                                  T1/T2 由 pre-push 全量兜底
 *   node scripts/check-android-unavailable.ts --allow-missing  # bindings 缺失时不判失败（CI 冷启动）
 *
 * 退出码：0 = 无硬失败（可能含提示）；1 = T0/T1/T2 存在未登记项或脚本异常。
 *         --lite 档 T1/T2 留空，退出码仅反映 T0（bindings 缺失）；T3/T4 为提示不阻断。
 *
 * 设计意图：Android 侧缺桌面专属能力时降级隐藏对应 UI（platform-web.ts 黑名单）。本守卫把
 * 「黑名单是否完整」的判定从事后人工名单搬移到 Go 源码的编译期/运行期信号，使新增桌面
 * binding 能被自动发现，而非依赖有人记得同步三处硬编码副本。
 */

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./_lib/parse-args.ts";
import { ROOT } from "./_lib/scan-files.ts";

/** 直接执行判定：被 import（单测）时不跑 main，避免顶层 process.exit 提前终止测试进程 */
export const invokedDirectly = (): boolean =>
  Boolean(process.argv[1]) &&
  resolve(process.argv[1] as string) === resolve(fileURLToPath(import.meta.url));

const BINDINGS_APP_TS = join(
  ROOT,
  "frontend",
  "bindings",
  "ysm-model-manager",
  "internal",
  "app",
  "app.ts",
);
const PLATFORM_WEB_TS = join(ROOT, "frontend", "src", "backend", "platform-web.ts");
const PLATFORM_WEB_TEST_TS = join(ROOT, "frontend", "src", "backend", "platform-web.test.ts");
const GO_APP_PKG = "./internal/app/";

/**
 * 基线快照：初版硬编码名单（2026-09-04）。降级为回归用途——仅用于 T4「基线回退」提示，
 * 不再参与主判定（主判定已换轨到 T1/T2 的 Go 源码信号）。
 */
const BASELINE_DESKTOP_ONLY = new Set([
  "RevealInExplorer",
  "OpenFolder",
  "OpenInBrowser",
  "RestartApplication",
  "SetMainWindow",
  "SetApp",
  "ListVersionInstances",
  "GetMinecraftPaths",
  "ValidateMinecraftDir",
  "NavigatePlazaWindow",
  "ClosePlazaWindow",
  "PlazaGoBack",
  "PlazaGoForward",
  "PlazaReload",
  "PlazaZoomIn",
  "PlazaZoomOut",
  "PlazaZoomReset",
  "SelectDirectory",
  "SelectImportFile",
]);

/**
 * T3 桌面语义命名模式（对新增命名生效，硬编码名单做不到）。
 * 收窄原则：宁可漏报也不刷屏——`Instance`/`Screen`/`Notify` 等宽泛词已移除
 * （整合包实例管理在 Android 上合法可用，曾一次刷出 18 条噪声）。
 */
const DESKTOP_HINT_PATTERNS: RegExp[] = [
  /Plaza/, // 广场多窗口（Android 单窗口）
  /^Select(Directory|File|ImportFile|ExportFile)$/,
  /Minecraft/, // .minecraft 目录结构专属
  /Explorer|OpenFolder|OpenInBrowser/,
  /^Restart/, // 进程重启（Android Activity 模型不适用）
  /MainWindow|SetApp$|SetWindow|WindowPosition/,
  /Tray|Clipboard|SaveScreenshot/,
];

/** T2：ADR-047 平台守卫标记（只认「等于 android」分支，避免把 `!= "android"` 的桌面正向分支算进来） */
const ANDROID_GUARD_RE = /runtime\.GOOS\s*==\s*"android"|case\s+"android":/;

interface Report {
  scanned: number;
  blacklistSize: number;
  /** T1 编译期缺失且未登记 */
  missingAtCompile: string[];
  /** T2 运行期守卫且未登记 */
  guardedAtRuntime: string[];
  /** T3 命名可疑且未登记（提示） */
  suspects: string[];
  /** T4-a 黑名单项已从 bindings 消失 */
  stale: string[];
  /** T4-b 测试硬编码名单与黑名单不一致 */
  testDrift: string[];
  /** T4-c 基线项被移出黑名单 */
  baselineRemoved: string[];
  degraded: boolean;
  /** --lite 档标记（pre-commit 秒级档主动跳过 T1/T2，区别于「go 工具链缺失」的真降级） */
  lite: boolean;
  degradeReason?: string;
}

function dedupeSorted(xs: Iterable<string>): string[] {
  return [...new Set(xs)].sort();
}

/** 从 bindings/app.ts 提取全部 binding 名（`export function X(`） */
async function extractBindings(): Promise<string[]> {
  const content = await readFile(BINDINGS_APP_TS, "utf-8");
  const names: string[] = [];
  for (const line of content.split("\n")) {
    const m = line.match(/^export function (\w+)\(/);
    if (m?.[1]) names.push(m[1]);
  }
  return names;
}

/** 黑名单声明锚点：`ANDROID_UNAVAILABLE ... = new Set([ ... ])` */
const BLACKLIST_RE = /ANDROID_UNAVAILABLE[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/;
/** 测试副本锚点：`[...ANDROID_UNAVAILABLE].sort()).toEqual([ ... ])` */
const TEST_LIST_RE = /ANDROID_UNAVAILABLE\][^[]*\[([\s\S]*?)\]\s*\)/;

/**
 * 按锚点正则提取字符串字面量集合。
 * 旧版用全文 `["']([A-Z][a-zA-Z]+)["']` 扫，会吸入同文件其它标识符/注释造成大量误报
 * （实测把 platform-web.ts 全文标识符都当黑名单，误报 15 条测试漂移）。
 */
export function parseNameSet(content: string, re: RegExp): Set<string> {
  const body = re.exec(content)?.[1];
  if (!body) return new Set();
  const out = new Set<string>();
  // 逐行剔除 `//` 注释后再取字面量：块内注释常举反例名（如 "NotAName"），混入即误报
  for (const line of body.split("\n")) {
    const code = line.slice(0, line.indexOf("//") === -1 ? undefined : line.indexOf("//"));
    for (const m of code.matchAll(/["']([A-Za-z]+)["']/g)) {
      if (m[1]) out.add(m[1]);
    }
  }
  return out;
}

/** 从 platform-web.ts 读取 ANDROID_UNAVAILABLE 黑名单 */
async function readBlacklist(): Promise<Set<string>> {
  return parseNameSet(await readFile(PLATFORM_WEB_TS, "utf-8"), BLACKLIST_RE);
}

/** 从 platform-web.test.ts 提取 toEqual([...]) 中的硬编码名单副本 */
function readTestBlacklist(content: string): Set<string> {
  return parseNameSet(content, TEST_LIST_RE);
}

/** `go list -f '{{.GoFiles}}'`，GOOS 可覆盖。失败返回 error（→ 降级） */
function listGoFiles(goos?: string): { files: string[] } | { error: string } {
  const res = spawnSync("go", ["list", "-f", "{{.GoFiles}}", GO_APP_PKG], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120_000,
    env: goos ? { ...process.env, GOOS: goos } : process.env,
  });
  if (res.error) return { error: `go list 执行失败: ${res.error.message}` };
  if (res.status !== 0)
    return { error: `go list 退出码 ${res.status}: ${(res.stderr ?? "").trim().slice(0, 200)}` };
  // 输出形如 `[a.go b.go]`
  const files = (res.stdout ?? "")
    .trim()
    .replace(/^\[|\]$/g, "")
    .split(/\s+/)
    .filter(Boolean);
  if (files.length === 0) return { error: "go list 返回空文件集" };
  return { files };
}

/** 提取 Go 源文件中的 `*App` 导出方法名（T1 用） */
export function extractAppMethods(content: string): string[] {
  const out: string[] = [];
  for (const line of content.split("\n")) {
    const m = line.match(/^func \(\w+ \*App\) (\w+)\(/);
    if (m?.[1]) out.push(m[1]);
  }
  return out;
}

/** 提取带 ADR-047 平台守卫的 `*App` 方法名（T2 用）；跳过注释行降低误报 */
export function extractGuardedAppMethods(content: string): string[] {
  const out: string[] = [];
  let current: string | null = null;
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trimStart();
    const method = line.match(/^func \(\w+ \*App\) (\w+)\(/);
    if (method?.[1]) {
      current = method[1];
      continue;
    }
    if (/^func\b/.test(line)) {
      current = null; // 进入非 *App 函数 → 结束当前方法体
      continue;
    }
    if (!current || line.startsWith("//")) continue;
    if (ANDROID_GUARD_RE.test(line)) {
      out.push(current);
      current = null; // 同一方法只报一次
    }
  }
  return out;
}

async function collect(report: Report, lite = false): Promise<void> {
  const bindings = await extractBindings();
  const blacklist = await readBlacklist();
  const bindingSet = new Set(bindings);
  report.scanned = bindings.length;
  report.blacklistSize = blacklist.size;

  if (lite) {
    // ── --lite（pre-commit 秒级档，2026-09-13 缺陷#3）──
    // 跳过 T1/T2 的 `go list`（GOOS=android go list 冷缓存可达数秒，违背 pre-commit 秒级承诺）。
    // missingAtCompile / guardedAtRuntime 留空（无 go 信号可派生）；T1/T2 由 pre-push 全量兜底。
    // degraded=true 标记本档为「无 go 信号」，pre-push 的 --json 消费方可据 lite 区分
    // 「真降级（go 工具链缺失）」与「lite 主动跳过」——两者都只跑 T3/T4 但成因不同。
    report.lite = true;
    report.degraded = true;
    report.degradeReason = "--lite：跳过 T1/T2 go list（pre-commit 秒级档），由 pre-push 全量兜底";
  } else {
    // ── T1/T2：Go 源码信号（失败则降级到 T3/T4）──
    const desktop = listGoFiles();
    if ("error" in desktop) {
      report.degraded = true;
      report.degradeReason = desktop.error;
    } else {
      // T1：编译期差集文件的导出方法 ∩ 真实 bindings − 已登记
      const android = listGoFiles("android");
      if ("error" in android) {
        report.degraded = true;
        report.degradeReason = android.error;
      } else {
        const androidSet = new Set(android.files);
        const missing = new Set<string>();
        for (const file of desktop.files.filter((f) => !androidSet.has(f))) {
          const content = await readFile(join(ROOT, "internal", "app", file), "utf-8").catch(
            () => "",
          );
          for (const name of extractAppMethods(content)) {
            if (bindingSet.has(name) && !blacklist.has(name)) missing.add(name);
          }
        }
        report.missingAtCompile = dedupeSorted(missing);

        // T2：desktop 构建集内的 ADR-047 运行期守卫 − 已登记
        const guarded = new Set<string>();
        for (const file of desktop.files) {
          const c = await readFile(join(ROOT, "internal", "app", file), "utf-8").catch(() => "");
          for (const name of extractGuardedAppMethods(c)) {
            if (bindingSet.has(name) && !blacklist.has(name)) guarded.add(name);
          }
        }
        report.guardedAtRuntime = dedupeSorted(guarded);
      }
    }
  }

  // ── T3：命名语义可疑（对新增命名生效）──
  report.suspects = dedupeSorted(
    bindings.filter(
      (name) => !blacklist.has(name) && DESKTOP_HINT_PATTERNS.some((re) => re.test(name)),
    ),
  );

  // ── T4：反向漏检 ──
  report.stale = dedupeSorted([...blacklist].filter((name) => !bindingSet.has(name)));
  report.baselineRemoved = dedupeSorted(
    [...BASELINE_DESKTOP_ONLY].filter((name) => !blacklist.has(name)),
  );

  const testList = readTestBlacklist(await readFile(PLATFORM_WEB_TEST_TS, "utf-8").catch(() => ""));
  if (testList.size > 0) {
    const drift = new Set<string>();
    for (const name of testList) if (!blacklist.has(name)) drift.add(`测试多出: ${name}`);
    for (const name of blacklist) if (!testList.has(name)) drift.add(`测试缺失: ${name}`);
    report.testDrift = dedupeSorted(drift);
  }
}

function printText(r: Report): void {
  if (r.degraded && !r.lite) {
    console.warn(`[android-guard] ⚠️ 降级模式（Go 工具链不可用）：${r.degradeReason ?? ""}`);
    console.warn("  仅执行 T3 命名扫描 + T4 反向校验，T1/T2 未覆盖。");
  }
  if (r.missingAtCompile.length > 0 || r.guardedAtRuntime.length > 0) {
    console.error("[android-guard] ❌ 以下 binding 在 Android 上不可用但未登记黑名单：");
    for (const name of r.missingAtCompile) console.error(`  - ${name}  [T1 编译期缺失]`);
    for (const name of r.guardedAtRuntime) console.error(`  - ${name}  [T2 运行期守卫]`);
    console.error("");
    console.error("请在 frontend/src/backend/platform-web.ts 的 ANDROID_UNAVAILABLE 中添加。");
  }
  if (r.suspects.length > 0) {
    console.warn(
      `[android-guard] ℹ️ 命名疑似桌面专属但未登记（${r.suspects.length}）：${r.suspects.join(", ")}`,
    );
  }
  if (r.stale.length > 0) {
    console.warn(
      `[android-guard] ℹ️ 黑名单项已从 bindings 消失（Go 侧可能已删）：${r.stale.join(", ")}`,
    );
  }
  if (r.baselineRemoved.length > 0) {
    console.warn(
      `[android-guard] ℹ️ 基线项被移出黑名单（确认是否有意）：${r.baselineRemoved.join(", ")}`,
    );
  }
  if (r.testDrift.length > 0) {
    console.warn(
      `[android-guard] ℹ️ platform-web.test.ts 硬编码名单漂移：${r.testDrift.join(", ")}`,
    );
  }
  if (r.missingAtCompile.length === 0 && r.guardedAtRuntime.length === 0) {
    const modeNote = r.lite
      ? "（lite 档：T1/T2 由 pre-push 兜底）"
      : r.degraded
        ? "（降级模式）"
        : "";
    console.log(
      `[android-guard] ✅ ${r.scanned} bindings / ${r.blacklistSize} 黑名单，无硬失败${modeNote}`,
    );
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2), { bools: ["json", "allow-missing", "lite"] });
  if (args.unknown.length) console.warn(`[android-guard] 忽略未知参数: ${args.unknown.join(", ")}`);
  const wantJson = Boolean(args.json);
  const allowMissing = Boolean(args["allow-missing"] ?? args.allowMissing);
  // --lite（缺陷#3，2026-09-13）：pre-commit 秒级档——跳过 T1/T2 的 go list，仅跑 T3/T4 纯文本扫描。
  // T1/T2 的编译/运行期判定改由 pre-push 全量兜底（--strict 时 go build 先行）。
  const lite = Boolean(args.lite);

  const report: Report = {
    scanned: 0,
    blacklistSize: 0,
    missingAtCompile: [],
    guardedAtRuntime: [],
    suspects: [],
    stale: [],
    testDrift: [],
    baselineRemoved: [],
    degraded: false,
    lite: false,
  };

  try {
    await collect(report, lite);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // T0：bindings 是 git 入库文件，缺失属异常——除非显式 --allow-missing
      const msg =
        "[android-guard] ❌ bindings/app.ts 或 platform-web.ts 缺失（二者均入库，属异常）";
      if (allowMissing) {
        console.log(`${msg}——--allow-missing 已放行`);
        return 0;
      }
      console.error(msg);
      console.error(
        "  先跑 `cd frontend && npm run generate:bindings`；CI 冷启动可用 --allow-missing 逃生。",
      );
      return 1;
    }
    console.error("[android-guard] 检测异常:", err);
    return 1;
  }

  const hardMissing = dedupeSorted([...report.missingAtCompile, ...report.guardedAtRuntime]);
  const ok = hardMissing.length === 0;

  if (wantJson) {
    console.log(
      JSON.stringify({
        _summary: {
          ok,
          degraded: report.degraded,
          lite: report.lite,
          scanned: report.scanned,
          blacklist: report.blacklistSize,
          uncovered: hardMissing.length,
          suspects: report.suspects.length,
          stale: report.stale.length,
          testDrift: report.testDrift.length,
        },
        uncovered: hardMissing,
        missingAtCompile: report.missingAtCompile,
        guardedAtRuntime: report.guardedAtRuntime,
        suspects: report.suspects,
        stale: report.stale,
        baselineRemoved: report.baselineRemoved,
        testDrift: report.testDrift,
        degradeReason: report.degradeReason,
      }),
    );
    return ok ? 0 : 1;
  }

  printText(report);
  return ok ? 0 : 1;
}

if (invokedDirectly()) process.exit(await main());
