#!/usr/bin/env node
/**
 * 契约测试：应用配置写「唯一实参点」守卫（ADR-313）。
 *
 * 背景：`SaveAppConfig(filesRoot, rpRoot, mcRoot, linkMode, theme, themeAuto)` 是六个
 * **同型 string** 的位置实参，位置错了类型系统看不见。设置页第八轮把全页收敛到
 * path-cards.ts|saveCfg 单点后，views 层仍有三处实参点，且 app-sidebar 两处手抄配方
 * 硬编码 `"dark"`（不在 THEME_VALID 内 → 落盘后被 normalizeTheme 静默转成 system）
 * 与 `"copy"` 字面量。第九轮把这些实参点统一上移 `views/config-write.ts`。
 *
 * 规则（生产代码不变量，测试文件豁免）：
 *   1. `frontend/src/**` 生产文件里 `SaveAppConfig(` 调用**恰好出现一次**，
 *      且必须落在唯一出口文件 `views/config-write.ts` 内。
 *   2. 除出口文件外，任何文件不得 import 名为 `SaveAppConfig` 的绑定
 *      （防「绕开出口再手抄一份配方」）。
 *   3. 出口文件不得出现裸 `"dark"` 主题字面量（THEME_VALID 无此值）；缺省须引
 *      theme-core 的 THEME_DARK。
 *
 * 边界：本测试只锁「实参点个数与位置」的结构不变量，不验各调用方语义
 * （那由 src/views/config-write.test.ts 与各消费方单测守护）。
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

/** 剥离注释（块注释 + 行注释），只留可执行代码——否则文档注释里提到
 *  `SaveAppConfig(六位置实参)` 的叙述性文字会被误判成实参点。
 *  简化实现（不处理字符串里的 `//`）：本仓生产代码无 URL 字面量含 `SaveAppConfig`，
 *  误剥只可能漏检、不可能误报，而本测试的失败方向是「多报」——宁可保守。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, "");
}

// ─── 断言 1：SaveAppConfig 调用恰好一次，且在唯一出口文件内 ───
const callSites = [];
for (const abs of productionFiles(SRC_DIR)) {
  const text = stripComments(fs.readFileSync(abs, "utf8"));
  for (const m of text.matchAll(/\bSaveAppConfig\s*\(/g)) {
    // import { SaveAppConfig } from "…" 的名单里没有 `(`，故命中即调用；仍防一手
    const lastNl = text.lastIndexOf("\n", m.index) + 1;
    const prefix = text.slice(lastNl, m.index);
    if (/\bimport\b/.test(prefix) || /^\s*type\b/.test(prefix)) continue;
    callSites.push({ file: rel(abs), line: text.slice(0, m.index).split("\n").length });
  }
}

assert.deepStrictEqual(
  callSites.map((c) => c.file),
  [EXIT_FILE],
  `SaveAppConfig 实参点必须恰好一处且位于 ${EXIT_FILE}——` +
    `其余位置请改调 writeAppConfig(patch)（位置实参同型 string，手抄一份就多一份漂移源）。` +
    `\n实际命中：${callSites.map((c) => `${c.file}:${c.line}`).join(", ") || "（无）"}`,
);

// ─── 断言 2：非出口文件不得 import SaveAppConfig 绑定 ───
const offenders = [];
for (const abs of productionFiles(SRC_DIR)) {
  const r = rel(abs);
  if (r === EXIT_FILE) continue;
  const text = stripComments(fs.readFileSync(abs, "utf8"));
  // import { ... SaveAppConfig ... } from "..."
  for (const m of text.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from/g)) {
    const names = m[1].split(",").map((s) =>
      s
        .trim()
        .split(/\s+as\s+/)[0]
        .trim(),
    );
    if (names.includes("SaveAppConfig")) {
      offenders.push(`${r}: ${m[0].replace(/\s+/g, " ").trim()}`);
    }
  }
}
assert.deepStrictEqual(
  offenders,
  [],
  `以下文件 import 了 SaveAppConfig 绑定（绕开唯一出口）：\n  ${offenders.join("\n  ")}`,
);

// ─── 断言 3：出口文件不得裸写 "dark" 主题字面量，缺省引 THEME_DARK ───
const exitText = stripComments(fs.readFileSync(path.join(SRC_DIR, EXIT_FILE), "utf8"));
assert.ok(
  !/["'`]dark["'`]/.test(exitText),
  `${EXIT_FILE} 出现 "dark" 字面量：THEME_VALID = [cyber/warm/pro/sakura/ocean/mint/system] 无此值，` +
    `落盘后 normalizeTheme 会静默归一成 system（用户没改主题却被改成跟随系统）。缺省请引 THEME_DARK。`,
);
assert.ok(
  /import\s*\{[^}]*\bTHEME_DARK\b[^}]*\}\s*from\s*["']@\/theme-core["']/.test(exitText),
  `${EXIT_FILE} 必须 import THEME_DARK（theme-core 单一来源）作为主题缺省`,
);

console.log(
  `[OK] test_config_write_single_exit.ts 全部断言通过（实参点 1 处 = ${EXIT_FILE}；` +
    `扫描生产文件 ${productionFiles(SRC_DIR).length} 个）`,
);
