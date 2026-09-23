#!/usr/bin/env node
/**
 * check-design-tokens.ts — 设计令牌守规度量闸（2026-09 立，只读报告型）。
 *
 * 依赖：node:fs / node:path / ./_lib/{design-tokens.ts, scan-files.ts, changed-scope.ts,
 *       parse-args.ts}；无外部工具依赖（纯文本扫描）。
 *
 * 为什么需要这个闸（补的是「横向统计盲区」）：
 *   `docs/UI-Design.md` 是项目唯一 UI 规范，明文写着「禁止硬编码
 *   font-size: Npx」「禁止硬编码 border-radius」「永远不做 color: #cdd6f4 之类的硬编码」。
 *   但**规范长期无机器守护**：立项时全仓扫描即发现硬编码字号/圆角/颜色与 emoji 图标
 *   合计数百处、涉数十个文件，而同一时刻 `var(--fs-*)` / `var(--radius-*)` 已大量合规——
 *   即「体系与野路子并存」，一半守规一半绕过。这比没规范更危险：切主题 / 调 --fs-scale
 *   时会出现「部分跟随、部分不跟随」的割裂，且因无度量而无人知晓债有多大。
 *
 *   ⚠️ 具体条数**刻意不在此写死**（ADR-162 去行号/去计数精神：数字会漂移且无人维护）。
 *   实况请跑 `node scripts/check-design-tokens.ts`，权威基线数见
 *   `scripts/baseline/design-tokens-baseline.json` 的 `count`。
 *
 *   历次三子代理锐评（架构/UIUX/3D）均未发现此项——a11y 是标准清单项，而
 *   「令牌失守」需要**跨文件横向统计**才能看见，不在任何单点审查的视野里。
 *
 * 检查项（均对应 UI-Design.md 明文规则，不自造规则）：
 *   [ERROR] font-size:Npx 硬编码（内联或 CSS 块）→ 应走 var(--fs-*)
 *   [ERROR] border-radius:Npx 硬编码            → 应走 var(--radius-*)
 *   [ERROR] padding:Npx 硬编码（内联或 CSS 块） → 应走 `--pad-*`/`--btn-padding-*`（2026-09 补）
 *   [ERROR] box-shadow 与某 --shadow-* 完全同值 → 应走 var(--shadow-*)（2026-09 补）
 *   [ERROR] transition 时长与某 --tr-* 相等     → 应走 var(--tr-*)（2026-09 补）
 *   [WARN]  硬编码颜色（内联或 CSS 块，中性色豁免）→ 应走语义色 token
 *   [WARN]  emoji 当图标                        → 应走 utils/icon 的 SVG 体系
 *
 * ⚠️ box-shadow / transition 两类口径**刻意极窄**：仅报「与令牌等价」的写法。
 *   非令牌阴影（焦点环 color-mix、比 --shadow-xl 更重的浮层阴影）是设计意图，
 *   报即噪声——详见 _lib/design-tokens.ts|SHADOW_TOKEN_VALUES 的注释。
 *   这两类补的是 UI-Design.md §7/§7.1 明文规则长期「有规范无断言」的漏网面。
 *
 * 输出亮点：**带令牌建议**。`font-size:13px` → 提示改用 `var(--fs-md)`；
 *   `border-radius:6px` → `var(--radius-md)`。建议只在「令牌基准 px 值与硬编码值精确
 *   相等」时给出（见 _lib/design-tokens.ts|suggestToken），宁可不说也不给错答案——
 *   实测 239 处（37%）有精确令牌对应，这类是零风险可修项，是收债的第一批目标。
 *
 * 用法：
 *   node scripts/check-design-tokens.ts                 # 全仓报告（默认只读，不阻断）
 *   node scripts/check-design-tokens.ts --strict        # 有 ERROR 时 exit 1（全库报告用）
 *   node scripts/check-design-tokens.ts --json          # JSON（CI / 子代理消费）
 *   node scripts/check-design-tokens.ts --files <换行分隔路径列表>  # 增量裁剪（文件级）
 *   node scripts/check-design-tokens.ts --changed       # 相对默认分支自动解析变更
 *   node scripts/check-design-tokens.ts --staged --added-lines       # 【门禁口径】只判本次提交的
 *                                                       新增行（ADR-256；pre-commit 硬阻断③）
 *   node scripts/check-design-tokens.ts --files <路径> --added-lines  # 同上，range 源（pre-push / CI；
 *                                                       base = 与默认分支的 merge-base）
 *   node scripts/check-design-tokens.ts --baseline --staged          # 旧口径（文件级 + 账本比对）：
 *                                                       仅作对照 / 存量盘点，已不挂门禁（ADR-256）
 *   node scripts/check-design-tokens.ts --baseline             # 全库 vs 账本（存量盘点）
 *   node scripts/check-design-tokens.ts --update-baseline      # 刷新账本（只许全库，带裁剪被拒）
 *   node scripts/check-design-tokens.ts --top 20        # 热点文件榜条数（默认 15）
 *   node scripts/check-design-tokens.ts --kind emoji-icon   # 只看某类
 *   node scripts/check-design-tokens.ts --json --list       # JSON 含全量明细（收债用）
 *   node scripts/check-design-tokens.ts --fix               # 自动令牌化（值等价，只动有精确建议的）
 *
 * 退出码：0 = 无 ERROR（或仅 WARN）；--strict 且有 ERROR → 1；
 *          --added-lines 且新增行有违规 → 1（只判新增行，存量债不拦）；
 *          --baseline 有新增 → 1；账本缺失/损坏 → 2（fail-closed）；
 *          --staged/--files 的 git 解析失败 / --added-lines 缺 diff 上下文或与 --baseline/--fix 混用 /
 *          --update-baseline 带裁剪 → 2（同为 fail-closed）。
 *
 * 逃生阀：YSM_SKIP_DESIGN_TOKENS=1。
 *
 * 门禁接线（2026-09，2026-09-16 改判行级 ADR-256）：pre-commit 挂 `--staged --added-lines`——
 *   判定域 = **本次提交的新增行**，内容取**提交侧 blob**（索引 `:path`，非磁盘）。
 *   为何弃用 `--baseline`（键 `file:line:kind`）：116 提交窗实测（scripts/token-shift-audit.ts --window 120），
 *   它报的 added 330 条里 **322 条（97.6%）是行位移幻影**（存量违规被挤到新行号），真新增候选仅 8；
 *   阻断视角 24 次里 19 次（79%）行级命中为 0。行级判定天然免疫位移，且不再依赖账本文件
 *   （少一类 fail-closed 失败面）。「同行替换同类」的键碰撞盲区是机制性风险（本窗口实测 0 次）。
 *   可复现：node scripts/token-shift-audit.ts --window 120
 *   钩子无需知道临时索引如何裁剪：git 已把 GIT_INDEX_FILE 交给钩子，`git diff --cached`
 *   天然只含本次提交文件；`--files` 路径走 range 源（pre-push / CI，base = merge-base）。
 *   第二重防线：`_lib/gate-config.ts` 的 FRONTEND_STATIC_TOOLS 同挂 `--added-lines`
 *   （堵住「`git commit --no-verify` 一条命令绕过」的单点）；ALL_STATIC_TOOLS 的 `--baseline`
 *   是**账本漂移报告**（全库 vs 账本），不再参与判定。
 *   账本：`--update-baseline` 只许全库刷新，债务只降不升（带任何裁剪会被 fail-closed 拒绝）。
 *
 * 设计意图：把「设计规范是否被执行」从人肉审查变成可度量、可增量收敛的机器信号。
 *   适用场景：UI 重构前的债务盘点、评审时量化「令牌失守」规模、按 --kind 分维度
 *   定位某一类债（如先清字号）、CI 出报告。与 css-layer-check（Shadow 样式越界）
 *   互补——后者管「样式定义在哪一层生效」，本脚本管「样式值是否走了令牌」。
 */
import fs from "node:fs";
import path from "node:path";
import {
  inChangedScope,
  partitionByUnstaged,
  resolveBaseRev,
  resolveChangedScope,
  resolveStagedScope,
  resolveUnstagedFiles,
} from "./_lib/changed-scope.ts";
import {
  checkLayoutDocDrift,
  type DesignViolation,
  type DesignViolationKind,
  findEmojiIconViolations,
  findLocaleEmojiPrefixViolations,
  findStyleAttrViolations,
  findToastEmojiPrefixViolations,
  findToastEmojiPrefixWindowViolations,
  findViolationsOnLines,
  fixLineTokens,
  hasGraphicEmoji,
  parseTokenMap,
} from "./_lib/design-tokens.ts";
import { addedLines, content, type DiffSource, renameMap } from "./_lib/diff-source.ts";
import { parseArgs } from "./_lib/parse-args.ts";
import { ROOT, readText, relPosix, walk, writeText } from "./_lib/scan-files.ts";

if (process.env.YSM_SKIP_DESIGN_TOKENS === "1") {
  console.log("[check-design-tokens] YSM_SKIP_DESIGN_TOKENS=1, 跳过");
  process.exit(0);
}

const args = parseArgs(process.argv.slice(2), {
  bools: [
    "strict",
    "json",
    "changed",
    "staged",
    "docs",
    "list",
    "fix",
    "baseline",
    "update-baseline",
    "added-lines",
  ],
  strings: ["files", "kind", "top"],
});
const STRICT = Boolean(args.strict);
const JSON_OUT = Boolean(args.json);
const DOCS_ONLY = Boolean(args.docs);
const LIST_ALL = Boolean(args.list);
const FIX_MODE = Boolean(args.fix);
const BASELINE_MODE = Boolean(args.baseline) || Boolean(args["update-baseline"]);
const UPDATE_BASELINE = Boolean(args["update-baseline"]);
const STAGED_MODE = Boolean(args.staged);
/** 行级判定（ADR-256）：只判本次变更的新增行，内容取提交侧 blob。 */
const ADDED_LINES = Boolean(args["added-lines"]);
const ONLY_KIND = (args.kind as string | null) || null;
const TOP_N = Number(args.top ?? 15) || 15;

/**
 * 基线文件（「只减不增」策略）。
 *
 * 为什么需要：存量债无法一次清完，但**新代码不该再欠**。基线记录当前债务集，
 * 门禁只拦「新增」违规——与 check-redlines / check-deadcode-baseline 同构。
 *
 * 键格式 `file:line:kind`：行号入键意味着**改动行会移动行号 → 该条被当作新增**。
 * 这对本闸是**刻意**的：若某行因编辑而位移，说明该行被人碰过，正好借机要求顺带令牌化
 * （与 check-biome-lines 的「行级增量」同一哲学：只对自己动过的行负责）。
 */
const BASELINE_FILE = path.join(ROOT, "scripts", "baseline", "design-tokens-baseline.json");

const log = (m: string) => {
  if (!JSON_OUT) console.log(m);
};
const jsonExit = (code: number, payload: unknown): never => {
  if (JSON_OUT) console.log(JSON.stringify(payload, null, 2));
  process.exit(code);
};

if (args.unknown.length > 0) {
  jsonExit(2, { _summary: { ok: false, error: `未知参数: ${args.unknown.join(", ")}` } });
}

// ── 扫描域解析：--files（门禁显式清单）> --staged（本次提交，pre-commit）>
//    --changed（本地）> 全库 ──
// 复用 _lib/changed-scope 的 fail-closed 语义（解析失败不得静默退回全库，
// 否则「本次变更」会被存量债淹没，同 gate-parse 第 4 条纪律）。
// ⚠️ --staged 的空域是**合法**的（本次提交不含本域文件）——与 --changed 的「空即失败」
// 刻意不同，见 changed-scope.ts|parseNameOnlySet 的对照注释。
const { scope, error: scopeError } =
  STAGED_MODE && !args.files
    ? resolveStagedScope()
    : resolveChangedScope(args.files, Boolean(args.changed));
if (scopeError) {
  jsonExit(2, { _summary: { ok: false, error: scopeError } });
}
const scopeFilter = args.files
  ? "files"
  : STAGED_MODE
    ? "staged"
    : args.changed
      ? "changed"
      : "all";

// ── --added-lines 的互斥与前置校验（fail-closed，防语义混淆）──
// 行级判定（ADR-256）与「基线比对」是两套哲学：前者不依赖基线，后者依赖全库账本。
// 混用会让「到底在判什么」不可读；--fix 改的是**磁盘**内容，与「只判提交 blob」更是南辕北辙。
if (ADDED_LINES && (BASELINE_MODE || FIX_MODE)) {
  const msg =
    "--added-lines 不能与 --baseline/--update-baseline/--fix 同用（行级判定不依赖基线；--fix 改的是磁盘内容，而本模式判提交 blob）";
  if (JSON_OUT) jsonExit(2, { _summary: { ok: false, error: msg } });
  console.error(`❌ ${msg}`);
  process.exit(2);
}
// 行级判定需要 diff 上下文（无上下文时只能全树扫描，那是另一个模式）
if (ADDED_LINES && scopeFilter === "all") {
  const msg =
    "--added-lines 需配合 --staged（pre-commit 暂存区）或 --files（pre-push / CI 变更集）——否则没有「本次变更」可判";
  if (JSON_OUT) jsonExit(2, { _summary: { ok: false, error: msg } });
  console.error(`❌ ${msg}`);
  process.exit(2);
}

// ── --update-baseline 只许全库刷新（防「重建基线洗债」）──
// 必须早于扫描与「空域早退」：基线是**全库**事实源，带任何裁剪写入的都是局部快照——此后
// --baseline 会把未入基线的存量债全部判成「新增」（既毁基线也毁门禁：把绕过的口子伪装成绿灯）。
// 放在此处的第二个理由：空域时脚本会提前 exit 0，闸若建在其后则「空域 + 裁剪」根本不被拦。
if (UPDATE_BASELINE && (scopeFilter !== "all" || ONLY_KIND)) {
  const narrowed = [
    scopeFilter !== "all" ? `scope=${scopeFilter}` : "",
    ONLY_KIND ? `--kind ${ONLY_KIND}` : "",
  ].filter(Boolean);
  const msg =
    `--update-baseline 只允许全库刷新（当前被裁剪：${narrowed.join(" / ")}）——` +
    "局部快照会让未入基线的存量债全部变「新增」。请去掉裁剪参数重跑。";
  if (JSON_OUT) jsonExit(2, { _summary: { ok: false, error: msg } });
  console.error(`❌ ${msg}`);
  process.exit(2);
}

// ── 令牌表：从 variables.css 解析（供 suggestToken 校验令牌真实存在）──
const VARIABLES_CSS = path.join(ROOT, "frontend/css/variables.css");
let tokenMap = parseTokenMap("");
try {
  tokenMap = parseTokenMap(readText(VARIABLES_CSS));
} catch (e) {
  // 令牌表缺失不致命：仅失去「建议」能力，判定仍可用。但必须显式告警，
  // 防「悄悄不提示建议」被误当成「没有可映射的令牌」。
  console.error(
    `[check-design-tokens] ⚠️  无法读取 ${relPosix(VARIABLES_CSS)}（${String(e)}）——令牌建议将不可用`,
  );
}

// ── --docs 模式：UI-Design.md 数值 vs 代码权威值 对账，然后退出 ──
// 与源码扫描分开（两者域不同：文档 vs 前端源码），故独立模式、独立退出。
if (DOCS_ONLY) {
  const docPath = path.join(ROOT, "docs/UI-Design.md");
  let docText = "";
  try {
    docText = readText(docPath);
  } catch (e) {
    jsonExit(2, { _summary: { ok: false, error: `无法读取 docs/UI-Design.md: ${String(e)}` } });
  }
  // 代码权威值：从布局模板取 `var(--preview-width,<fallback>)` 的实际 fallback
  let codeFallback: string | null = null;
  try {
    const tpl = readText(path.join(ROOT, "frontend/src/views/app-content/tpl.ts"));
    codeFallback = /var\(--preview-width\s*,\s*(\d+px)\)/.exec(tpl)?.[1] ?? null;
  } catch {
    /* 取不到则跳过该项对账（checkLayoutDocDrift 对 null 不误报） */
  }
  const drifts = checkLayoutDocDrift(docText, codeFallback);
  if (JSON_OUT) {
    jsonExit(STRICT && drifts.length > 0 ? 1 : 0, {
      _summary: { ok: drifts.length === 0, mode: "docs", drifts: drifts.length },
      drifts,
    });
  }
  console.log("══════════════════════════════════════════════════");
  console.log(" UI-Design.md 数值一致性 (check-design-tokens --docs)");
  console.log("══════════════════════════════════════════════════");
  console.log(`代码权威值 : --preview-width = ${codeFallback ?? "(未取到，跳过对账)"}`);
  if (drifts.length === 0) {
    console.log("✅ 文档数值与代码一致");
    process.exit(0);
  }
  for (const d of drifts) {
    console.log(`❌ ${d.topic}`);
    console.log(`   文档值   : ${d.docValues.join(" / ")}`);
    console.log(`   代码值   : ${d.codeValue ?? "(未知)"}`);
    console.log(`   ${d.detail}`);
  }
  console.log("\n修复：统一 docs/UI-Design.md 中的数值，使其与代码 fallback 一致。");
  if (STRICT) process.exit(1);
  process.exit(0);
}

// ── 扫描范围：前端生产 TS + 文档层 CSS（排除测试 / 构建产物 / vendor）──
const FRONTEND_SRC = path.join(ROOT, "frontend/src");
const FRONTEND_CSS = path.join(ROOT, "frontend/css");
let files = [
  ...(walk(FRONTEND_SRC, {
    exts: [".ts"],
    skipTest: true, // 测试文件里的样式样本不是产品 UI，误报源
    // ⚠️ 必须覆盖 walk 的默认 skipDir（默认会跳过**任何名为 css 的目录**）：
    // 本仓的样式常量恰恰住在 `views/app-content/css/`（content-creator/layout/gh/…）
    // ——那是设计令牌债最密集的地方。曾因沿用默认值而整目录漏扫（8 文件），
    // 导致报告数字系统性偏低、--fix 对该目录完全无效（实测发现）。
    // 此处只排除真正的构建产物/vendor，保留 `css` 目录。
    skipDir: (n: string) => n.startsWith(".") || n === "node_modules",
  }) as string[]),
  // [范围补齐 2026-09] 文档层 CSS（`frontend/css/*.css`，5 个手写样式表）此前**不在扫描域**：
  // 闸只 `walk(frontend/src, { exts: [".ts"] })`，于是文档层样式债从未被任何闸看过——
  // 实测 60 条（46 硬编码字号 + 13 圆角 + 1 过渡），其中 `components.css` 单文件 49 条。
  // 该目录平铺无子目录，故 skipDir 恒 false；exts 只认 .css（目录内本就只有 .css）。
  ...(walk(FRONTEND_CSS, {
    exts: [".css"],
    skipDir: () => false,
  }) as string[]),
]
  .map((abs) => ({ abs, rel: relPosix(abs) }))
  .filter((f) => inChangedScope(f.rel, scope));

// ── 未暂存编辑守卫（--staged 专用）：磁盘内容 ≠ 提交内容则跳过该文件 ──
// 扫描器读磁盘（下方 readText(f.abs)），而闸必须为「本次提交」负责：已 staged 又续改的文件
// （git status 的 MM）或并行会话改了同一文件时，判定对象与提交对象错位——行号位移会被
// --baseline 判成「新增」（误伤），内容差异又可能漏判。与 check-biome-lines.ts 的 filterClean
// 守卫同款（那里逐文件 git diff --quiet；此处一次 --name-only 拿全集，省 N 次 git 冷启）。
let unstagedSkipped: string[] = [];
// 绑定 `scopeFilter === "staged"` 而非 STAGED_MODE：`--files`（pre-push / CI 显式清单）优先时
// 判的是「已提交内容」，工作区脏是常态而非错位，不得因此弱化推送门禁。
// ⚠️ 再加 `!ADDED_LINES`：行级模式判的是**提交侧 blob**（index / HEAD），根本不读磁盘，
//    判定对象 == 提交对象 by construction——此时守卫不是保命而是**误伤**（会把该判的文件跳过）。
if (scopeFilter === "staged" && !ADDED_LINES) {
  const unstaged = resolveUnstagedFiles();
  if (unstaged === null) {
    // fail-closed：守卫失效不得静默放行（否则「磁盘≠提交」的错位判定无人知晓）
    const msg = "git diff --name-only 解析失败——无法确认「磁盘内容 = 提交内容」，--staged 守卫失效";
    if (JSON_OUT) jsonExit(2, { _summary: { ok: false, error: msg } });
    console.error(`❌ ${msg}`);
    process.exit(2);
  }
  const { clean, skipped } = partitionByUnstaged(
    files.map((f) => f.rel),
    unstaged,
  );
  unstagedSkipped = skipped;
  if (skipped.length > 0) {
    const keep = new Set(clean);
    files = files.filter((f) => keep.has(f.rel));
    for (const f of skipped) {
      // stderr：JSON 模式下 stdout 必须纯净（消费方直接 parse）
      console.error(`  ⚠️ ${f} 含未暂存编辑（磁盘内容 ≠ 本次提交内容），跳过设计令牌判定`);
    }
  }
}

if (files.length === 0) {
  if (unstagedSkipped.length > 0) {
    // 全被守卫跳过 ≠ 无违规：显式说明「本闸本次未判定」，避免被读成绿灯
    console.error(
      `[check-design-tokens] ⚠️  本次提交的 ${unstagedSkipped.length} 个本域文件均含未暂存编辑，已全部跳过——本闸本次未判定`,
    );
  }
  log(
    "[check-design-tokens] 扫描域内无文件（--files/--staged/--changed 裁剪后为空）——无违规可报 ✅",
  );
  jsonExit(0, {
    _summary: {
      ok: true,
      files: 0,
      scope: scopeFilter,
      reason: "empty-scope",
      unstagedSkipped: unstagedSkipped.length,
    },
  });
}

// ── 行级判定模式（--added-lines，ADR-256）：判定域 = 本次变更的**新增行**，内容取提交侧 blob ──
// 为什么取代「基线文件级」：键 `file:line:kind` 在 116 提交窗实测中，added 330 条里 322 条（97.6%）
// 是行位移幻影（存量违规被挤到新行号），真新增候选仅 8——阻断视角 24 次里 19 次行级命中为 0（可复现：
// node scripts/token-shift-audit.ts）。行级判定天然不需要基线，且只扫新增行（全树 → diff）。
if (ADDED_LINES) {
  const src: DiffSource = (() => {
    if (scopeFilter === "staged") return { kind: "index" } as DiffSource;
    const base = resolveBaseRev();
    if (!base) {
      const msg =
        "--added-lines 无法解析推送基线（git 不可用 / 找不到 origin/HEAD|origin/main|main|master）——" +
        "pre-commit 用 --staged，pre-push / CI 需先 fetch 默认分支";
      if (JSON_OUT) jsonExit(2, { _summary: { ok: false, error: msg } });
      console.error(`❌ ${msg}`);
      process.exit(2);
    }
    return { kind: "range", base, head: "HEAD" } as DiffSource;
  })();

  const renames = renameMap(src);
  if (renames === null) {
    const msg = "git diff --name-status 失败——无法解析改名配对，行级判定失败";
    if (JSON_OUT) jsonExit(2, { _summary: { ok: false, error: msg } });
    console.error(`❌ ${msg}`);
    process.exit(2);
  }

  const addedReports: FileReport[] = [];
  let addedLineTotal = 0;
  let addedViolationTotal = 0;
  for (const f of files) {
    const lines = addedLines(src, f.rel, renames.get(f.rel));
    if (lines === null) {
      const msg = `git diff 解析失败（${f.rel}）——无法判定本次变更的新增行`;
      if (JSON_OUT) jsonExit(2, { _summary: { ok: false, error: msg } });
      console.error(`❌ ${msg}`);
      process.exit(2);
    }
    if (lines.size === 0) continue; // 该文件在本次变更里没有新增行（纯删除 / 只改未跟踪）
    const text = content(src, f.rel);
    if (text === null) continue; // 该 revision 无此文件（改名残留 / 删除）
    addedLineTotal += lines.size;
    const isLocale = /\/locales\//.test(f.rel);
    const hits = findViolationsOnLines(text, lines, tokenMap, { locale: isLocale }).filter(
      (v) => !ONLY_KIND || v.kind === ONLY_KIND,
    );
    if (hits.length > 0) {
      addedReports.push({ rel: f.rel, violations: hits });
      addedViolationTotal += hits.length;
    }
  }
  addedReports.sort((a, b) => b.violations.length - a.violations.length);

  if (JSON_OUT) {
    jsonExit(addedViolationTotal > 0 ? 1 : 0, {
      _summary: {
        ok: addedViolationTotal === 0,
        mode: "added-lines",
        scope: scopeFilter,
        source: src.kind,
        files: files.length,
        filesWithViolations: addedReports.length,
        addedLines: addedLineTotal,
        violations: addedViolationTotal,
      },
      ...(LIST_ALL
        ? {
            violations: addedReports.flatMap((r) =>
              r.violations.map((v) => ({
                file: r.rel,
                line: v.line,
                kind: v.kind,
                suggestion: v.suggestion,
                snippet: v.snippet,
              })),
            ),
          }
        : {}),
      hotspots: addedReports.slice(0, TOP_N).map((r) => ({
        file: r.rel,
        count: r.violations.length,
        sample: r.violations.slice(0, 3).map((v) => ({
          line: v.line,
          kind: v.kind,
          suggestion: v.suggestion,
        })),
      })),
    });
  }

  console.log("══════════════════════════════════════════════════");
  console.log(" 设计令牌行级判定 (check-design-tokens --added-lines)");
  console.log("══════════════════════════════════════════════════");
  console.log(
    `判定域      : ${scopeFilter} / ${src.kind}（新增行 ${addedLineTotal} 行，覆盖 ${files.length} 文件）`,
  );
  console.log(`命中文件    : ${addedReports.length}`);
  console.log(`新增行违规  : ${addedViolationTotal}（存量债不拦——只对自己动过的行负责）`);
  if (addedViolationTotal === 0) {
    console.log("✅ 本次变更的新增行无设计令牌违规。");
    process.exit(0);
  }
  console.error(
    `\n❌ 本次变更新增 ${addedViolationTotal} 处设计令牌违规（行级判定，存量债不拦）：`,
  );
  for (const r of addedReports) {
    for (const v of r.violations) {
      console.error(
        `   ${r.rel}:${v.line}  ${v.kind}${v.suggestion ? ` → 建议 ${v.suggestion}` : ""}`,
      );
    }
  }
  console.error(
    "\n修复：硬编码字号/圆角改走 var(--fs-*)/var(--radius-*)（可跑 --fix 自动令牌化）；" +
      "emoji 图标改走 utils/icon 的 SVG 体系。",
  );
  process.exit(1);
}

// ── 逐文件逐行扫描 ──
interface FileReport {
  rel: string;
  violations: DesignViolation[];
}
const reports: FileReport[] = [];
const kindCounts: Record<string, number> = {};
const fixable = { total: 0, withSuggestion: 0 };
/** --fix 记账：改动文件数 / 替换处数 / 明细（按文件）。 */
const fixLog: Array<{ file: string; edits: Array<{ from: string; to: string }> }> = [];
let fixApplied = 0;

for (const f of files) {
  let text: string;
  try {
    text = readText(f.abs);
  } catch {
    continue; // 读取失败（权限/长路径）静默跳过，不炸整棵扫描（与 walk 容错口径一致）
  }
  const lines = text.split("\n");
  const violations: DesignViolation[] = [];
  const fileEdits: Array<{ from: string; to: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i] ?? "";
    // 快速预筛：五类特征都不含则跳过（大文件上省掉全部正则，实测占比 >95%）
    // ⚠️ [2026-09 补齐 / 2026-09-23 再补] 关键词表必须与**判定层实际支持的种类**同步：
    // 本表原只有 font-size / border-radius / color / background / style= / emoji —— 是 box-shadow
    // 与 transition 加入判定层**之前**写的，此后从未补。后果是**静默失明**：
    // `transition: opacity .4s` / `transition: top 0.15s ease` / 单独的 `box-shadow:`
    // 不含任何旧关键词，在预筛即被 skip，永远到不了判定函数（实测变量表的
    // `.skip-link { transition: top 0.15s ease }` 即因此漏报）。
    // 规律：**新增判定种类时，必须同步本表**——否则新判定形同虚设（且极难察觉，
    // 因为「能命中的那些」恰好含有 color/background 而显得正常）。
    // 2026-09-23（ADR-298 门禁勘误）：`toast:` 锚点关键词加入——多行 toast 载荷窗口的
    // 锚点行（`bus.emit("toast:show"`）本身不含 emoji，若无此关键词会在预筛被跳过，
    // 窗口检测器永远到不了（同型静默失明的第三次复发，故一并钉在这里）。
    if (
      !line.includes("style=") &&
      !line.includes("font-size") &&
      !line.includes("border-radius") &&
      !line.includes("color") &&
      !line.includes("background") &&
      !line.includes("transition") &&
      !line.includes("box-shadow") &&
      !line.includes("padding") &&
      !line.includes("toast:") &&
      !hasGraphicEmoji(line)
    ) {
      continue;
    }
    // ── --fix：先把可机械替换的令牌化（只动有精确建议的），再按替换后的文本复检 ──
    // 顺序很关键：先替换再扫描，扫描结果才反映「修复后的真实状态」，
    // 报告里剩下的才是真正需要人工的债（而非已修项继续刷屏）。
    if (FIX_MODE) {
      const fixed = fixLineTokens(line, tokenMap);
      if (fixed.edits.length > 0) {
        for (const e of fixed.edits) fileEdits.push({ from: e.from, to: e.to });
        fixApplied += fixed.edits.length;
        line = fixed.text;
        lines[i] = fixed.text; // 写回行数组，落盘时用
      }
    }
    const lineNo = i + 1;
    const hit = [
      ...findStyleAttrViolations(line, lineNo, tokenMap),
      ...findEmojiIconViolations(line, lineNo),
      ...findToastEmojiPrefixViolations(line, lineNo),
      // ADR-298 门禁勘误：多行 toast 载荷窗口（锚点行 + 后续 ≤4 行）
      ...findToastEmojiPrefixWindowViolations(lines, lineNo),
      ...(/\/locales\//.test(f.rel) ? findLocaleEmojiPrefixViolations(line, lineNo) : []),
    ];
    for (const v of hit) {
      if (ONLY_KIND && v.kind !== ONLY_KIND) continue;
      violations.push(v);
      kindCounts[v.kind] = (kindCounts[v.kind] ?? 0) + 1;
      fixable.total++;
      if (v.suggestion) fixable.withSuggestion++;
    }
  }
  // 落盘（保留原行尾风格，避免整文件 EOL 翻转噪音）
  if (FIX_MODE && fileEdits.length > 0) {
    writeText(f.abs, lines.join("\n"));
    fixLog.push({ file: f.rel, edits: fileEdits });
  }
  if (violations.length > 0) reports.push({ rel: f.rel, violations });
}

// ── 汇总 ──
reports.sort((a, b) => b.violations.length - a.violations.length);
const total = reports.reduce((n, r) => n + r.violations.length, 0);

// ERROR 类 = 明文「禁止」的硬编码字号/圆角/阴影/过渡时长；
// WARN 类 = 内联颜色 / emoji 图标（语义映射需人工判断，机器判不了）。
// css-shadow / css-transition 归 ERROR 的理由：与字号圆角同构——判定条件是「与令牌
// 完全同值」（见 _lib/design-tokens.ts|suggestShadowToken），即**等价替换**，
// 不存在语义猜测空间，故与 font-size/radius 同档。
const ERROR_KINDS: DesignViolationKind[] = [
  "inline-style-font-size",
  "inline-style-radius",
  "inline-style-padding",
  "css-font-size",
  "css-padding",
  "css-radius",
  "css-shadow",
  "css-transition",
];
const errorCount = ERROR_KINDS.reduce((n, k) => n + (kindCounts[k] ?? 0), 0);
const warnCount = total - errorCount;
// ── 基线比对（「只减不增」）：只拦本次新增违规，存量债放行 ──
const allViolationKeys: string[] = reports.flatMap((r) =>
  r.violations.map((v) => `${r.rel}:${v.line}:${v.kind}`),
);

if (BASELINE_MODE) {
  if (UPDATE_BASELINE) {
    // 去重后入盘：一行可含同类多处违规（如同一行两个 emoji，或压缩成单行的
    // components-styles.ts 一行十个 transition），键相同 → Set 收敛。
    // count 必须报**去重后**的数量，否则基线自称 N、比对时报 M<N，会被误读成
    // 「有若干条违规凭空消失」（实测踩过，查了一遍才发现是重复键而非漏检）。
    const uniqueKeys = [...new Set(allViolationKeys)].sort();
    fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
    fs.writeFileSync(
      BASELINE_FILE,
      `${JSON.stringify(
        {
          generated: new Date().toISOString(),
          count: uniqueKeys.length,
          note: "设计令牌存量债账本（ADR-256：已不参与门禁判定，只供 doctor 报告 / 收债排期）；清理后重跑 --update-baseline 收缩",
          violations: uniqueKeys,
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );
    if (JSON_OUT) {
      jsonExit(0, {
        _summary: { ok: true, mode: "update-baseline", count: uniqueKeys.length },
      });
    }
    console.log(`✅ 已写入设计令牌基线：${uniqueKeys.length} 条 → ${relPosix(BASELINE_FILE)}`);
    process.exit(0);
  }

  // fail-closed：基线缺失不得当「零违规」放行（同 check-redlines/check-deadcode 纪律）
  if (!fs.existsSync(BASELINE_FILE)) {
    const msg = `基线不存在（${relPosix(BASELINE_FILE)}）——无法比对新增违规。请先运行 node scripts/check-design-tokens.ts --update-baseline 建立基线`;
    if (JSON_OUT) jsonExit(2, { _summary: { ok: false, error: msg } });
    console.error(`❌ ${msg}`);
    process.exit(2);
  }
  let baseSet: Set<string>;
  try {
    const base = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf-8")) as { violations?: string[] };
    baseSet = new Set(base.violations ?? []);
  } catch (e) {
    const msg = `基线损坏（${relPosix(BASELINE_FILE)}）：${String(e)}——删除后重跑 --update-baseline`;
    if (JSON_OUT) jsonExit(2, { _summary: { ok: false, error: msg } });
    console.error(`❌ ${msg}`);
    process.exit(2);
  }
  const currentSet = new Set(allViolationKeys);
  const added = allViolationKeys.filter((k) => !baseSet.has(k));
  const gone = [...baseSet].filter((k) => !currentSet.has(k));

  if (JSON_OUT) {
    jsonExit(added.length > 0 ? 1 : 0, {
      _summary: {
        ok: added.length === 0,
        mode: "baseline",
        // 判定域自证（门禁域透明度）：'staged' = 本次提交文件（pre-commit）；'all' = 磁盘全树（--all/CI）。
        scope: scopeFilter,
        current: currentSet.size,
        baseline: baseSet.size,
        added: added.length,
        gone: gone.length,
        // --staged 守卫跳过数（磁盘≠提交）：>0 说明部分文件本次未判定，供消费方审计
        unstagedSkipped: unstagedSkipped.length,
      },
      added,
      gone,
    });
  }
  console.log("");
  console.log(`基线比对：当前 ${currentSet.size} / 基线 ${baseSet.size}`);
  console.log(`新增违规：${added.length}    已清理：${gone.length}`);
  if (gone.length > 0 && added.length === 0) {
    console.log(
      `ℹ 债务减少 ${gone.length} 条——建议 node scripts/check-design-tokens.ts --update-baseline 收缩基线`,
    );
  }
  if (added.length > 0) {
    console.error(`\n❌ 本次新增 ${added.length} 处设计令牌违规（存量债不拦）：`);
    for (const k of added.slice(0, 20)) console.error(`   ${k}`);
    if (added.length > 20) console.error(`   … 其余 ${added.length - 20} 条（--json 全量）`);
    console.error(
      "\n修复：硬编码字号/圆角改走 var(--fs-*)/var(--radius-*)（可跑 --fix 自动令牌化）；",
    );
    console.error("      emoji 图标改走 utils/icon 的 SVG 体系。");
    process.exit(1);
  }
  console.log("✅ 无新增设计令牌违规。");
  process.exit(0);
}

const KIND_LABEL: Record<string, string> = {
  "inline-style-font-size": "内联硬编码字号",
  "inline-style-radius": "内联硬编码圆角",
  "inline-style-padding": "内联硬编码 padding",
  "inline-style-color": "内联硬编码颜色",
  "css-font-size": "CSS 块硬编码字号",
  "css-radius": "CSS 块硬编码圆角",
  "css-padding": "CSS 块硬编码 padding",
  "css-color": "CSS 块硬编码颜色",
  "css-shadow": "硬编码阴影（同 --shadow-* 值）",
  "css-transition": "硬编码过渡时长",
  "emoji-icon": "emoji 当图标",
  "toast-emoji-prefix": "toast 载荷前缀状态 emoji",
  "locale-emoji-prefix": "locale 值前缀状态 emoji",
};

if (JSON_OUT) {
  jsonExit(STRICT && errorCount > 0 ? 1 : 0, {
    _summary: {
      ok: !(STRICT && errorCount > 0),
      scope: scopeFilter,
      files: files.length,
      filesWithViolations: reports.length,
      total,
      errors: errorCount,
      warnings: warnCount,
      /** 可直接按建议替换的数量（零风险可修项） */
      autoFixable: fixable.withSuggestion,
    },
    byKind: kindCounts,
    // --fix 记账（供调用方审计「改了什么」）
    ...(FIX_MODE
      ? {
          fix: {
            applied: fixApplied,
            files: fixLog.length,
            detail: fixLog.map((l) => ({
              file: l.file,
              count: l.edits.length,
              edits: l.edits,
            })),
          },
        }
      : {}),
    // --list：全量明细（默认只给 Top-N 热点 + 样本，收债时需要逐条清单）。
    // 放在 JSON 里而非独立格式，便于消费方 jq/node 过滤（如只取有建议的）。
    ...(LIST_ALL
      ? {
          violations: reports.flatMap((r) =>
            r.violations.map((v) => ({
              file: r.rel,
              line: v.line,
              kind: v.kind,
              suggestion: v.suggestion,
              snippet: v.snippet,
            })),
          ),
        }
      : {}),
    hotspots: reports.slice(0, TOP_N).map((r) => ({
      file: r.rel,
      count: r.violations.length,
      sample: r.violations.slice(0, 3).map((v) => ({
        line: v.line,
        kind: v.kind,
        suggestion: v.suggestion,
      })),
    })),
  });
}

// ── 人类可读报告 ──
console.log("══════════════════════════════════════════════════");
console.log(" 设计令牌守规 (check-design-tokens)");
console.log("══════════════════════════════════════════════════");
console.log(`扫描域      : ${scopeFilter}（${files.length} 文件）`);
console.log(`命中文件    : ${reports.length}`);
console.log(`违规总数    : ${total}  （ERROR ${errorCount} / WARN ${warnCount}）`);
console.log(
  `可建议替换  : ${fixable.withSuggestion} 处（${((fixable.withSuggestion / (total || 1)) * 100).toFixed(0)}% 有精确令牌对应）`,
);
console.log("──────────────────────────────────────────────────");
for (const [k, n] of Object.entries(kindCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${(KIND_LABEL[k] ?? k).padEnd(18)} ${String(n).padStart(5)}`);
}
console.log("──────────────────────────────────────────────────");
console.log(`热点文件 Top ${TOP_N}：`);
for (const r of reports.slice(0, TOP_N)) {
  console.log(`  ${String(r.violations.length).padStart(4)}  ${r.rel}`);
  // 展示前 2 条带建议的（可操作性最强的信号）
  for (const v of r.violations.filter((x) => x.suggestion).slice(0, 2)) {
    console.log(`        :${v.line}  ${v.kind} → 建议 ${v.suggestion}`);
  }
}
console.log("──────────────────────────────────────────────────");
console.log("规则来源：docs/UI-Design.md（禁止硬编码 font-size / border-radius / 颜色；");
console.log("          emoji 图标应走 utils/icon 的 SVG 体系以保证跨平台与主题一致）");

if (FIX_MODE) {
  console.log("──────────────────────────────────────────────────");
  if (fixApplied === 0) {
    console.log("🔧 --fix：无可机械替换项（无精确令牌对应，或均已令牌化）");
  } else {
    console.log(
      `🔧 --fix：已替换 ${fixApplied} 处（${fixLog.length} 文件）——值等价，附加收益=跟随 --fs-scale`,
    );
    for (const l of fixLog) {
      console.log(`   ${String(l.edits.length).padStart(4)}  ${l.file}`);
      for (const e of l.edits.slice(0, 3)) console.log(`          ${e.from} → ${e.to}`);
      if (l.edits.length > 3) console.log(`          … 其余 ${l.edits.length - 3} 处`);
    }
    console.log("   请跑：cd frontend && npx vite build && npm run typecheck && npx vitest --run");
  }
  console.log("   提示：颜色**有意不自动替换**（语义令牌需人工判定，机械猜测会给错答案）");
} else {
  console.log(
    "说明：本闸已接门禁（pre-commit 挂 --staged --added-lines，ADR-256 行级判定）——上表为**全库存量债**盘点，" +
      "存量债不拦（只判本次提交的新增行，自己动过的行才负责）。",
  );
  if (fixable.withSuggestion > 0) {
    console.log(
      `     可用 --fix 自动令牌化其中 ${fixable.withSuggestion} 处（值等价，附跟随 --fs-scale 收益）`,
    );
  }
}

if (STRICT && errorCount > 0) {
  console.error(`\n❌ --strict：存在 ${errorCount} 处 ERROR 级设计令牌违规。`);
  process.exit(1);
}
