#!/usr/bin/env node
/**
 * css-token-check.ts — 视图层 token 消费门禁（零外部依赖；复用 _lib/scan-files、_lib/css-layer-utils）。
 *
 * 立脚本背景（审计 UI-Design-Audit-2026-09.md §5.2 第 3 步）：
 *   规范 UI-Design.md §10 明令「禁止硬编码」，但无脚本拦得住——`--card-padding` 有真值仍被 4 处手抄
 *   兜底、`--shadow-*` 被 7 处裸盒阴影绕过。css-layer-check 管「shadow 越界」，不管「视图层裸值」。
 *   本脚本补这第二道闸：**视图层出现裸数值（非 var()/calc(var())）即报警**，逼出 token 消费纪律。
 *
 * 检查项（WARN 起步，成熟后转 ERROR / --strict 接 pre-push）：
 *   属性位出现裸数值：`padding / margin / gap / border-radius / box-shadow / z-index / width / height`
 *   （width/height 仅报内联 style 与 CSS 声明中的裸 px，图标定尺寸等经 TOKEN_CHECK_ALLOW 豁免）。
 *
 * 白名单豁免（TOKEN_CHECK_ALLOW）：
 *   - preview-3d 域全豁免（独立渲染栈，70+ 处 rgba(255,255,255,*) / 裸 z-index 是其自身视觉体系，审计已排除）
 *   - 图标定尺寸（.cr-avatar width:28px 等）：属「图标槽」语义，非布局裸值，经 allow 集逐类登记
 *   - 图片缩略图内联尺寸（detail.ts / maid-3d.ts / litematic-meta.ts 的 width:128px 等）：内容图，非 UI 控件
 *   - 动效透明度 opacity:.* 与 transition 时长：不属布局令牌，留待 P2-8 人工收敛，本闸不报
 *
 * 渐进策略：首版只报 WARN，把现有裸值全登记进 TOKEN_CHECK_ALLOW，之后**新增**裸值才报警——
 *   避免一次性 100+ 误报淹没信号（与 css-layer-check 的 KNOWN_NO_CSS_CLASSES 同范式）。
 *
 * 复用：expandStyleInterpolations（展开 ${X} 共享样式常量，否则共享串里的裸值不可见）；
 *       walk（递归扫 frontend/src）。
 *
 * 用法：
 *   node scripts/css-token-check.ts            # 报告 WARN（不阻断）
 *   node scripts/css-token-check.ts --strict   # WARN 也 exit 1（接 pre-push 前需先清空 allow 外命中）
 *   YSM_SKIP_TOKEN_CHECK=1 node ...            # 逃生阀
 *
 * 依赖：node:fs / node:path / node:url + 仓内 _lib/css-layer-utils.ts / _lib/scan-files.ts（零外部依赖）
 * 设计意图：UI-Design.md §10「禁止硬编码」的可执行断言——规范靠记忆必漂移（--card-padding 有真值仍被
 *   手抄、--shadow-* 被裸盒阴影绕过），本闸把「视图层裸值」变成阻断信号，适用场景 = pre-push 前端域门禁。
 *
 * 退出码：默认 0；--strict 且存在 WARN → 1。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expandStyleInterpolations } from "./_lib/css-layer-utils.ts";
import { ROOT, walk } from "./_lib/scan-files.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STRICT = process.argv.includes("--strict");
const JSON_OUT = process.argv.includes("--json");
if (process.env.YSM_SKIP_TOKEN_CHECK === "1") {
  console.log("[css-token-check] YSM_SKIP_TOKEN_CHECK=1, 跳过");
  process.exit(0);
}

/**
 * 注释 + 字符串感知剥离（仿 css-layer-utils.findStrayCommentClose 的字符串感知扫描）：
 * 剥除块注释 / 行注释 / 字符串字面量（含模板字面量），返回仅含「真实 CSS 文本」的串，
 * 避免注释/字符串里的 `padding: 4px 8px`（如本脚本自身的注释示例）被误报。
 */
function stripCommentsAndStrings(src: string): string {
  const TICK = String.fromCharCode(96);
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'" || c === TICK) {
      const quote = c;
      let j = i + 1;
      if (quote === TICK) {
        let depth = 0;
        while (j < n) {
          if (src[j] === "\\") j += 2;
          else if (src[j] === "$" && src[j + 1] === "{") {
            depth += 1;
            j += 2;
          } else if (src[j] === "{" && depth > 0) {
            depth += 1;
            j += 1;
          } else if (src[j] === "}" && depth > 0) {
            depth -= 1;
            j += 1;
          } else if (src[j] === quote && depth === 0) {
            j += 1;
            break;
          } else j += 1;
        }
      } else {
        while (j < n) {
          if (src[j] === "\\") j += 2;
          else if (src[j] === quote) {
            j += 1;
            break;
          } else if (src[j] === "\n") break;
          else j += 1;
        }
      }
      out += src.slice(i, j); // 字面量原文保留（不参与裸值判定）
      i = j;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n - 1 && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
      if (i < n - 1) i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

// 受检属性（CSS 声明 + 内联 style 同语法）
const CHECKED_PROPS = [
  "padding",
  "margin",
  "gap",
  "border-radius",
  "box-shadow",
  "z-index",
  "width",
  "height",
];

/**
 * 纯零值判定：padding/margin/gap/border-radius 的各段均为 0/0px（重置语义）。
 * 零不承载随字号缩放的间距信息、无令牌可归，报 WARN 属误报类；
 * width/height:0 有布局语义（隐藏占位）、z-index:0 ≠ auto，均不放行。
 */
function isZeroOnlyValue(prop: string, raw: string): boolean {
  if (!["padding", "margin", "gap", "border-radius"].includes(prop)) return false;
  const parts = raw.trim().split(/\s+/);
  return parts.length > 0 && parts.every((t) => /^0(px)?$/.test(t));
}

// 裸「绝对数值」判定：属性位后跟带绝对单位的数值（px/rem/vh/vw/pt）或纯数字（无单位，如 z-index:10）。
// 排除：
//   - var()/calc(var()（已由调用方前置过滤）
//   - TS 类型字段（width: number / height: string）——本正则要求数值带单位或纯数字，天然排除 `number`
//   - 相对值 auto / 100% / 50% 等（百分比/auto 非硬编码绝对尺寸，不在本闸范围，避免淹没信号）
// 例：padding:10px 12px ✗ / padding:var(--sp-3) ✓（前置过滤）/ width:100% ✓（相对，放行）/ z-index:10 ✗
const BARE_VALUE_RE = /(?:^|[\s;])((?:--)?[a-z-]+)\s*:\s*((?:[^;{]*?))(?=[;}]|$)/gi;
// 绝对数值 token：带 px/rem/vh/vw/pt 或纯数字（不含 % / auto / number / string）
const ABSOLUTE_NUM =
  /(?:^|[\s,(])(?:-?\d+(?:\.\d+)?(?:px|rem|vh|vw|pt|em)|-?\d+(?!\w))(?=[\s,)]|$)/;

/**
 * 白名单豁免集（逐类附理由，仿 css-layer-check.KNOWN_NO_CSS_CLASSES）：
 * 这些裸值是合法的「图标槽 / 内容图 / 物理像素」语义，非 UI 布局裸值，登记以免误报。
 * 未来若真要 token 化（如 --icon-sm），从此集移除即会触发 WARN，倒逼复核。
 */
const TOKEN_CHECK_ALLOW = new Set<string>([
  // 图标定尺寸（avatar / icon / 状态点）：属「图标槽」语义，非布局间距
  "cr-avatar:width:28px",
  "cr-avatar:height:28px",
  "cr-creator-icon:width:28px",
  "gh-creator-icon:width:22px",
  "gh-card-icon:width:24px",
  "gh-icon-btn:width:28px",
  "gh-icon-btn:height:28px",
  "gh-popup-icon:width:20px",
  "cr-detail-avatar:width:36px",
  "cr-detail-avatar:height:36px",
  "nav-item .icon:width:20px",
  "nav-viewer-fab .icon:width:20px",
  "context-menu .item .icon:width:16px",
  "scan-radar:width:80px",
  "scan-radar:height:80px",
  "scan-radar-dot:width:8px",
  "scan-radar-dot:height:8px",
  "oldest-health-ring:width:28px",
  "oldest-health-ring:height:28px",
  "oldest-health-ring-inner:width:22px",
  "oldest-health-ring-inner:height:22px",
  "health-ring:width:80px",
  "health-ring:height:80px",
  "lt-color-swatch:width:10px",
  "lt-color-swatch:height:10px",
  "fl-list .ck:width:22px",
  "fl-list .ck:height:12px",
  "fh-list .ck:width:22px",
  "fh-list .ck:height:12px",
  "fl .ck:width:22px",
  "fl .ck:height:12px",
  "fh .ck:width:22px",
  "fh .ck:height:12px",
  "cr-edit-card-avatar:width:22px",
  "cr-edit-card-avatar:height:22px",
  "cr-card-header .cr-avatar-container:width:32px",
  "cr-card-header .cr-avatar-container:height:32px",
  "cr-detail-avatar-container:width:36px",
  "cr-detail-avatar-container:height:36px",
  "cr-detail-avatar-img:width:36px",
  "cr-detail-avatar-img:height:36px",
  "cr-detail-avatar-text:width:36px",
  "cr-detail-avatar-text:height:36px",
  "cr-avatar-container:width:28px",
  "cr-avatar-container:height:28px",
  "tag:min-width:16px",
  "dd-wrap .dd-menu:min-width:160px",
  "sidebar-css .tag:min-width:16px",
  // 内容图缩略图（detail / maid-3d / litematic）：图片物理尺寸，非 UI 控件
  "detail.ts:img:width:128px",
  "detail.ts:img:height:128px",
  "maid-3d.ts:img:width:96px",
  "maid-3d.ts:img:height:96px",
  "litematic-meta.ts:img:width:140px",
  "litematic-meta.ts:img:height:140px",
  "skeleton-render:img:width:20px",
  "skeleton-render:img:height:20px",
  "pv-stat-label:min-width:80px",
  "perf-bar-val:min-width:130px",
  "perf-bl-delta:min-width:96px",
  "perf-conc-ms:min-width:88px",
  "perf-conc-speedup:min-width:64px",
  "perf-conc-verdict:min-width:72px",
  "diag-log-search:min-width:110px",
  "diag-log-op-filter:min-width:150px",
  "diag-bar-row input:min-width:180px",
  "diag-config-select:min-width:160px",
  "cr-search-input:min-width:120px",
  "cr-search-input:max-width:180px",
  "cr-creator-card--grid:min-width:200px",
  "cr-creator-card--grid:max-width:280px",
  "pick-card:min-width:140px",
  "pick-card:max-width:200px",
  "model-card-sm:min-width:200px",
  "instance-card-pkg-count:min-width:0px",
  "af-inp:width:56px",
  // 装饰性微尺寸与重置（css-token 账收口 2026-09-25 登记）：
  // 分档色条 / 图例色板 / 拖拽把手 / 无装饰重置——物理微像素或纯重置语义，不属字号缩放体系
  "cr-card-tier-bar:height:3px",
  "cr-tier-swatch:width:10px",
  "cr-tier-swatch:height:10px",
  "preview-resize-handle:width:4px",
  "sm-dir-arrow:width:14px",
  // 图标槽定尺寸（ADR-238 .ws-icon 唯一尺寸出处 utils/dom/css.ts）：
  // 1em 随字号缩放，属「图标槽」语义非布局间距——不入 sp 梯
  "ws-icon:width:1em",
  "ws-icon:height:1em",
  // 预览域（preview-3d）全豁免：独立渲染栈，其裸值体系审计已排除（不在本闸范围）
  "preview-3d:all",
]);

/** 判断某「文件 + 类 + 属性 + 裸值」是否豁免。 */
function isAllowed(fileRel: string, cls: string, prop: string, ctx: string): boolean {
  // 预览域全豁免（rel 形如 frontend/src/preview-3d/...，用 includes 判定）
  if (fileRel.includes("preview-3d/")) return true;
  // 精确豁免集
  const key1 = `${cls}:${prop}:${ctx}`;
  const key2 = `${cls}:${prop}`;
  const key3 = `${path.basename(fileRel)}:${prop}:${ctx}`;
  if (TOKEN_CHECK_ALLOW.has(key1) || TOKEN_CHECK_ALLOW.has(key2) || TOKEN_CHECK_ALLOW.has(key3))
    return true;
  return false;
}

/** 从 CSS 文本提取 class 上下文（最近的前一个 .foo / .foo-bar 选择器）。 */
function extractClassContext(
  cssText: string,
): { cls: string; props: { prop: string; raw: string }[] }[] {
  const results: { cls: string; props: { prop: string; raw: string }[] }[] = [];
  // 按选择器块切分：`.cls { ... }` 或 `selector { ... }`
  const blockRe = /([.#]?[\w-]+(?:[ .#][\w-]+)*)\s*\{([^}]*)\}/g;
  for (const bm of cssText.matchAll(blockRe)) {
    const selector = (bm[1] ?? "").trim();
    const body = bm[2] ?? "";
    // 跳过伪命中：模板字符串内联 HTML/CSS（body 含引号/尖括号说明是字符串内容，非真实 shadow CSS 块；
    // 内联 style 由 extractInlineBare 单独处理）。selector 含引号/尖括号同理跳过。
    if (/["'<>]/.test(selector) || /["'<>]/.test(body)) continue;
    // 取主类名（首个 .foo）；noUncheckedIndexedAccess 下 match 组仍是 string|undefined，?? 兜 selector
    const cls = selector.match(/\.([\w-]+)/)?.[1] ?? selector;
    const props: { prop: string; raw: string }[] = [];
    for (const pm of body.matchAll(BARE_VALUE_RE)) {
      const prop = (pm[1] ?? "").trim();
      const raw = (pm[2] ?? "").trim();
      if (!CHECKED_PROPS.includes(prop)) continue;
      // 裸值判定：raw 里不含 var( 且不含 calc(var(
      if (/var\(\s*--/.test(raw)) continue;
      if (/calc\(\s*var\(/.test(raw)) continue;
      // 纯零值放行：重置语义无缩放信息（border-radius:0 / padding:0 等）
      if (isZeroOnlyValue(prop, raw)) continue;
      // 只报绝对数值（px/rem/vh/pt 或纯数字）；排除相对值（100% / auto）/ TS 类型（number）
      if (!ABSOLUTE_NUM.test(raw)) continue;
      props.push({ prop, raw });
    }
    if (props.length) results.push({ cls, props });
  }
  return results;
}

/** 从内联 style 字符串提取裸值（detail.ts 等内联 width:128px）。 */
function extractInlineBare(fileRel: string, htmlText: string, findings: string[]): void {
  const styleRe = /style\s*=\s*"([^"]*)"/g;
  for (const sm of htmlText.matchAll(styleRe)) {
    const styleBody = sm[1] ?? "";
    for (const pm of styleBody.matchAll(BARE_VALUE_RE)) {
      const prop = (pm[1] ?? "").trim();
      const raw = (pm[2] ?? "").trim();
      if (!CHECKED_PROPS.includes(prop)) continue;
      if (/var\(\s*--/.test(raw) || /calc\(\s*var\(/.test(raw)) continue;
      if (!ABSOLUTE_NUM.test(raw)) continue; // 只报绝对数值，排除 100%/auto/number
      // 内联豁免（图片缩略图等绝对 px 尺寸）
      if (
        fileRel.includes("detail.ts") ||
        fileRel.includes("maid-3d.ts") ||
        fileRel.includes("litematic-meta.ts") ||
        fileRel.includes("skeleton-render.ts")
      ) {
        if (/width|height/.test(prop)) continue;
      }
      findings.push(`[WARN] ${fileRel}: 内联 style 裸值 ${prop}:${raw}`);
    }
  }
}

let warnCount = 0;
const problems: string[] = [];

// 递归扫 frontend/src（含 preview-3d，域内豁免）
const files = walk(path.resolve(ROOT, "frontend/src"), {
  exts: [".ts"],
  skipDir: (n) => n.startsWith(".") || n === "node_modules",
  skipFile: (n) => n.endsWith(".test.ts"),
}) as string[];

// 基线模式：首次运行把当前全部命中写入基线文件，后续只报「基线外的新增裸值」，
// 避免一次性几百条存量误报淹没信号（存量收敛是人工渐进，不在门禁首版目标）。
// 用法：node scripts/css-token-check.ts --rebuild-baseline  重建基线（存量收敛后调用）
const BASELINE_FILE = path.resolve(__dirname, ".css-token-baseline.txt");
const REBUILD = process.argv.includes("--rebuild-baseline");
let baseline = new Set<string>();
if (!REBUILD && fs.existsSync(BASELINE_FILE)) {
  baseline = new Set(
    fs
      .readFileSync(BASELINE_FILE, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
  );
}

const allHits: string[] = []; // 本次全部命中（用于写基线）

for (const f of files) {
  const rel = path.relative(ROOT, f).split(path.sep).join("/");
  const src = fs.readFileSync(f, "utf8");
  // 展开插值常量（否则共享串 btnBaseCSS 等内的裸值不可见）
  const expanded = expandStyleInterpolations(src, f);
  const clean = stripCommentsAndStrings(expanded);
  const blocks = extractClassContext(clean);
  for (const b of blocks) {
    for (const p of b.props) {
      if (isAllowed(rel, b.cls, p.prop, p.raw)) continue;
      const hit = `${rel}::.${b.cls}::${p.prop}:${p.raw}`;
      allHits.push(hit);
      if (baseline.has(hit)) continue;
      warnCount++;
      problems.push(
        `[WARN] ${rel}: .${b.cls} ${p.prop}:${p.raw} 裸值（应走 var(--*) 令牌；若合法经 TOKEN_CHECK_ALLOW 登记）`,
      );
    }
  }
  // 内联 style 裸值（detail.ts 等）
  const inlineFinds: string[] = [];
  extractInlineBare(rel, clean, inlineFinds);
  for (const w of inlineFinds) {
    // w 形如 [WARN] rel: 内联 style 裸值 prop:raw —— 转基线键
    const m = w.match(/\[WARN\] (.+?): 内联 style 裸值 (.+?)$/);
    if (m) {
      const hit = `${m[1]}::__inline__::${m[2]}`;
      allHits.push(hit);
      if (baseline.has(hit)) continue;
    }
    warnCount++;
    problems.push(w);
  }
}

// 重建基线
if (REBUILD) {
  fs.writeFileSync(BASELINE_FILE, `${allHits.slice().sort().join("\n")}\n`, "utf-8");
  console.log(
    `[css-token-check] 基线已重建：${allHits.length} 条（写入 ${path.relative(ROOT, BASELINE_FILE)}）`,
  );
  process.exit(0);
}
// 首次运行（无基线）→ 自动建基线，使门禁可落地而不被存量淹没
if (!fs.existsSync(BASELINE_FILE) && allHits.length > 0) {
  fs.writeFileSync(BASELINE_FILE, `${allHits.slice().sort().join("\n")}\n`, "utf-8");
  console.log(
    `[css-token-check] 首次运行：已建基线 ${allHits.length} 条（${path.relative(ROOT, BASELINE_FILE)}）。后续仅报基线外新增裸值；存量收敛后跑 --rebuild-baseline 更新。`,
  );
  process.exit(0);
}

// ── 输出 ──
// --json 形状对齐 gate-parse.parseToolOutput 契约：_summary.ok 为 boolean（最高优先级），
// 否则退回 rc===0。默认（无 --strict）即使有新增 WARN 也 ok=true / rc=0（不阻断 push，
// 仅可见）；--strict 时 ok=false / rc=1（接 pre-push 阻断）。
const okNow = !(STRICT && warnCount > 0);
if (problems.length === 0) {
  if (JSON_OUT) console.log(JSON.stringify({ _summary: { ok: true, warns: 0 }, problems: [] }));
  else console.log("[css-token-check] ✅ 无新增视图层裸值（存量在基线内）");
  process.exit(0);
}
if (JSON_OUT) {
  console.log(
    JSON.stringify({
      _summary: { ok: okNow, warns: warnCount },
      problems,
    }),
  );
} else {
  console.log(`[css-token-check] 发现 ${warnCount} 个新增 WARN：`);
  for (const p of problems) console.log(`  ${p}`);
}
if (STRICT && warnCount > 0) {
  console.log("[css-token-check] --strict: WARN 阻断（新增裸值未登记基线）");
  process.exit(1);
}
process.exit(0);
