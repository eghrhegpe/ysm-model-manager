#!/usr/bin/env node
/**
 * css-layer-check.ts — Shadow DOM 样式越界检查器（零外部依赖；复用 _lib/scan-files、_lib/alias-resolve）。
 *
 * 问题背景：
 *   本项目大量组件使用 Shadow DOM（attachShadow + adoptedStyleSheets）。
 *   document 层 frontend/css/components.css 经 index.html 全局 <link> 加载，
 *   但 Shadow DOM 边界会阻断：① 全局 CSS 类在 shadow 内不生效；
 *                                     ② 全局 @keyframes 在 shadow 内不生效
 *                                       （CSS 自定义属性可穿透，@keyframes 不可）。
 *   因此「类/keyframe 定义在 components.css」≠「在 shadow 内生效」。这类 bug
 *   纯靠 grep 看不出来，且 build/typecheck 不验证 CSS 实际生效，CI 全绿也能过境。
 *
 * 检查项（ERROR 阻断 / WARN 提示）：
 *   [ERROR] shadow 内 CSS 的 `animation: <name>` 引用，但在同 shadow 层无 @keyframes 定义
 *           → 跨 shadow keyframe 静默失效（getAnimations()=0，无动画不破功能故潜伏）
 *   [ERROR] 反向断言：frontend/css/components.css 仍含 .stg-* / .tab-body
 *           → 这些已回迁 shadow（见 21c01725 / 9942ada3），全局副本是漂移源
 *   [WARN]  shadow tpl/组件 HTML 的 class="..." 使用的类，在当前 shadow 层无定义
 *           → 判定域 = **本域 CSS 自己定义过的命名空间**（自推导；不再靠手写前缀表，
 *             手写表漏一族即整族静默失明）。跨层模板（如 document 层 .dlg-*）不在域内，不误报
 *   [ERROR] 有 animation/transition 的 shadow 域未 adopt `.no-animations` 通配桥
 *           → 「关闭动画」开关在该域静默失效（文档层规则不穿透 shadow 边界，见 ADR-015
 *             §2.4 约束 1「用户关闭时零动画」）
 *
 * 发现机制（全自动，无手写域清单）：
 *   递归遍历 frontend/src/views/_（每个视图目录），凡目录内任一 .ts 命中 shadow 样式标记
 *   （export const XxxCSS / :host / adoptedStyleSheets）即认定为 shadow 域，
 *   css 源=命中文件，html 源=目录内全部非测试 .ts。新增 shadow 视图无需改本脚本即自动纳入，
 *   根除「手写 SHADOW_DOMAINS 清单」这类第二批漂移事实源（见评审 2026-08-24 第 2 条）。
 *
 * 用法：
 *   node scripts/css-layer-check.ts            # 报告，ERROR 也只提示（非阻断）
 *   node scripts/css-layer-check.ts --strict   # ERROR 时 exit 1（供 pre-push 门禁）
 *   YSM_SKIP_CSS_LAYER=1 node ...               # 逃生阀，跳过本检查
 *
 * 退出码：默认 0；--strict 且存在 ERROR → 1。
 *
 * 依赖：node:fs / node:path / node:url；_lib/scan-files.ts（walk）、
 *       _lib/alias-resolve.ts（@/ 别名解析，供 TS 插值常量的来源定位）。
 *
 * 设计意图：Shadow DOM 样式越界的自动化防线——类/keyframe 定义在 components.css
 * 并不等于在 shadow 内生效（@keyframes 不可穿透），纯 grep 看不出的 bug 由本闸抓出。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  expandStyleInterpolations,
  findStrayCommentClose,
  findUndefinedAnywhereClasses,
  hasMotionDeclaration,
  hasNoAnimationsBridge,
} from "./_lib/css-layer-utils.ts";
import { walk } from "./_lib/scan-files.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const STRICT = process.argv.includes("--strict");
const JSON_OUT = process.argv.includes("--json");
if (process.env.YSM_SKIP_CSS_LAYER === "1") {
  console.log("[css-layer-check] YSM_SKIP_CSS_LAYER=1, 跳过");
  process.exit(0);
}

// ── Shadow 域全自动发现：不再手写 SHADOW_DOMAINS 清单 ──
// 手写清单是第二批漂移事实源（见评审 2026-08-24 第 2 条）：新增 shadow 视图必忘配，
// 导致 app-nav / app-toast / context-menu 等长年漏扫。改为递归遍历 frontend/src/views/*/，
// 凡目录内任一 .ts 命中 shadow 样式标记即认定为 shadow 域，自动聚合其 css/html 源。
//
// 发现规则：
//   css 源 = 目录内命中「export const XxxCSS」/「:host」/「adoptedStyleSheets」的 .ts 文件
//            （即实际承载 shadow 样式定义的文件，与文件名无关——sidebar-css.ts / css.ts /
//             app-tree-styles.ts / content-*.ts / tpl.ts 内联样式 一律自动捕获）
//   html 源 = 目录内全部 .ts（排除 *.test.ts），纯逻辑文件无 class="..." 模板，提取零命中不贡献噪声
//
// 这样新增任何 shadow 视图无需改本脚本即自动纳入扫描，杜绝清单式漂移。

const CSS_MARKER = /export const [A-Za-z]+CSS|:host\b|adoptedStyleSheets/;

/** shadow 域：css = 承载 shadow 样式的源文件（命中 CSS_MARKER 者），html = 域内全部 .ts。 */
interface ShadowDomain {
  name: string;
  css: string[];
  html: string[];
}

function walkDir(dir: string): string[] {
  return walk(dir, {
    exts: [".ts"],
    skipDir: () => false,
    skipFile: (n) => n.endsWith(".test.ts"),
  }) as string[];
}

/** 域构建：目录内任一 .ts 命中 shadow 样式标记即为 css 源；无标记目录返回 null（纯逻辑域）。 */
function buildDomain(name: string, dir: string): ShadowDomain | null {
  const files = walkDir(dir);
  const cssSources: string[] = [];
  for (const f of files) {
    if (CSS_MARKER.test(fs.readFileSync(f, "utf8"))) cssSources.push(f);
  }
  if (cssSources.length === 0) return null; // 无 shadow 样式标记的目录：跳过（如 app-resource-manager 纯逻辑）
  return {
    name,
    css: cssSources.map((p) => path.relative(ROOT, p).split(path.sep).join("/")),
    html: files.map((p) => path.relative(ROOT, p).split(path.sep).join("/")),
  };
}

function discoverShadowDomains(): ShadowDomain[] {
  const viewsRoot = path.resolve(ROOT, "frontend/src/views");
  const domains: ShadowDomain[] = [];
  if (!fs.existsSync(viewsRoot)) return domains;
  for (const entry of fs.readdirSync(viewsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dom = buildDomain(entry.name, path.join(viewsRoot, entry.name));
    if (dom) domains.push(dom);
  }
  return domains;
}

const SHADOW_DOMAINS = discoverShadowDomains();

/**
 * 检查 4 的额外动效域（**仅供检查 4 消费**，不并入 SHADOW_DOMAINS）。
 *
 * 3D HUD overlay 由 `preview-3d/infra/preview-shell.ts` 装配 attachShadow +
 * adoptedStyleSheets，位置在 `frontend/src/preview-3d/` 而非 `views/`，上面的 views/
 * 目录遍历发现不到——检查 4 会漏掉它（正是本闸要消灭的「假绿」）。
 * 刻意不并入 SHADOW_DOMAINS：那会同时扩张检查 1/2/3 的既有判定面（keyframe 本地化
 * 断言、类归属 WARN 基线），属另一件事，须单独评估后再动。
 * 判据与 views 侧同源（buildDomain 的 CSS_MARKER），仍是**目录级**发现——域内新增样式
 * 文件自动纳入，只有「根目录」多一条，不是手写文件清单。
 */
const EXTRA_MOTION_DOMAINS: ShadowDomain[] = [
  { name: "preview-3d-overlay", dir: path.resolve(ROOT, "frontend/src/preview-3d") },
]
  .map((d) => buildDomain(d.name, d.dir))
  .filter((d): d is ShadowDomain => d !== null);

// document 层类白名单：这些类定义在 components.css（全局 <link>），被 document 层 DOM 用，
// 不进 shadow，故 shadow tpl 不应引用它们（若引用是潜在越界，但此处不阻断，仅统计）。
const DOCUMENT_LAYER_FILE = "frontend/css/components.css";

// 已知「仅作 JS 钩子/容器锚点、样式全靠内联 style= 写死、无独立 shadow CSS 规则」的类。
// 这些类带本域专属前缀但刻意无 CSS 定义，属合法状态位，非漏迁。
// 未来若真要给它们加 shadow CSS 规则，从此集移除即会触发 WARN，倒逼复核（评审 2026-08-24 第 2 条）。
// 分类依据（walk 全目录后逐一审）：
//   gh-repo-card   — 与 .gh-card 同用（class="gh-card gh-repo-card"），冗余修饰钩子，gh-card 已有定义
//   ws-name/ws-desc — init-github.ts 内联 style 写死字号（11px/9px），纯锚点
//   cr-avatar-fallback — 与 .cr-avatar 同用，子修饰钩子
//   cr-input-name/cr-order-up/cr-order-down/cr-del/cr-add/cr-del-preset — 与 .cr-input/.cr-btn-icon 等基础类组合，纯 JS 点击锚点
const KNOWN_NO_CSS_CLASSES = new Set([
  "recy-page",
  "repo-left",
  "diag-log-filter",
  "ws-creators-list",
  "ws-browser-bar",
  "ws-url",
  "gh-repo-card",
  "ws-name",
  "ws-desc",
  "cr-avatar-fallback",
  "cr-input-name",
  "cr-order-up",
  "cr-order-down",
  "cr-del",
  "cr-add",
  "cr-del-preset",
  // 2026-09 新增：css-layer-check 检查 3 判定域改为「本域自推导命名空间」后由闸报出。
  // 逐一核实为「样式写在内联 style（且用 token）或纯 JS/e2e 钩子」，非漏定义：
  //   log-group / health-head — 分组头与体检头，样式全在内联 style（token）
  //   perf-gui / perf-hist / perf-bars / perf-trend / perf-legend / perf-legend-item
  //                           — 各面板容器，样式在内联 style（token）
  //   perf-copy-btn           — 与 .btn-base 同用，仅内联覆盖间距/字号
  //   perf-sb-status          — 引擎对照表状态列，e2e 列定位钩子，外观由 .perf-sb-table td 提供
  //   ha-preview / ha-copy    — app-tree 行内「作者/复制」按钮，纯 JS 点击钩子（与 .ha-btn 同用）
  //   ws-empty                — app-sidebar 空态容器，内联 style + 测试查询锚点
  //   btn-mc-dir              — app-sidebar footer 按钮修饰类，样式由 .btn-base + .footer-btn 承载
  "log-group",
  "health-head",
  "perf-gui",
  "perf-hist",
  "perf-bars",
  "perf-trend",
  "perf-legend",
  "perf-legend-item",
  "perf-copy-btn",
  "perf-sb-status",
  "ha-preview",
  "ha-copy",
  "ws-empty",
  "btn-mc-dir",
  // 2026-09 新增（检查 6「跨层存在性」报出，逐一核实均为合法无规则）：
  //   heatmap-bar-wrap / heatmap-bar / heatmap-bar-label — tpl-oldest.ts 月热力图：外层容器与
  //     bar 的高度/颜色全内联，bar 宽度由 label 文本撑开，容器 align-items:end 让标签基线对齐
  //     ⇒ 实际渲染为合法柱状图（类仅装饰，无布局职责）
  //   stage-item          — detail-3d.ts 兄弟列表项，样式全内联（padding/cursor/flex/border-left）
  //   model-detail-title  — preview-router.ts 详情标题，内联 font-size/font-weight
  //   stat-item           — app-sidebar footer 统计文本 span，样式由父 .footer-stats 提供
  //   gray                — app-sidebar「无YSM」标记的灰变体：.tag 基类已定义，green/red/orange
  //                         变体均限 .instance-card-header 作用域，gray **从未定义**（设计缺口，
  //                         非漏迁）；标记仍继承 .tag 样式，故不阻断
  //   br-preset           — tpl-batch-rename.ts 预设项，共类 .dlg-preset-chip 已定义 + JS 钩子
  //   br-file-cb          — 同上，共类 .br-cb 已定义 + JS 钩子（batch-rename-form.ts）
  "heatmap-bar-wrap",
  "heatmap-bar",
  "heatmap-bar-label",
  "stage-item",
  "model-detail-title",
  "stat-item",
  "gray",
  "br-preset",
  "br-file-cb",
]);

// 提取 CSS 文本中的类名（.foo / .foo-bar）。
// ⚠️ 先剥注释：闸的输入是**整份 .ts 源文件**（CSS 以模板串承载，同文件还有 TS 代码与注释），
// 不只是 CSS 片段。注释里出现的 `.btn-base` / `.dlg-*` 会被当成「已定义」——
// 于是「有没有那句注释」成了判定开关（2026-09 实测：content-layout.ts 一句块注释让 .btn-base 隐身；
// content-diag.ts 的 `// …（.dlg-*/.afv-*/.mc-pick-*/.br-* 等）` 行注释又凭空造出 6 个伪类名）。
// 故块注释与行注释**都要剥**（`(?<![:/])` 避开 `https://` 与 `///`）。
function stripComments(src: string): string {
  // 块注释按「首个 */ 闭合」解析，故朴素非贪婪剥离与浏览器语义一致
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<![:/])\/\/[^\n]*/g, "");
}
function extractClasses(src: string) {
  const classes = new Set<string>();
  const re = /\.([a-zA-Z][a-zA-Z0-9-]*)/g;
  for (const m of stripComments(src).matchAll(re)) {
    // 尾随连字符只出现在 `.ws-*` 这类注释/通配写法里，不可能是真类名
    if (m[1] && !m[1].endsWith("-")) classes.add(m[1]);
  }
  return classes;
}
function extractKeyframes(cssText: string) {
  const kf = new Set();
  const re = /@keyframes\s+([a-zA-Z0-9_-]+)/g;
  for (const m of cssText.matchAll(re)) kf.add(m[1]);
  return kf;
}
// 提取 animation: 引用的 keyframe 名（含简写 animation: name dur ...）
function extractAnimationRefs(cssText: string) {
  const refs = new Set();
  const re = /animation\s*:\s*([^;]+)/g;
  for (const m of cssText.matchAll(re)) {
    const body = m[1] ?? "";
    if (/\bnone\b/.test(body)) continue;
    // 取第一个 token 作为关键帧名（animation: name duration ...）
    const first = body.trim().split(/\s+/)[0];
    if (
      first &&
      !/^(infinite|both|forwards|backwards|linear|ease|ease-in|ease-out|ease-in-out|alternate|normal|\d|\.)/.test(
        first,
      )
    ) {
      refs.add(first);
    }
  }
  return refs;
}
// 提取 HTML 模板里 class="..." 使用的类名。
// 只认**静态类名列表**：属性值含 `$` 或 `+` 即动态表达式（`class="x-${v}"` /
// `'class="' + cls + '"'`），其中的标识符是变量名不是类名。旧实现只滤标点不滤标识符，
// 把 `healthTagClass` 这类变量名当类名收下（2026-09 实测假阳性）。
// 边界（有意）：动态表达式整组跳过——宁漏勿误报，假阳性会稀释真信号。
function extractHtmlClasses(htmlText: string) {
  const classes = new Set<string>();
  const re = /class\s*=\s*"([^"]*)"/g;
  for (const m of htmlText.matchAll(re)) {
    const raw = m[1] ?? "";
    if (/[$+]/.test(raw)) continue;
    for (const c of raw.split(/\s+/)) {
      // 仅收「字母开头、仅含字母数字连字符」的 token
      if (/^[a-zA-Z][a-zA-Z0-9-]*$/.test(c)) classes.add(c);
    }
  }
  return classes;
}

function readSafe(p: string) {
  const abs = path.resolve(ROOT, p);
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

// 提取某 @keyframes 内 `from` 块的 translate 参数（如 "translateY(6px)"）。
// 兼容多行（components.css）与单行（shadow 侧）写法；忽略空格/分号差异，只比对参数值。
// 返回 null 表示未找到该 keyframe 或 from 无 translate。
function extractKeyframeTranslate(cssText: string, name: string) {
  const re = new RegExp(`@keyframes\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`, "g");
  for (const m of cssText.matchAll(re)) {
    // 取从 { 到下一个顶级 } 的区间（keyframe 体）
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    for (; i < cssText.length; i++) {
      if (cssText[i] === "{") depth++;
      else if (cssText[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    const body = cssText.slice(start, i);
    // 在 from 块内找 translate
    const fromMatch = body.match(/from\s*\{[^}]*\}/);
    if (!fromMatch) continue;
    const tr = fromMatch[0].match(/transform\s*:\s*translate[XY]\s*\(([^)]+)\)/);
    if (tr) return tr[1]?.replace(/\s+/g, "");
  }
  return null;
}

// ── TS 模板插值展开（2026-09-14 锐评修复：根治 keyframes 假阳性）──
// 病灶：shadow CSS 以 TS 模板串承载，跨 shadow 共享的 keyframes 收敛为常量后经
// `${FADE_SLIDE_LEFT}` 注入（sidebar-css.ts 末尾、content-layout.ts:39）。本脚本按
// **源文件文本**正则扫 @keyframes，看不见插值内容 → 把「运行时确实生效」的定义判成缺失
// （实测 4 条 ERROR 全为假阳性）。后果不止误报：本闸在 gate-config 是 hard 项，恒红即
// 无法接进 CI，是「远端零防线」的一条隐藏根因。
// 修法：聚合 CSS 前，把 import 进来、且内容含 @keyframes 的常量就地展开，再走原正则。
// 只对含 @keyframes 的常量展开——避免把无关样式常量（如 btnBaseCSS）的类名一并引入，
// 扰动检查 3 的 WARN 判定基线（最小侵入，不动既有判定面）。
// 实现：resolveImportAbs / readConstLiteral / expandKeyframeInterpolations 三纯函数
// 实现：resolveImportAbs / readConstLiteral / expandStyleInterpolations 三纯函数
// 故纯算法下沉零副作用模块供测试消费，2026-09-14 契约测试缺口收口）。

let errorCount = 0;
let warnCount = 0;
const problems: string[] = [];

// ── 检查 1：shadow 内 animation 引用的 keyframe 是否同层有 @keyframes ──
for (const dom of SHADOW_DOMAINS) {
  let cssAgg = "";
  for (const f of dom.css) {
    const t = readSafe(f);
    if (t) cssAgg += `\n${expandStyleInterpolations(t, path.resolve(ROOT, f))}`;
  }
  const kf = extractKeyframes(cssAgg);
  const refs = extractAnimationRefs(cssAgg);
  for (const r of refs) {
    if (!kf.has(r)) {
      errorCount++;
      problems.push(
        `[ERROR] ${dom.name}: animation 引用 @keyframes '${r}' 但在本 shadow 层无定义（跨 shadow keyframe 静默失效）`,
      );
    }
  }
}

// ── 检查 1c：本地化 keyframe 参数一致性（铁律硬校验） ──
// 评审 2026-08-24 第 2 条：仅注释/知识卡里的"逐字节契约"仍靠人脑，本次漂移（6→10/-4→-10/-8→-14）
// 正是从这条逃逸路径溜过 pre-push。故从 components.css（全局副本）与 shadow 侧
// （content-layout.ts / sidebar-css.ts）正则提取 fadeSlideUp/Down/Left 的 from translate 参数值，
// 对不上即 ERROR。比较参数值（忽略空格/分号/多行差异），不要求字节级一致。
const KF_PARAM_NAMES = ["fadeSlideUp", "fadeSlideDown", "fadeSlideLeft"];
const compCssText = readSafe(DOCUMENT_LAYER_FILE) || "";
// shadow 侧 keyframe 来源：app-content(content-layout) + sidebar(sidebar-css)
const shadowKfSources = [
  "frontend/src/views/app-content/css/content-layout.ts",
  "frontend/src/views/app-sidebar/sidebar-css.ts",
];
let shadowKfAgg = "";
for (const f of shadowKfSources) {
  const t = readSafe(f);
  // 同检查 1：必须展开插值，否则 fadeSlideLeft 两侧都取不到 → 参数契约静默跳过（假绿）
  if (t) shadowKfAgg += `\n${expandStyleInterpolations(t, path.resolve(ROOT, f))}`;
}
for (const name of KF_PARAM_NAMES) {
  const globalVal = extractKeyframeTranslate(compCssText, name);
  const shadowVal = extractKeyframeTranslate(shadowKfAgg, name);
  if (globalVal === null || shadowVal === null) {
    // 任一侧缺失定义：检查 1 已覆盖 shadow 侧缺失；此处仅补全局侧缺失提示
    if (globalVal === null) {
      errorCount++;
      problems.push(
        `[ERROR] ${DOCUMENT_LAYER_FILE} 缺失 @keyframes '${name}' 的 from translate（本地化契约基准丢失）`,
      );
    }
    continue;
  }
  if (globalVal !== shadowVal) {
    errorCount++;
    problems.push(
      `[ERROR] 本地化 keyframe 契约违例：'${name}' from translate 全局=${globalVal} / shadow=${shadowVal} 不一致（components.css 与 shadow 侧须参数值一致，见评审 2026-08-24 第 2 条）`,
    );
  }
}

// ── 检查 1b：shadow tpl 内联 style="animation:<name>..." 引用的 keyframe 是否同层有 @keyframes ──
// 覆盖 app-sync-manager 等光 DOM 子树：其内联 style 的 animation 引用在 app-content shadow 层生效，
// 若同层无 @keyframes 则静默失效（与检查 1 同理，但源在内联 HTML 而非 CSS 文件）。
for (const dom of SHADOW_DOMAINS) {
  let cssAgg = "";
  for (const f of dom.css) {
    const t = readSafe(f);
    if (t) cssAgg += `\n${expandStyleInterpolations(t, path.resolve(ROOT, f))}`;
  }
  const kf = extractKeyframes(cssAgg);
  for (const f of dom.html) {
    const t = readSafe(f);
    if (!t) continue;
    const refs = extractAnimationRefs(t); // 复用：内联 style 的 animation: 同语法
    for (const r of refs) {
      if (!kf.has(r)) {
        errorCount++;
        problems.push(
          `[ERROR] ${dom.name}: tpl ${path.basename(f)} 内联 style 引用 @keyframes '${r}' 但在本 shadow 层无定义（跨 shadow keyframe 静默失效）`,
        );
      }
    }
  }
}

// ── 检查 2：反向断言 components.css 不含已回迁 shadow 的类 ──
const compCss = readSafe(DOCUMENT_LAYER_FILE) || "";
for (const forbidden of [
  /\.stg-[a-z-]+/,
  /\.tab-body\b/,
  /\.settings-group\b/,
  /\.setting-row\b/,
]) {
  const re = new RegExp(forbidden.source, "g");
  if (re.test(compCss)) {
    errorCount++;
    problems.push(
      `[ERROR] ${DOCUMENT_LAYER_FILE} 仍含已回迁 shadow 的类（${forbidden}）—— 全局副本是漂移源，应仅在 shadow 层定义`,
    );
  }
}

// ── 检查 3（WARN）：本域命名空间的类是否在 shadow 层有定义 ──
// 判定域 = **本域 CSS 自己定义过的命名空间**（`deriveNamespaceStems`：本域出现 .perf-bar-row
// 即认定 perf- 属本域），而不是手写前缀表。立因（2026-09 实测）：`DOMAIN_PREFIXES` 是 opt-in
// 子集，app-content 定义了 12 个 .perf-* 类却没登记 'perf-'，于是 .perf-controls / .perf-wrap
// （零 CSS 规则、控制条裸奔）对本闸完全不可见——「漏登记一族 = 整族静默失明」。
// 自推导把「该不该锁」从人手记忆变成证据：本域没定义过该族就不锁（不误报跨层模板如 dlg-*）；
// 本域定义了该族却用了没定义的类，就是漏定义（正是本检查要抓的形态）。
// 边界（有意）：本域**从未**定义过任何该族类时无法判定——此时该族可能定义在别的层或靠内联样式，
// 不报。该盲区由**检查 6** 用全局口径补上（2026-09 实测盲区 42 类）。
function stemOf(cls: string): string | null {
  const i = cls.indexOf("-");
  return i > 0 ? cls.slice(0, i + 1) : null; // .perf-bar-row → perf-
}
function deriveNamespaceStems(classes: Iterable<string>): Set<string> {
  const stems = new Set<string>();
  for (const c of classes) {
    const s = stemOf(c);
    if (s) stems.add(s);
  }
  return stems;
}

// 供检查 6 复用：域 → 本域 CSS 定义集 / 域 →（用到的类 → 首次出现的模板文件）
const domainCssClasses = new Map<string, Set<string>>();
const domainUsedClasses = new Map<string, Map<string, string>>();
for (const dom of SHADOW_DOMAINS) {
  let cssAgg = "";
  for (const f of dom.css) {
    const t = readSafe(f);
    if (t) cssAgg += `\n${expandStyleInterpolations(t, path.resolve(ROOT, f))}`;
  }
  const cssClasses = extractClasses(cssAgg);
  domainCssClasses.set(dom.name, cssClasses);
  const stems = deriveNamespaceStems(cssClasses);
  const usedMap = new Map<string, string>();
  for (const f of dom.html) {
    const t = readSafe(f);
    if (!t) continue;
    const used = extractHtmlClasses(t);
    for (const c of used) {
      if (!usedMap.has(c)) usedMap.set(c, path.basename(f));
      const s = stemOf(c);
      const isOwnNamespace = s !== null && stems.has(s);
      if (isOwnNamespace && !cssClasses.has(c) && !KNOWN_NO_CSS_CLASSES.has(c)) {
        warnCount++;
        problems.push(
          `[WARN] ${dom.name}: tpl ${path.basename(f)} 使用本域命名空间类 '${c}' 但在本 shadow 层无定义（疑似漏定义/死类，需人工确认）`,
        );
      }
    }
  }
  domainUsedClasses.set(dom.name, usedMap);
}

// ── 检查 6（WARN）：跨层存在性——用到、但**全仓任何 CSS 层都没定义**的类 ──
// 检查 3 的判定域是「本域命名空间」，故命名空间在本域不存在的类（错名 / 从未实现）结构上落在它的
// 盲区里。2026-09 实测该盲区 42 类：30 个 dlg-*/br-* 是 document 层对话框模板（components.css
// 服务，边界正确）、2 个完全内联样式、7 个 .lt-* 是真缺陷（色块空 span 恒不可见）、3 个
// .heatmap-bar-* 靠内联承载。本检查用**全局**口径补上对偶的另一半：类若在「所有 shadow 域 CSS ∪
// document 层 frontend/css/*.css」都无定义，就是「用了但哪儿都没定义」——错名断链的典型形态。
// 刻意不做 JS 引用启发式：实测对偶口径 naive 版报 617 条、真死 0（绝大多数是 classList 运行时类），
// 噪声换不到信号；合法无规则类一律经 KNOWN_NO_CSS_CLASSES 显式登记（逐类附理由）。
// 保守口径：document 层定义**不穿透 shadow 边界**，此处「定义过即放行」，宁漏勿误报。
const globalClassUniverse = new Set<string>();
for (const classes of domainCssClasses.values()) for (const c of classes) globalClassUniverse.add(c);
const documentLayerFiles = walk("frontend/css", {
  exts: [".css"],
  skipDir: () => false,
  skipFile: () => false,
}) as string[];
for (const f of documentLayerFiles) {
  for (const c of extractClasses(readSafe(f) ?? "")) globalClassUniverse.add(c);
}
for (const finding of findUndefinedAnywhereClasses(
  domainUsedClasses,
  globalClassUniverse,
  KNOWN_NO_CSS_CLASSES,
)) {
  warnCount++;
  problems.push(
    `[WARN] ${finding.domain}: tpl ${finding.file} 使用类 '${finding.cls}' 但全仓任何 CSS 层（shadow 域 ∪ frontend/css/*.css）均无定义（疑似错名/漏定义；若为内联承载的合法无规则类，登记 KNOWN_NO_CSS_CLASSES）`,
  );
}

// ── 检查 4：有动效的 shadow 域必须 adopt `.no-animations` 通配桥（ADR-015 §2.4 约束 1）──
// 依据「用户关闭时零动画」。`.no-animations` 类挂 documentElement，而文档层通配规则
// （variables.css 的 `.no-animations *`）**不穿透 Shadow 边界**——shadow 域不 adopt 桥，
// 开关在该域静默失效，且无任何编译期/构建期信号。
// 历史病灶（2026-09 核实）：文档层白名单曾登记 `.no-animations .menu / .toast / .sm-*`，
// 这些类住在 shadow 内部，选择器恒不匹配（死规则）；实测 app-toast（toastIn）、
// context-menu（menuPop/itemSlideIn）、app-sidebar（instance-card/sk-shimmer）、
// app-content（.cr-*/.stg-*/.recy-item/.gh-card/…）的动画都关不掉，而「所有动画都可关闭」
// 早已写进规范——白名单由此沦为假开关。本检查把该承诺变成可执行断言。
// 判定用**未展开的源文本**：桥以 `noAnimationsCSS` 标识符形式出现，而
// 展开（expandStyleInterpolations）会把它换成规则体、反而看不见该标识符——故本检查读原文。
for (const dom of [...SHADOW_DOMAINS, ...EXTRA_MOTION_DOMAINS]) {
  let srcAgg = "";
  for (const f of dom.css) srcAgg += `\n${readSafe(f) ?? ""}`;
  if (!hasMotionDeclaration(srcAgg)) continue;
  if (hasNoAnimationsBridge(srcAgg)) continue;
  errorCount++;
  problems.push(
    `[ERROR] ${dom.name}: shadow 域含 animation/transition 却未 adopt .no-animations 通配桥——「关闭动画」在本域静默失效（文档层规则不穿透 shadow 边界）。修法：在自身 shadow 样式串拼接 utils/dom/css.ts 的 noAnimationsCSS（勿逐类登记 :host-context 选择器，那正是漂移源）`,
  );
}

// ── 检查 5：shadow CSS 注释体内不得含 `*/`（提前闭合会吞掉紧随的规则）──
// CSS 注释按「首个 */ 闭合」解析。注释体里再写 `*/`（如 `fadeSlide*/breathe-subtle`）会让注释提前结束，
// 其后文本成为裸 CSS，被当作选择器、并吞掉紧随的第一个 `{...}` 块——2026 实测吞掉
// `@keyframes fadeSlideUp`，使 app-content 全 shadow 的入场动画（.stg-card/.settings-group/
// .setting-row/.gh-card/...）静默失效：无报错、`getComputedStyle().animationName` 仍显示名字，
// 但 `getAnimations()` 为 0（只有定义在破注释之前的 keyframe 仍能播）。判据：按首闭合语义剥注释后
// 不应再有游离 `*/`。
for (const dom of SHADOW_DOMAINS) {
  for (const f of dom.css) {
    const raw = readSafe(f) ?? "";
    const i = findStrayCommentClose(raw);
    if (i < 0) continue;
    errorCount++;
    problems.push(
      `[ERROR] ${dom.name}: ${f} 注释体内含 '*/'（星号+斜杠）会提前闭合注释，吞掉紧随的规则（曾致 @keyframes fadeSlideUp 静默失效 → 全 shadow 入场动画不播）。修法：改写注释里的该组合（如 'a*/b' → 'a* 与 b'）`,
    );
  }
}

// ── 输出 ──
if (problems.length === 0) {
  if (JSON_OUT) console.log(JSON.stringify({ _summary: { ok: true, errors: 0, warns: 0 } }));
  else console.log("[css-layer-check] ✅ 无 shadow 样式越界（keyframe 本地化 + 类归属正确）");
  process.exit(0);
}
if (JSON_OUT) {
  console.log(
    JSON.stringify({
      _summary: { ok: !(STRICT && errorCount > 0), errors: errorCount, warns: warnCount },
      problems,
    }),
  );
} else {
  console.log(`[css-layer-check] 发现 ${errorCount} 个 ERROR / ${warnCount} 个 WARN：`);
  for (const p of problems) console.log(`  ${p}`);
}
if (STRICT && errorCount > 0) {
  if (!JSON_OUT) console.log("[css-layer-check] --strict: ERROR 阻断（pre-push 门禁）");
  process.exit(1);
}
process.exit(0);
