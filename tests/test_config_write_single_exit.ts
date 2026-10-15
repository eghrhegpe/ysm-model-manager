#!/usr/bin/env node
/**
 * 契约测试：应用配置写「唯一实参点」守卫（ADR-313 → 锐评 2026-10-15 P1 ③ 改形）。
 *
 * 血统：`SaveAppConfig(filesRoot, rpRoot, mcRoot, linkMode, theme, themeAuto)` 是六个
 * **同型 string** 的位置实参，位置错了类型系统看不见。设置页第八轮把全页收敛到
 * path-cards.ts|saveCfg 单点后，views 层仍有三处实参点，且 app-sidebar 两处手抄配方
 * 硬编码 `"dark"`（不在 THEME_VALID 内 → 落盘后被 normalizeTheme 静默转成 system）
 * 与 `"copy"` 字面量。第九轮把这些实参点统一上移 `views/config-write.ts`。
 *
 * P1 ③ 后写入端改为 `SaveAppConfigPatch(patch)`（patch 形态、单次原子调用），本守卫
 * 随之改锁 **`SaveAppConfigPatch`**：生产代码里它的调用恰好一处，且必须落在唯一出口
 * 文件内。旧绑定 `SaveAppConfig` 保留给 Go 侧与 web 适配器，故对它**不再**要求
 * 「调用恰好一处」——改为「非出口文件不得 import 它」（前端业务代码没有正当理由再
 * 手抄那份位置实参配方）。
 *
 * 规则（生产代码不变量，测试文件豁免）：
 *   1. `frontend/src/**` 生产文件里 `SaveAppConfigPatch(` 调用**恰好出现一次**，
 *      且必须落在唯一出口文件 `views/config-write.ts` 内。
 *   2. 除出口文件外，任何文件不得 import 名为 `SaveAppConfigPatch` 的绑定
 *      （防「绕开出口再手抄一份配方」）。
 *   3. 除出口文件外，任何文件不得 import 名为 `SaveAppConfig` 的绑定
 *      （旧位置实参入口：前端业务代码再用即回退 ADR-313 已消灭的形态）。
 *   4. 出口文件不得出现裸 `"dark"` 主题字面量（THEME_VALID 无此值）。
 *
 * 边界：本测试只锁「实参点个数与位置」的结构不变量，不验各调用方语义（那由
 * src/views/config-write.test.ts、settings/init.test.ts 与 Go 侧
 * internal/app/app_config_patch_test.go 守护）。
 *
 * 依赖：node:fs / node:path（零第三方）。
 * 运行：node tests/test_config_write_single_exit.ts（或经 _lib/contract-tests.ts 统一入口）。
 * 退出码：0 全绿；非 0 断言失败。
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = path.join(ROOT, "frontend", "src");

/** 唯一实参点（相对 frontend/src，posix 分隔） */
const EXIT_FILE = "views/config-write.ts";

/** 生产源码文件（排除测试 / setup / 快照） */
function productionFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      out.push(...productionFiles(abs));
      continue;
    }
    if (!/\.(ts|tsx|js|mjs)$/.test(e.name)) continue;
    if (/\.(test|spec)\.(ts|tsx|js|mjs)$/.test(e.name)) continue;
    if (/\.setup\.(ts|js)$/.test(e.name)) continue;
    out.push(abs);
  }
  return out;
}

const rel = (abs) => path.relative(SRC_DIR, abs).split(path.sep).join("/");

/** 剥离注释（块注释 + 行注释），只留可执行代码——否则文档注释里提到的
 *  `SaveAppConfigPatch(…)` 叙述性文字会被误判成实参点。
 * 简化实现（不处理字符串里的 `//`）：误剥只可能漏检、不可能误报，
 * 而本测试的失败方向是「多报」——宁可保守。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, "");
}

// ─── 断言 1：SaveAppConfigPatch 调用恰好一次，且在唯一出口文件内 ───
// 正则只匹配 `SaveAppConfigPatch`（其后必须紧跟左括号），不会命中旧绑定
// `SaveAppConfig(`——`SaveAppConfigPatch` 与 `SaveAppConfig` 无前缀包含关系。
const callSites = [];
for (const abs of productionFiles(SRC_DIR)) {
  const text = stripComments(fs.readFileSync(abs, "utf8"));
  for (const m of text.matchAll(/\bSaveAppConfigPatch\s*\(/g)) {
    // import { SaveAppConfigPatch } from "…" 的名单里没有 `(`，故命中即调用；仍防一手
    const lastNl = text.lastIndexOf("\n", m.index) + 1;
    const prefix = text.slice(lastNl, m.index);
    if (/\bimport\b/.test(prefix) || /^\s*type\b/.test(prefix)) continue;
    callSites.push({ file: rel(abs), line: text.slice(0, m.index).split("\n").length });
  }
}

assert.deepStrictEqual(
  callSites.map((c) => c.file),
  [EXIT_FILE],
  `SaveAppConfigPatch 实参点必须恰好一处且位于 ${EXIT_FILE}——` +
    `其余位置请改调 writeAppConfig(patch)。\n` +
    `实际命中：${callSites.map((c) => `${c.file}:${c.line}`).join(", ") || "（无）"}`,
);

// ─── 断言 2 / 3：非出口文件不得 import 配置写绑定 ───
// 2: SaveAppConfigPatch —— 绕开唯一出口手抄 patch 配方
// 3: SaveAppConfig      —— 回退到 ADR-313 已消灭的位置实参形态
//    （web-store.ts 的 web 实现是**对象成员**不是 import，故不在此判据内；
//      它落在 backend 层、与 views 出口无竞争关系）
const offenders = [];
for (const abs of productionFiles(SRC_DIR)) {
  const r = rel(abs);
  if (r === EXIT_FILE) continue;
  const text = stripComments(fs.readFileSync(abs, "utf8"));
  for (const m of text.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from/g)) {
    const names = m[1]
      .split(",")
      .map((s) =>
        s
          .trim()
          .split(/\s+as\s+/)[0]
          .trim(),
      );
    const where = `${r}: ${m[0].replace(/\s+/g, " ").trim()}`;
    if (names.includes("SaveAppConfigPatch")) {
      offenders.push(`${where}（绕开唯一出口）`);
    }
    if (names.includes("SaveAppConfig")) {
      offenders.push(`${where}（旧位置实参入口，前端请改走 writeAppConfig）`);
    }
  }
}
assert.deepStrictEqual(
  offenders,
  [],
  `以下文件 import 了配置写绑定（绕开唯一出口）：\n  ${offenders.join("\n  ")}`,
);

// ─── 断言 4：出口文件不得裸写 "dark" 主题字面量 ───
// P1 ③ 后主题值域校验归 Go 侧，但 "dark" 这种非法字面量在前端任何位置都不得出现：
// THEME_VALID 无此值，落盘后 normalizeTheme 会静默归一成 system
// （用户没改主题却被改成跟随系统）。守卫保留以防手抄配方从别处回流。
const exitText = stripComments(fs.readFileSync(path.join(SRC_DIR, EXIT_FILE), "utf8"));
assert.ok(
  !/["'`]dark["'`]/.test(exitText),
  `${EXIT_FILE} 出现 "dark" 字面量：THEME_VALID = [cyber/warm/pro/sakura/ocean/mint/system] 无此值，` +
    `落盘后 normalizeTheme 会静默归一成 system（用户没改主题却被改成跟随系统）。`,
);

console.log(
  `[OK] test_config_write_single_exit.ts 全部断言通过（SaveAppConfigPatch 实参点 1 处 = ${EXIT_FILE}；` +
    `扫描生产文件 ${productionFiles(SRC_DIR).length} 个）`,
);
