/**
 * gate-coverage.ts — 门禁覆盖口径计算（「N/32 固定尾行」数据源）。
 *
 * 设计意图（2026-09-13 锐评 P2）：知识卡长期警示「门禁全绿 ≠ 仓库无风险」，但该警示
 * 只活在文档里，读者/AI 极易把 PASS 误读为安全。本模块把覆盖口径变成门禁输出的
 * **固定尾行**：每次跑都打「本次覆盖 x/M 项 check-*，未接入清单」，让诚实性约束
 * 从被动文档转为主动输出。
 *
 * 口径：
 *   全集   = scripts/check-*.ts（当前 32 个；动态枚举，新增脚本自动进入分母，
 *            防「写死 32 过期」——分母漂移本身就是需要被看见的信号）
 *   已覆盖 = gate-config 四张清单 + GO_STATIC_TOOLS + 域检查直连项（gate-blocks 内
 *            ctx.record 直接调用的 check-*，如 layering/redlines 等）
 *   未覆盖 = 全集 - 已覆盖（如 check-biome-lines / check-diff-coverage 等 pre-commit /
 *            doctor 旁路项），在尾行逐个点名
 *
 * 依赖：node:fs / node:path / _lib/scan-files.ts(ROOT) / _lib/gate-config.ts
 */
import fs from "node:fs";
import path from "node:path";
import { flattenGateTools } from "./gate-config.ts";
import { summarizeDebt } from "./gate-debt.ts";
import { ROOT } from "./scan-files.ts";

/**
 * 域检查直连（gate-blocks 内 ctx.record 调用、不走 gate-config 清单）的 check-* 脚本。
 * 手工常量（2026-09-13 锐评勘误 #9）：gate-blocks 新增直连 ctx.record("check-…") 时本数组
 * 不会自动更新 → 由 tests/test_gate_coverage.ts 双向扫描锁死（新增直连漏登记、或数组
 * 登记了已下线的检查，都会 FAIL），把「手工同步」升级为「测试网同步」。
 */
export const DOMAIN_BLOCK_CHECKS = [
  "check-layering.ts",
  "check-path-hygiene.ts",
  "check-mock-paths.ts",
  "check-menu-health.ts",
  "check-menu-test-layout.ts",
  "check-singleton-hygiene.ts",
  "check-worker-lifecycle.ts",
  "check-ctx-menu-i18n.ts",
  "check-binding-usage.ts",
  "check-redlines.ts",
  "check-knowledge-content.ts",
] as const;

/**
 * 全集：真实门禁清单条目 ∪ scripts/check-*.ts 动态枚举。
 *
 * 2026-10-08 口径修正（第三轮审计 P0）：原实现只 readdirSync 枚举 `check-*.ts`，
 * 于是清单里**真实在跑的非 check- 命名条目**（jscpd-go / auto-import / gen-* / i18n-check /
 * css-layer-check 等 12 条，经 `pre-push-gate --static` 在 CI 真跑）既不在分子也不在分母，
 * 尾行报「41/44 已接入」属**结构性低估**。分母改为「清单条目 + check-* 全集」：
 *   - 清单条目 → 只要接线就在册（不论命名）；
 *   - readdirSync 兜底 → 抓「写了脚本但从没接线」的漏网项（保留原设计意图：
 *     分母漂移本身是要被看见的信号）。
 */
export function listAllGateScripts(): string[] {
  const listed = new Set<string>();
  for (const tool of flattenGateTools()) {
    listed.add(tool.tool);
  }
  for (const c of DOMAIN_BLOCK_CHECKS) listed.add(c);
  // 存在性守卫：清单里登记但文件已删（摘除后漏清注释/清单）的条目会让分母虚高，
  // 且「接了线却跑不起来」本该是 FAIL 而非覆盖数——此处只统计真实存在的脚本。
  const present = new Set(
    fs.readdirSync(path.join(ROOT, "scripts")).filter((f) => f.endsWith(".ts")),
  );
  for (const f of listAllCheckScripts()) listed.add(f);
  return [...listed].filter((f) => present.has(f)).sort();
}

/** 全集：scripts/check-*.ts 动态枚举（文件名含 .ts 后缀） */
export function listAllCheckScripts(): string[] {
  return fs
    .readdirSync(path.join(ROOT, "scripts"))
    .filter((f) => /^check-.*\.ts$/.test(f))
    .sort();
}

/** 已覆盖集：清单 + 域直连的并集（取 basename，容忍清单写法差异） */
export function listCoveredCheckScripts(): Set<string> {
  const covered = new Set<string>();
  for (const tool of flattenGateTools()) {
    // 2026-10-08 口径修正（第三轮审计 P0）：此处原为 `if (tool.tool.startsWith("check-"))`，
    // 把清单里**真实在跑**的非 check-* 条目全部排除在分子之外（12 条：jscpd-go / auto-import /
    // event-graph / build-novel-index / gen-routes×2 / gen-cli-×2 / gen-knowledge-autogen /
    // i18n-check / i18n-ui-check / css-layer-check）。它们经 `pre-push-gate --static`（test.yml:253）
    // 真在 CI 跑，却因命名不进分子也不进分母 ⇒ 尾行的「N/M 已接入门禁」既低估覆盖面
    // （漏 12 项真闸）又高估剩余风险。
    // 本模块注释第 96-97 行早已把口径定义为「是否接入门禁」（与是否 check-* 命名无关），
    // 代码此前与自身声明的口径不一致；此处按声明修正。
    covered.add(tool.tool);
  }
  for (const c of DOMAIN_BLOCK_CHECKS) covered.add(c);
  return covered;
}

export interface GateCoverage {
  total: number;
  covered: number;
  uncovered: string[];
}

export function gateCoverage(): GateCoverage {
  const all = listAllGateScripts();
  const covered = listCoveredCheckScripts();
  return {
    total: all.length,
    covered: all.filter((f) => covered.has(f)).length,
    uncovered: all.filter((f) => !covered.has(f)),
  };
}

/**
 * 刻意旁路清单（ADR-234）：有自动化入口但**设计上不走 gate** 的 check-*——
 * check-biome-lines 是 pre-commit 行级硬阻断（gate 无行级语义）。
 * 与「漏接」分开点名，防 AI 读尾行把设计旁路当漏接去补接。新增旁路项时在此登记（无自动对账——
 * 分母动态枚举兜底漂移）。
 *
 * ⚠️ 2026-10-08 实测订正（第三轮审计 P2-5）：本注释原写「diff-coverage 走 CI/pre-commit」，
 * 系不准确的声称。实测：`check-diff-coverage.ts`（前端 Istanbul 口径）本地无
 * `frontend/coverage/coverage-final.json` 时**恒 exit 2**（「请先运行 vitest run --coverage」），
 * 且 `git grep` 确认它在 `.github/workflows/` 与 `.githooks/` 里**均无独立调用点**——
 * 即「有实现、有契约测试（test_check_diff_coverage.ts），但无任何自动执行入口」。
 * 真正的归宿是 CI 的「vitest --coverage 之后」且 checkout 须带基线 ref（test.yml:366 注记
 * 已说明覆盖率两件套不随 job 迁移的原因）；接线由 CI 覆盖率专项处理，勿在本地补接
 * （本地无产物会 rc=2 恒红 ⇒ 假阻断）。**旁路不等于假闸：这里的「旁路」是「暂未接线」，
 * 不是「设计上不需要」**——两者的处置完全不同（前者待接线，后者永久豁免）。
 * 注意（六锐评 P3 撤销留痕）：check-complexity/params/type-safety 三档扫描器**不属于**
 * 旁路——它们经 FRONTEND_STATIC_TOOLS 计入 covered（覆盖口径 = 「是否接入门禁」，
 * 与 --all 是否全量跑无关，push 模式 --files 裁剪运行已是合法接线形态）。
 */
export const BYPASS_CHECKS = [
  "check-biome-lines.ts",
  "check-diff-coverage.ts",
  // 2026-10-08 移除 check-go-coverage-threshold / check-twin-siblings：commit e9335003b
  // 「门禁清单对账补挂 3 个 ALL debt 检查」把二者接入 gate-config（GO/ALL，blockPolicy: debt）
  // → coveredSet 命中 → 旁路条目成幻影，test_gate_coverage 四锐评 #5 硬拦。check-twin-siblings
  // 原「刻意旁路（仅 commit-check 第 4 步）」注释随之过时：现一并走 pre-push 全量门禁。
] as const;

export interface GateBlockComposition {
  /** 真能阻断的工具数（按工具名去重；hard 优先）。 */
  hard: number;
  /** 记债不阻断的工具数（blockPolicy: debt，去重后）。 */
  debt: number;
  /** 其中复审截止日已过期的条目数（doctor --all 会红灯）。 */
  expired: number;
  /** 即将到期（≤ DUE_SOON_DAYS）的条目数。 */
  dueSoon: number;
  /** 最近到期的债（`<label>·<tool>`），无债时 null。 */
  nextLabel: string | null;
}

/**
 * 阻断构成（2026-10-09 审核体系锐评 · 到期制）。
 *
 * 动机：「清单 44 项已接入」会让人（与 AI）默认 44 道闸都在拦——实际按 blockPolicy 拆开后
 * 只有 hard 档拦，debt 档 FAIL 只记一笔（存量债账本 knip 185 / css-token 308 /
 * design-tokens 112 全是这一类）。尾行必须给出这个构成，否则「全绿」的语义仍然含糊：
 * 它可能意味着「没有新增债」，也可能意味着「16 项债集体沉默」。
 */
export function gateBlockComposition(now = Date.now()): GateBlockComposition {
  const tools = flattenGateTools();
  const hard = new Set<string>();
  for (const t of tools) if (t.blockPolicy !== "debt") hard.add(t.tool);
  const sum = summarizeDebt(tools, now);
  return {
    hard: hard.size,
    debt: sum.total,
    expired: sum.expired.length,
    dueSoon: sum.dueSoon.length,
    nextLabel: sum.next
      ? `${sum.next.tool} ${sum.next.status.reviewBy}（${
          sum.next.status.daysLeft < 0 ? `已逾期 ${-sum.next.status.daysLeft} 天` : `剩 ${sum.next.status.daysLeft} 天`
        }）`
      : null,
  };
}

/** 固定尾行文本（PASS/FAIL 两路共用，保证每次输出形态一致）。
 * @param now 判定「债是否过期」的时刻（默认当前；测试注入固定值以锁两路文案） */
export function coverageTailLine(now = Date.now()): string {
  const c = gateCoverage();
  const bypassed = c.uncovered.filter((f) => (BYPASS_CHECKS as readonly string[]).includes(f));
  const trulyUncovered = c.uncovered.filter(
    (f) => !(BYPASS_CHECKS as readonly string[]).includes(f),
  );
  const parts = [
    bypassed.length ? `刻意旁路(pre-commit/CI): ${bypassed.join(", ")}` : "",
    trulyUncovered.length ? `未接入: ${trulyUncovered.join(", ")}` : "",
  ].filter(Boolean);
  const detail = parts.length ? parts.join("；") : "全集全接入";
  // 阻断构成（2026-10-09 到期制）：覆盖数 != 拦截数，且 debt 不沉默——到期即点名。
  const comp = gateBlockComposition(now);
  const compHead = `阻断构成(${comp.hard + comp.debt} 项清单条目): hard ${comp.hard} / debt ${comp.debt}`;
  const debtPart = comp.expired
    ? `${compHead}（**debt 已逾期 ${comp.expired} 项**：doctor --all 红灯，须处置或续期）`
    : `${compHead}（debt FAIL 只记不拦${
        comp.nextLabel ? `；最近复审 ${comp.nextLabel}` : ""
      }）`;
  return `覆盖口径: ${c.covered}/${c.total} 项门禁清单条目已接入（含非 check-* 命名，如 jscpd-go/gen-*/auto-import；${detail}）—— ${debtPart} —— 全绿 ≠ 仓库无风险`;
}
