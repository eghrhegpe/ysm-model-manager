#!/usr/bin/env node
/**
 * 契约测试：构建/工具配置引用的入口文件必须存在。
 *
 * 背景（2026-09-11 CI 复盘，Pages 第十层）：
 *   dcff6379c（2026-09-05）删除了 frontend/web.html 与 frontend/src/web-spike/main.ts，
 *   但未同步三处引用：
 *     · frontend/vite.web.config.ts 的 rollupOptions.input.spike → rollup 报
 *       「Could not resolve entry module "web.html"」，CI Pages 的 build:web 步骤长期红；
 *     · frontend/knip.json 的 entry 数组 → knip 静默忽略不存在的入口，无任何报错。
 *   本地同样失败，但 build:web 不在 pre-push 门禁内，故无人察觉——只有 Pages 工作流
 *   是唯一消费者，而它只挂 Pages 不挂 CI。
 *
 * 本测试是该缺口的静态护栏：读取声明式配置里的「入口文件引用」，断言其物理存在。
 * 桌面构建（vite build）会因 rollup 解析失败而报错，web 构建同理；knip 则完全静默——
 * 故必须在文本层拦一道，不依赖各工具是否恰好会报错。
 *
 * 覆盖范围（新增引用方时同步登记 REFS）：
 *   · frontend/vite.web.config.ts — resolve(root, "<html>") 形态的 rollup 入口
 *   · frontend/knip.json          — entry 数组（.html 与 .ts 入口）
 *
 * 运行：node tests/test_build_entry_refs.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ROOT 本地推导（对齐同侪测试模式：test_alias-resolve / test_check_mock_paths /
// test_check_path_hygiene 均本地定义，不依赖 scan-files 的 ROOT 语义与模块副作用）
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FE = path.join(ROOT, "frontend");

let failed = 0;
const fail = (msg: string): void => {
  console.error(`[FAIL] ${msg}`);
  failed++;
};

/** 断言路径（相对 frontend/）存在，收集失败项。 */
const missing: string[] = [];
const expectExists = (relFromFe: string, declaredIn: string): void => {
  const abs = path.join(FE, relFromFe);
  if (!fs.existsSync(abs)) {
    missing.push(`${declaredIn} 声明的入口不存在: frontend/${relFromFe}`);
  }
};

/**
 * vite.*.config.* 的入口提取：只锚定 rollupOptions.input 块（vite 语义上入口只能声明在
 * input: {} 里），块内取 resolve(..., "<file.ext>") 字面量。原全文本匹配会把别名映射、
 * outDir 等 resolve 调用误判为入口（假阳性），且 input 块里的多段 resolve(root, "src", "x")
 * 形态会漏判（假阴性）——先切出 input: { ... } 块（括号配平），再在块内匹配。
 */
const VITE_CONFIGS = ["vite.config.js", "vite.web.config.ts", "vite.e2e.config.ts"];
const ENTRY_LITERAL_RE = /resolve\(\s*[\w.]+\s*(?:,\s*[\w.]+\s*)*,\s*"([^"]+\.[a-z]{2,4})"\s*\)/g;

/** 切出 input: { ... } 的块文本（自 `input:` 后 `{` 起括号配平；找不到块返回 null）。 */
function extractInputBlock(txt: string): string | null {
  const m = /(?<![\w$])input\s*:\s*\{/.exec(txt);
  if (!m) return null;
  const start = txt.indexOf("{", m.index);
  let depth = 0;
  for (let i = start; i < txt.length; i++) {
    if (txt[i] === "{") depth++;
    else if (txt[i] === "}") {
      depth--;
      if (depth === 0) return txt.slice(start, i + 1);
    }
  }
  return null; // 括号不配平（配置本身残缺）→ 视为无块，靠零匹配自检兜底
}

let viteEntryCount = 0;
for (const cfg of VITE_CONFIGS) {
  const abs = path.join(FE, cfg);
  if (!fs.existsSync(abs)) continue;
  const txt = fs.readFileSync(abs, "utf8");
  const block = extractInputBlock(txt);
  let matched = 0;
  if (block) {
    for (const m of block.matchAll(ENTRY_LITERAL_RE)) {
      const rel = m[1];
      if (!rel) continue;
      // 排除 `../` 越出 frontend/ 的引用（如 ../resource_types.json，非入口）
      if (rel.startsWith("..")) continue;
      matched++;
      expectExists(rel, cfg);
    }
  }
  viteEntryCount += matched;
  // 零匹配自检：正则退化（vite 改语法/提取逻辑漂移）时大声失败，不静默验证个寂寞。
  // 仅约束「声明了 input: 块」的配置——无块配置（vite 默认单入口 index.html）不在此列
  if (block && matched === 0) {
    fail(
      `${cfg} 的 rollupOptions.input 块提取到 0 个入口——正则或块提取退化，检查 ENTRY_LITERAL_RE`,
    );
  }
}

// ── knip.json entry 数组（.html / .ts 字面量入口）──────────────────────
let knipEntryCount = 0;
const knipAbs = path.join(FE, "knip.json");
if (fs.existsSync(knipAbs)) {
  let knip: { entry?: unknown };
  try {
    knip = JSON.parse(fs.readFileSync(knipAbs, "utf8"));
  } catch (e) {
    fail(`frontend/knip.json 不是合法 JSON：${(e as Error).message}`);
    knip = {};
  }
  const entries = Array.isArray(knip.entry) ? knip.entry : [];
  for (const raw of entries) {
    if (typeof raw !== "string") continue;
    // glob 形态（含 * / ?）由 knip 自行展开，此处不校验物理存在性
    if (/[*?[\]{}]/.test(raw)) continue;
    // 仅校验文件型入口（有扩展名）——目录型入口由 knip 语义处理
    if (!/\.[a-z]{2,4}$/.test(raw)) continue;
    knipEntryCount++;
    expectExists(raw, "knip.json");
  }
}

if (missing.length) {
  fail(
    `配置声明的入口文件缺失（删除文件后未同步引用方）:\n    ${missing.join("\n    ")}\n` +
      `  → 修正声明方（vite.*.config.* 的 rollupOptions.input / knip.json 的 entry），` +
      `而非找回已删文件——先确认该入口是否真被决策废弃（查 git log -- <文件>）。`,
  );
}

console.log(
  `  校验 frontend/ 配置入口引用：vite 配置 ${viteEntryCount} 处、knip ${knipEntryCount} 处`,
);

if (failed > 0) {
  console.error(`\n❌ 契约测试失败：${failed} 项`);
  process.exit(1);
}
console.log("✅ 构建/工具配置入口引用全部存在通过");
