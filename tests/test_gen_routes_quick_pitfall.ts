#!/usr/bin/env node
/**
 * test_gen_routes_quick_pitfall.ts — 速查表 pitfall 列切分契约（scripts/gen-routes-quick.ts）。
 *
 * parsePitfall 把知识卡 frontmatter 的 `pitfalls` 行（约定 "「位置」描述 → 正确做法"）
 * 拆成 routes-quick 的三列（陷阱 / 位置 / 正确做法）。该函数此前零测试覆盖，两条
 * **静默截断**缺陷长期存活（2026-09-13 修复，本测试即回归锁）：
 *   ① 无条件剥离首个 inline code span → pos 取自「」时把正文首个 code 一并吃掉
 *      （全库 9 条 pitfall 实证：`--new-from-rev` / `Promise.race` / `3d-skin/<子名>` 丢失）；
 *   ② 箭头只认 " → "（两侧空格）→ `「位置」→ 修复`（无空格）写法整体落入陷阱列、
 *      「正确做法」列退化为 "-"（golangci-lint 卡 6 条实证）。
 *
 * 另锁 excessRiskLines：quick_risk_lines 超出 quick_intents 条数时被渲染静默丢弃，
 * 该函数把「被丢弃的行」显性返回供 WARN——内容丢失不得无声（同 2026-08-31 配对不均纪律）。
 *
 * 运行：node tests/test_gen_routes_quick_pitfall.ts（失败 exit 1；契约 runner 收集）。
 */
import assert from "node:assert/strict";
import { excessRiskLines, parsePitfall } from "../scripts/gen-routes-quick.ts";

// ─── 1) 常规写法：「位置」描述 → 正确做法 ────────────────────
{
  const p = parsePitfall("「门禁全绿」只证明清单内检查通过 → 须附覆盖率报告");
  assert.equal(p.pos, "`门禁全绿`", "「」内容进位置列");
  assert.equal(p.trap, "只证明清单内检查通过", "「」后的描述进陷阱列");
  assert.equal(p.fix, "须附覆盖率报告", "箭头后的内容进正确做法列");
}

// ─── 2) 缺陷① 回归锁：pos 取自「」时不得吞掉正文 inline code ─
{
  const p = parsePitfall("「门禁全绿」须报 `--all` / `--docs` 覆盖率 → 报告 N/32");
  assert.ok(p.trap.includes("`--all`"), `陷阱列须保留首个 inline code，实际=${p.trap}`);
  assert.ok(p.trap.includes("`--docs`"), "陷阱列须保留后续 inline code");
  assert.equal(p.pos, "`门禁全绿`", "位置列仍取「」内容");
  assert.equal(p.fix, "报告 N/32", "正确做法列不受影响");
}
// 对照：pos 本身取自 code span 时才剥离该 span（否则位置列与陷阱列重复）
{
  const p = parsePitfall("`parsePitfall` 无条件剥离 code → 仅 pos 取自 code 时剥离");
  assert.equal(p.pos, "`parsePitfall`", "位置列取首个 code span");
  assert.ok(!p.trap.includes("`parsePitfall`"), "陷阱列应剥掉作为位置的 code span");
  assert.equal(p.trap, "无条件剥离 code", "陷阱列保留剩余描述");
}

// ─── 3) 缺陷② 回归锁：「位置」→ 修复（无空格箭头） ──────────
{
  const p = parsePitfall("「全量跑会撞 736 条存量债」→ 门禁只能跑 `--new-from-rev`");
  assert.equal(p.pos, "`全量跑会撞 736 条存量债`", "位置列取「」内容");
  assert.equal(p.trap, "全量跑会撞 736 条存量债", "陷阱列以位置回填（left 无剩余描述）");
  assert.equal(p.fix, "门禁只能跑 `--new-from-rev`", "无空格箭头也须切出正确做法列");
  assert.ok(!p.fix.startsWith("→"), "正确做法列不得残留箭头前缀");
}

// ─── 4) 不切入点：「位置」短语自身含箭头（如「标签→控件」） ──
{
  const p = parsePitfall("「标签→控件」14 处未合规 → 必须 label-for");
  assert.equal(p.pos, "`标签→控件`", "位置短语内的箭头不得作为切分点");
  assert.equal(p.trap, "14 处未合规", "陷阱列保留「」后的描述");
  assert.equal(p.fix, "必须 label-for", "正确做法列正常切出");
}

// ─── 5) 无箭头：整段进陷阱列，正确做法列退化为 "-" ──────────
{
  const p = parsePitfall("「零引用 ≠ 该归档」须先查 git 历史与 ADR");
  assert.equal(p.pos, "`零引用 ≠ 该归档`", "位置列仍取「」内容");
  assert.equal(p.trap, "须先查 git 历史与 ADR", "无箭头时整段作陷阱描述");
  assert.equal(p.fix, "-", "无箭头 → 正确做法列填 -");
}

// ─── 6) 兜底：left 剥空时陷阱列回填位置（不得输出空串） ─────
{
  const p = parsePitfall("「薄包装误报」");
  assert.equal(p.trap, "薄包装误报", "陷阱列空时回填位置，不得为空串");
  assert.equal(p.fix, "-", "无箭头 → 正确做法列填 -");
}

// ─── 7) excessRiskLines：风险行超配显性化（不得静默丢弃） ────
{
  assert.deepEqual(
    excessRiskLines(["红线1", "红线2", "红线3"], ["意图1", "意图2"]),
    ["红线3"],
    "风险行超出意图条数 → 显性返回被丢弃行（供 WARN）",
  );
  assert.deepEqual(excessRiskLines(["红线1", "红线2"], ["意图1", "意图2"]), [], "风险行数与意图相等 → 无丢弃");
  assert.deepEqual(excessRiskLines(["红线1"], ["意图1", "意图2", "意图3"]), [], "风险行少于意图 → 无丢弃（缺红线由渲染兜底填 -）");
  assert.deepEqual(excessRiskLines([], ["意图1"]), [], "无风险行 → 无丢弃");
  assert.deepEqual(excessRiskLines([], []), [], "双双为空 → 无丢弃");
}

console.log("✅ test_gen_routes_quick_pitfall.ts 全部通过（7 组契约断言）");
