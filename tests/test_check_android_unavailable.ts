#!/usr/bin/env node
/**
 * 契约测试：check-android-unavailable.ts（ANDROID_UNAVAILABLE 黑名单守卫）。
 *
 * 覆盖：
 *   1. parseNameSet —— 黑名单 / 测试副本两套锚点解析（旧版全文正则误报的回归）
 *   2. extractAppMethods / extractGuardedAppMethods —— Go 源码信号提取（T1/T2 内核）
 *   3. extractGuardedAppMethods 负向：注释行不误报、`!= "android"` 桌面正向分支不误报
 *   4. 端到端 --json：_summary 契约键齐全、当前仓库无硬失败（exit 0）
 *   5. 端到端：未知参数告警不崩溃
 *
 * 零依赖（node:assert / node:child_process / node:path / node:url）。
 * 运行：node tests/test_check_android_unavailable.ts
 */
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractAppMethods,
  extractGuardedAppMethods,
  parseNameSet,
} from "../scripts/check-android-unavailable.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails: string[] = [];
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log("✓", name);
  } catch (e) {
    fails.push(`${name}: ${(e as Error).message}`);
    console.error("✗", name, "-", (e as Error).message);
  }
}

/** 合并 stdout + stderr：守卫的提示/告警走 stderr，仅取 stdout 会漏判 */
function runGuard(args: string[]) {
  const res = spawnSync(
    process.execPath,
    [path.join(ROOT, "scripts", "check-android-unavailable.ts"), ...args],
    {
      cwd: ROOT,
      encoding: "utf8",
    },
  );
  return { rc: res.status ?? 1, out: String(res.stdout ?? "") + String(res.stderr ?? "") };
}

// ── 1. 名单解析（两套锚点）──
check("parseNameSet 解析黑名单声明块（new Set([...])）", () => {
  const src = `
export const ANDROID_UNAVAILABLE: ReadonlySet<string> = new Set([
  "RevealInExplorer",
  "OpenFolder",
  // 注释里的 "NotAName" 不应被吸入
]);
export function canBinding(binding: string): boolean { return !ANDROID_UNAVAILABLE.has(binding); }
`;
  const got = parseNameSet(src, /ANDROID_UNAVAILABLE[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/);
  assert.deepStrictEqual([...got].sort(), ["OpenFolder", "RevealInExplorer"]);
});

check("parseNameSet 解析测试副本块（toEqual([...])）", () => {
  const src = `
  it("黑名单", () => {
    expect([...ANDROID_UNAVAILABLE].sort()).toEqual([
      "SetApp",
      "SetMainWindow",
    ]);
  });
`;
  const got = parseNameSet(src, /ANDROID_UNAVAILABLE\][^[]*\[([\s\S]*?)\]\s*\)/);
  assert.deepStrictEqual([...got].sort(), ["SetApp", "SetMainWindow"]);
});

// ── 2. Go 源码信号 ──
check("extractAppMethods 提取 *App 导出方法", () => {
  const src =
    "func (a *App) Foo(x string) error {\n\treturn nil\n}\nfunc helper() {}\nfunc (a *App) Bar() {}\n";
  assert.deepStrictEqual(extractAppMethods(src), ["Foo", "Bar"]);
});

check('extractGuardedAppMethods 捕获 runtime.GOOS == "android" 守卫', () => {
  const src = [
    "func (a *App) OpenFolder(dir string) error {",
    "\t// ADR-047 平台守卫：Android 无 xdg-open",
    '\tif runtime.GOOS == "android" {',
    '\t\treturn fmt.Errorf("unsupported")',
    "\t}",
    "\treturn nil",
    "}",
  ].join("\n");
  assert.deepStrictEqual(extractGuardedAppMethods(src), ["OpenFolder"]);
});

check('extractGuardedAppMethods 捕获 case "android": 分支', () => {
  const src = [
    "func (a *App) RevealInExplorer(path string) error {",
    "\tswitch runtime.GOOS {",
    '\tcase "windows":',
    '\t\tcmd = exec.Command("explorer")',
    '\tcase "android":',
    '\t\treturn errors.New("unsupported")',
    "\t}",
    "\treturn nil",
    "}",
  ].join("\n");
  assert.deepStrictEqual(extractGuardedAppMethods(src), ["RevealInExplorer"]);
});

// ── 3. 负向：不误报 ──
check("extractGuardedAppMethods 跳过注释行（注释提及 android 不算守卫）", () => {
  const src = [
    "func (a *App) ScanDir(p string) []string {",
    '\t// Android 上也有标准目录，无需守卫 —— runtime.GOOS == "android" 仅作说明',
    "\treturn scan(p)",
    "}",
  ].join("\n");
  assert.deepStrictEqual(extractGuardedAppMethods(src), []);
});

check('extractGuardedAppMethods 不认 != "android" 的桌面正向分支', () => {
  const src = [
    "func (a *App) Startup(ctx context.Context) {",
    '\tif runtime.GOOS != "android" {',
    "\t\tsetupTray()",
    "\t}",
    "}",
  ].join("\n");
  assert.deepStrictEqual(extractGuardedAppMethods(src), []);
});

check("extractGuardedAppMethods 同方法只报一次，且守卫后不再延续到下一个方法", () => {
  const src = [
    "func (a *App) RestartApplication() error {",
    '\tif runtime.GOOS == "android" {',
    "\t\treturn err",
    "\t}",
    '\tif runtime.GOOS == "android" {',
    "\t\treturn err",
    "\t}",
    "}",
    "",
    "func (a *App) ListModels() []string {",
    '\tif runtime.GOOS == "android" {',
    "\t\treturn nil",
    "\t}",
    "}",
  ].join("\n");
  // 按出现顺序返回（未排序），RestartApplication 命中两次只算一条
  assert.deepStrictEqual(extractGuardedAppMethods(src), ["RestartApplication", "ListModels"]);
});

// ── 4. 端到端 --json 契约 ──
check("--json 输出合法 JSON 且 _summary 契约键齐全", () => {
  const { rc, out } = runGuard(["--json"]);
  const jsonLine = out
    .trim()
    .split("\n")
    .find((l) => l.startsWith("{"));
  assert.ok(jsonLine, "未找到 JSON 输出行");
  const parsed = JSON.parse(jsonLine);
  const s = parsed._summary;
  for (const key of [
    "ok",
    "degraded",
    "scanned",
    "blacklist",
    "uncovered",
    "suspects",
    "stale",
    "testDrift",
  ]) {
    assert.ok(key in s, `_summary 缺少键 ${key}`);
  }
  assert.ok(s.blacklist > 0, "黑名单不应为空");
  assert.ok(s.scanned > 0, "bindings 扫描数不应为 0");
  assert.strictEqual(rc, 0, `当前仓库应无硬失败，实际 exit ${rc}：${out}`);
});

check("文本模式退出码 0 且输出守卫标记", () => {
  const { rc, out } = runGuard([]);
  assert.strictEqual(rc, 0, `期望 exit 0，实际 ${rc}：${out}`);
  assert.ok(out.includes("[android-guard]"), "输出缺少 [android-guard] 标记");
});

// ── 5. 参数健壮性 ──
check("未知参数不崩溃（parseArgs 拦截并告警）", () => {
  const { rc, out } = runGuard(["--json", "--nope"]);
  assert.ok(out.includes("忽略未知参数"), "未输出未知参数告警");
  assert.strictEqual(rc, 0, `未知参数不应改变退出码，实际 ${rc}`);
});

if (fails.length) {
  console.error(`\n${fails.length} 项失败`);
  process.exit(1);
}
console.log("\n全部通过");
