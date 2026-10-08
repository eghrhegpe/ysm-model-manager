#!/usr/bin/env node
/**
 * 契约测试：docs 文档 frontmatter 与 workflow YAML 的完整语法 + 结构校验。
 *
 * 背景（2026-10-08 门禁锐评 P0 落地）：scripts/_lib/frontmatter.ts 是行级正则解析
 * （key: value / - item 逐行匹配），**不验证 YAML 语法**——四类结构雷因此穿透全部
 * 本地检查，直到 VitePress 站点构建（完整 YAML 解析器）才炸：
 *   ① `- **flag ...` —— `*` 行首被 YAML 当 alias 引用（unidentified alias）
 *   ② `> ⚠️ ...` —— `>` 行首是 block scalar 语法（Not a YAML token）
 *   ③ `处置：` —— 全角冒号不是 YAML 键分隔符，解析成**标量**而非映射（结构雷）
 *   ④ 任意 YAML 语法错误（坏缩进 / 重复键 / 非法 token）
 * 而 GitHub workflow 的 YAML 也只在 push 后由 GitHub 静态校验（startup_failure），
 * 本地无预检。
 *
 * 本测试用 vendored `yaml` 2.9.1（scripts/_lib/vendor/yaml，零依赖、与 VitePress
 * 同源解析器）对全部 frontmatter 段与 workflow 文件做完整解析，双规则：
 *   R1 语法：parseDocument.errors 非空 → FAIL（拦 ①②④ 及一切语法雷）
 *   R2 结构：toJS() 结果必须是非数组 object（key: value 映射）→ FAIL
 *      （拦 ③：全角冒号字段解析成 string；正常 frontmatter/workflow 顶层必为映射）
 *
 * 零依赖 vendor ⇒ contracts job（不装前端依赖）可跑 ⇒ 本地 pre-push 秒级 + 主 CI
 * 双拦截，此类雷从「pages 部署才暴露」提前到「本地提交就红」。
 *
 * 运行：node tests/test_knowledge_frontmatter_yaml.ts
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { ROOT } from "../scripts/_lib/scan-files.ts";
import { parseFrontmatter } from "../scripts/_lib/frontmatter.ts";

const require = createRequire(import.meta.url);
// vendored yaml（CJS，main 入口）；校验口径与 VitePress 站点构建解析器同源
const YAML = require(path.join(ROOT, "scripts", "_lib", "vendor", "yaml", "dist", "index.js"));

let failed = 0;
const fail = (msg: string): void => {
  console.error(`[FAIL] ${msg}`);
  failed++;
};

/** 对单个 YAML 源做双规则校验，返回违规消息列表（空 = 通过）。 */
function checkYaml(label: string, source: string): string[] {
  const doc = YAML.parseDocument(source);
  const out: string[] = [];
  if (doc.errors.length > 0) {
    for (const e of doc.errors) {
      out.push(`${label} — YAML 语法错误：${e.message.split("\n")[0]}`);
    }
  }
  // ⚠️ toJS() 会抛运行时错误（实证：`**` alias 雷 build 期 errors 为空，Unresolved alias
  // 直到 toJS() 才 ReferenceError——VitePress 的 unidentified alias 同源）。必须 try/catch。
  let value: unknown;
  try {
    value = doc.toJS();
  } catch (e) {
    out.push(`${label} — YAML 解析运行时错误：${String((e as Error).message ?? e).split("\n")[0]}`);
    return out;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    out.push(
      `${label} — 顶层必须是 key: value 映射，解析结果却是 ${
        value === null ? "null" : Array.isArray(value) ? "数组" : typeof value
      }（疑似全角冒号字段/结构错位：YAML 键分隔符必须是半角冒号）`,
    );
  }
  return out;
}

// ─── 扫描 1：docs/**/*.md 的 frontmatter 段 ────────────────────────
const DOCS_DIR = path.join(ROOT, "docs");
let mdScanned = 0;
let wfScanned = 0;
const checked: string[] = [];

function walkDocs(dir: string): void {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      walkDocs(p);
    } else if (e.name.endsWith(".md")) {
      const text = fs.readFileSync(p, "utf8");
      const fm = parseFrontmatter(text);
      if (fm === null) continue; // 无 frontmatter（ADR 首部/纯正文）——不属本测试
      mdScanned++;
      const rel = path.relative(ROOT, p).replace(/\\/g, "/");
      checked.push(...checkYaml(`${rel} (frontmatter)`, fm));
    }
  }
}
walkDocs(DOCS_DIR);

// ─── 扫描 2：.github/workflows/*.yml 与 .github/actions/**/*.yml ───
const WF_DIR = path.join(ROOT, ".github", "workflows");
if (fs.existsSync(WF_DIR)) {
  for (const f of fs.readdirSync(WF_DIR).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))) {
    wfScanned++;
    const rel = path.join(".github", "workflows", f).replace(/\\/g, "/");
    checked.push(...checkYaml(rel, fs.readFileSync(path.join(WF_DIR, f), "utf8")));
  }
}
const ACTIONS_DIR = path.join(ROOT, ".github", "actions");
if (fs.existsSync(ACTIONS_DIR)) {
  for (const f of fs.readdirSync(ACTIONS_DIR, { recursive: true }).filter((f) =>
    String(f).endsWith(".yml") || String(f).endsWith(".yaml"),
  )) {
    wfScanned++;
    const rel = path.join(".github", "actions", String(f)).replace(/\\/g, "/");
    checked.push(...checkYaml(rel, fs.readFileSync(path.join(ACTIONS_DIR, String(f)), "utf8")));
  }
}

for (const m of checked) fail(m);

console.log(
  `  扫描 ${mdScanned} 个 frontmatter 段 + ${wfScanned} 个 workflow/action YAML，` +
    `违规 ${checked.length} 处`,
);

if (failed > 0) {
  console.error(`\n❌ 契约测试失败：${failed} 项`);
  process.exit(1);
}
console.log("✅ docs frontmatter 与 workflow YAML 完整语法 + 结构校验通过");
