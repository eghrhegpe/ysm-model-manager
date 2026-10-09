#!/usr/bin/env node
/**
 * 契约测试：scripts/_lib/gate-debt.ts 的存量债到期制内核。
 *
 * 背景（2026-10-09 审核体系锐评 · 第一刀）：`blockPolicy: "debt"` 长期是第三种状态——
 * 没拦也没撤、只记一笔，于是棘轮账本（knip 185 / css-token 308 / design-tokens 112…）
 * 合法冻结，而体系对外的词是「全绿」。本测试锁定到期制的判定语义与边界：
 *   1. reviewBy 解析 fail-safe：非法格式 / 不存在的日期（2026-02-31 被 Date 静默滚动）
 *      → null，运行期当作「无债」而不抛错（门禁不该因元数据崩掉）
 *   2. 三态边界（以 UTC 日界判定，跨时区稳定）：>14 天 ok / 0~14 天 due-soon / <0 expired
 *   3. 文案单一事实源：label 必含 reviewBy 与剩余或逾期天数，逾期文案含「须处置或续期」
 *   4. 汇总去重口径：同一工具在多张清单重复声明只算一次，且取**最先出现**的声明
 *   5. 真实清单不变量：每条 debt 条目都必须能算出状态（= reviewBy 合法）；非债条目不得带 debt
 *
 * 依赖：node:assert / 被测模块 / _lib/gate-config（真实清单）。
 * 用法：node tests/test_gate_debt.ts（或经 _lib/contract-tests.ts 统一入口）。
 * 退出码：0 全绿；非 0 断言失败（check + finish 汇总裁决）。
 */
import assert from "node:assert";
import { flattenGateTools } from "../scripts/_lib/gate-config.ts";
import {
  debtNoteSuffix,
  debtStatus,
  DUE_SOON_DAYS,
  MAX_REVIEW_HORIZON_DAYS,
  parseDebtDate,
  recordDebtInventory,
  summarizeDebt,
} from "../scripts/_lib/gate-debt.ts";
import { check, finish } from "./_lib.mts";

/** 固定「今天」= 2026-10-09 UTC，使边界断言与运行时刻无关。 */
const NOW = Date.UTC(2026, 9, 9);
const DAY = 86_400_000;

check("parseDebtDate：合法格式解析为 UTC 日界，非法/伪日期一律 null", () => {
  assert.strictEqual(parseDebtDate("2026-11-08"), Date.UTC(2026, 10, 8));
  assert.strictEqual(parseDebtDate(" 2026-11-08 "), Date.UTC(2026, 10, 8), "容忍首尾空白");
  // 伪日期：2026-02-31 会被 Date 静默滚动到 3 月 3 日——必须由回读比对拦下
  assert.strictEqual(parseDebtDate("2026-02-31"), null);
  assert.strictEqual(parseDebtDate("2026-13-01"), null);
  assert.strictEqual(parseDebtDate("2026/11/08"), null);
  assert.strictEqual(parseDebtDate("26-11-08"), null);
  assert.strictEqual(parseDebtDate(""), null);
  assert.strictEqual(parseDebtDate(undefined), null);
});

check("debtStatus：三态边界（UTC 日界判定，跨时区稳定）", () => {
  const at = (reviewBy: string) => debtStatus({ reason: "r", reviewBy }, NOW)!;
  assert.strictEqual(at("2026-10-24").state, "ok", "15 天 > 阈值 → ok");
  assert.strictEqual(at("2026-10-24").daysLeft, 15);
  assert.strictEqual(at("2026-10-23").state, "due-soon", `恰 ${DUE_SOON_DAYS} 天 → due-soon（阈值含端点）`);
  assert.strictEqual(at("2026-10-09").state, "due-soon", "当天 → due-soon（最后决策窗口）");
  assert.strictEqual(at("2026-10-09").daysLeft, 0);
  assert.strictEqual(at("2026-10-08").state, "expired", "逾期 1 天 → expired");
  assert.strictEqual(at("2026-10-08").daysLeft, -1);
  // fail-safe：无债 / 非法 reviewBy → null（不抛错、不当成 ok，
  // 否则腐化的配置会静默变成「永久有效的债」）
  assert.strictEqual(debtStatus(undefined, NOW), null);
  assert.strictEqual(debtStatus(null, NOW), null);
  assert.strictEqual(debtStatus({ reason: "r", reviewBy: "9999" }, NOW), null);
});

check("debtNoteSuffix：文案是单一事实源（含期限与剩余/逾期天数）", () => {
  assert.strictEqual(debtNoteSuffix(null), "", "非债条目不得产生任何后缀");
  const okNote = debtNoteSuffix(debtStatus({ reason: "r", reviewBy: "2026-11-08" }, NOW));
  assert.match(okNote, /存量债/, "note 后缀必须点明「存量债」（区别于本次引入）");
  assert.match(okNote, /2026-11-08/, "必须带 reviewBy");
  assert.match(okNote, /剩 30 天/);
  const expNote = debtNoteSuffix(debtStatus({ reason: "r", reviewBy: "2026-10-01" }, NOW));
  assert.match(expNote, /已逾期 8 天/);
  assert.match(expNote, /须处置或续期/, "逾期文案必须给出行动词，不能只是一个状态");
});

check("summarizeDebt：去重取首条声明、排序、最近到期不限状态", () => {
  const entries = [
    { tool: "a", debt: { reason: "first", reviewBy: "2026-10-01" } },
    { tool: "b", debt: { reason: "r", reviewBy: "2026-11-08" } },
    { tool: "a", debt: { reason: "later", reviewBy: "2030-01-01" } }, // 重复工具：应被忽略
    { tool: "c" }, // 非债条目：不计入
    { tool: "d", debt: { reason: "bad", reviewBy: "not-a-date" } }, // 非法元数据：不计入
  ];
  const s = summarizeDebt(entries, NOW);
  assert.strictEqual(s.total, 2, "只有 a/b 是有效债（c 非债、d 元数据非法、a 重复）");
  assert.deepStrictEqual(
    s.expired.map((x) => x.tool),
    ["a"],
  );
  // 最近到期 = 全部债里 daysLeft 最小者，**不限状态**——逾期债最先被点名（它就是最紧迫的
  // 决策），未逾期债也会常态出现在尾行；否则可见性只存在于到期前 14 天（本轮锐评第①条）
  assert.strictEqual(s.next?.tool, "a", "next 取 daysLeft 最小者：已逾期的 a 比剩 30 天的 b 更紧迫");
  assert.strictEqual(s.next?.status.state, "expired");
  const allOk = summarizeDebt(
    [
      { tool: "a", debt: { reason: "r", reviewBy: "2026-11-08" } },
      { tool: "b", debt: { reason: "r", reviewBy: "2026-12-01" } },
    ],
    NOW,
  );
  assert.strictEqual(allOk.next?.tool, "a", "全部未逾期时 next 仍指向最近的一条（常态可见）");
  const onlyExpired = summarizeDebt([{ tool: "x", debt: { reason: "r", reviewBy: "2026-09-01" } }], NOW);
  assert.strictEqual(onlyExpired.next?.tool, "x", "只剩逾期债时 next 仍应指向它");
  assert.deepStrictEqual(summarizeDebt([], NOW), {
    total: 0,
    expired: [],
    dueSoon: [],
    next: null,
  });
});

check("真实清单：debt 条目必须可算出状态；非债条目不得带 debt 元数据", () => {
  const tools = flattenGateTools();
  const debtEntries = tools.filter((t) => t.blockPolicy === "debt");
  assert.ok(debtEntries.length > 0, "清单应至少有 1 条 debt（全 hard 反而说明口径可疑）");
  for (const e of debtEntries) {
    const st = debtStatus(e.debt, NOW);
    assert.ok(st, `${e.tool}: debt 条目的 reviewBy 必须可解析（当前 ${JSON.stringify(e.debt)}）`);
    assert.ok(
      (e.debt?.reason ?? "").trim().length >= 8,
      `${e.tool}: debt.reason 必须是有信息量的理由（≥8 字），禁无理由债务`,
    );
    // 视界上限：防「9999 年续期」把债变成永久豁免（续期必须周期性发生）
    const days = (parseDebtDate(e.debt!.reviewBy)! - NOW) / DAY;
    assert.ok(
      days <= MAX_REVIEW_HORIZON_DAYS,
      `${e.tool}: reviewBy 超出 ${MAX_REVIEW_HORIZON_DAYS} 天视界（${e.debt!.reviewBy}）——债不得无限期续期`,
    );
  }
  for (const e of tools) {
    if (e.blockPolicy !== "debt") {
      assert.strictEqual(
        (e as { debt?: unknown }).debt,
        undefined,
        `${e.tool}: 非债条目不应携带 debt 元数据（语义混淆）`,
      );
    }
  }
  console.log(`  ✓ 真实清单：${debtEntries.length} 条 debt 元数据齐备且未超视界`);
});

check("阻断归属唯一：同一工具不得同时被声明为 hard 与 debt", () => {
  const byTool = new Map<string, Set<string>>();
  for (const t of flattenGateTools()) {
    if (!byTool.has(t.tool)) byTool.set(t.tool, new Set());
    byTool.get(t.tool)!.add(t.blockPolicy);
  }
  for (const [tool, policies] of byTool) {
    assert.strictEqual(
      policies.size,
      1,
      `${tool}: 在多张清单里被声明为 ${[...policies].join("/")}——阻断归属必须唯一（尾行的 hard/debt 构成依赖它）`,
    );
  }
});

// ── 到期盘点（doctor --all 的接线内核）─────────────────────────────────────
// 这是「到期制」真正的执行点：判据三条（逾期 ⇒ hard / 未逾期 ⇒ 可见 / 无债 ⇒ 静默）
// 必须可单测——内联在 515 行的 main 里就只能靠整跑一次全量闸去观察，那正是旧病灶形态。
check("recordDebtInventory：逾期 ⇒ hard FAIL 点名；未逾期 ⇒ 报最近复审；无债 ⇒ 静默", () => {
  type Rec = { label: string; ok: boolean; opts?: Record<string, unknown> };
  const calls: Rec[] = [];
  const rec = (label: string, ok: boolean, opts?: Record<string, unknown>) =>
    calls.push({ label, ok, opts });

  // ① 有逾期 ⇒ 一条 hard FAIL（阻断 doctor --all），tail 逐条给出 reviewBy 与理由
  const exp = recordDebtInventory(
    rec,
    [
      { tool: "check-a.ts", debt: { reason: "存量 A", reviewBy: "2026-10-01" } },
      { tool: "check-b.ts", debt: { reason: "存量 B", reviewBy: "2026-12-01" } },
    ],
    NOW,
  );
  assert.deepStrictEqual(exp, { total: 2, expired: 1, recorded: true });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0]!.ok, false, "逾期必须记 FAIL");
  assert.strictEqual(calls[0]!.opts?.blockPolicy, "hard", "逾期必须 hard——否则又是一条永不阻断的闸");
  assert.match(String(calls[0]!.opts?.note), /已逾期 1 项/);
  assert.match(String(calls[0]!.opts?.tail), /check-a\.ts.*2026-10-01.*逾期 8 天.*存量 A/);

  // ② 未逾期 ⇒ 一条 OK，note 报出最近复审（可见性，不阻断）
  calls.length = 0;
  const fresh = recordDebtInventory(
    rec,
    [
      { tool: "check-a.ts", debt: { reason: "存量 A", reviewBy: "2026-11-08" } },
      { tool: "check-b.ts", debt: { reason: "存量 B", reviewBy: "2026-11-15" } },
    ],
    NOW,
  );
  assert.strictEqual(fresh.expired, 0);
  assert.strictEqual(calls[0]!.ok, true);
  assert.strictEqual(calls[0]!.opts?.blockPolicy, undefined, "未逾期不阻断，也不应标任何 blockPolicy");
  assert.match(String(calls[0]!.opts?.note), /无逾期；最近到期 check-a\.ts/);

  // ③ 无债（或全部元数据非法）⇒ 不写记录，不制造空噪音行
  calls.length = 0;
  assert.deepStrictEqual(recordDebtInventory(rec, [{ tool: "x.ts" }], NOW), {
    total: 0,
    expired: 0,
    recorded: false,
  });
  assert.strictEqual(calls.length, 0, "无债时不得写入记录");
});

check("真实清单 + 注入未来时刻：到期盘点必须转 hard（到期制的端到端假设）", () => {
  const calls: { ok: boolean; opts?: Record<string, unknown> }[] = [];
  const future = Date.UTC(2030, 0, 1);
  const r = recordDebtInventory(
    (_l, ok, opts) => calls.push({ ok, opts }),
    flattenGateTools(),
    future,
  );
  assert.ok(r.total > 0, "真实清单应有 debt 条目");
  assert.strictEqual(r.expired, r.total, "2030 年时全部债都应逾期（判据自身回归网）");
  assert.strictEqual(calls[0]!.ok, false);
  assert.strictEqual(calls[0]!.opts?.blockPolicy, "hard");
});

finish("test_gate_debt.ts 全部断言通过");
