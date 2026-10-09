#!/usr/bin/env node
/**
 * 契约测试：scripts/debt-report.ts 的到期报告呈现层与接线。
 *
 * 背景（2026-10-09 审核体系锐评 · 到期制收口）：ADR-256-d1 的硬处置点在 `doctor --all`，
 * 但高频路径（CI）只看得到尾行一行字。debt-report 把到期状态变成 CI 汇总页的一页表——
 * **呈现物不是闸**：不进 gate-coverage 分母（非 check-* 命名是刻意的，本测试钉死），
 * CI 恒 exit 0（--strict 是留给手动收债用的）。本测试锁定：
 *   1. buildDebtReport 三档分组随注入时刻变化（在期→即将到期→逾期 全序列可复现）；
 *   2. 只含 debt 条目、hard 条目绝不混入（报告与阻断的边界）；
 *   3. 渲染三形态：文本分组不渲染空档 / markdown 表 + 逾期时表头点名 / json `_summary.ok`
 *      语义 = 无逾期；
 *   4. wiring：test.yml 的 debt-report 步骤存在、写 STEP_SUMMARY、且**不**传播退出码
 *      （报告若变闸 = 假红新源头，与汇总 job「不判定成败」同哲学）。
 *
 * 依赖：node:assert / node:fs / node:path / 被测模块 / _lib/scan-files。
 * 用法：node tests/test_debt_report.ts
 * 退出码：0 全绿；非 0 断言失败（check + finish 汇总裁决）。
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { buildDebtReport, renderMarkdown, renderText } from "../scripts/debt-report.ts";
import { listAllGateScripts } from "../scripts/_lib/gate-coverage.ts";
import { ROOT } from "../scripts/_lib/scan-files.ts";
import { check, finish } from "./_lib.mts";

const DAY = 86_400_000;

check("buildDebtReport：真实清单在三个注入时刻覆盖全部三档", () => {
  const base = new Date("2026-10-09T00:00:00Z").getTime();
  const now = buildDebtReport(base);
  assert.ok(now.total > 0, "真实清单应有 debt 条目");
  assert.strictEqual(now.expired.length, 0, "2026-10-09 视角：无逾期");
  assert.strictEqual(now.ok.length + now.dueSoon.length + now.expired.length, now.total);

  const soon = buildDebtReport(new Date("2026-11-01T00:00:00Z").getTime());
  assert.ok(soon.dueSoon.length > 0, "2026-11-01：LEDGER 档（11-08）应进入 ≤14 天窗口");
  assert.strictEqual(soon.expired.length, 0);

  const past = buildDebtReport(new Date("2026-11-20T00:00:00Z").getTime());
  assert.ok(past.expired.length > 0, "2026-11-20：两档复审日都已过 ⇒ 必须点名逾期");
  assert.strictEqual(past.dueSoon.length + past.ok.length, past.total - past.expired.length);
  // daysLeft 语义：逾期为负、升序 = 最逾期在前
  assert.ok(
    past.expired.every((r) => r.daysLeft < 0),
    "expired 组 daysLeft 必须全为负",
  );
  for (let i = 1; i < past.expired.length; i++)
    assert.ok(past.expired[i]!.daysLeft >= past.expired[i - 1]!.daysLeft, "expired 按紧迫度升序");
  void DAY;
});

check("只含 debt：hard 条目绝不混入报告（呈现与阻断的边界）", () => {
  const rep = buildDebtReport();
  const tools = new Set(rep.expired.concat(rep.dueSoon, rep.ok).map((r) => r.tool));
  assert.ok(tools.has("check-circular.ts"), "debt 条目必须在册");
  assert.ok(!tools.has("check-doc-drift.ts"), "hard 条目不得混入（它 FAIL 会阻断，不是债）");
  assert.ok(!tools.has("tsc"), "tsc（hard）不得混入");
  // 每条都带可操作信息：原因非空 + 合法日期
  for (const r of rep.ok.concat(rep.dueSoon, rep.expired)) {
    assert.ok(r.reason.trim().length >= 8, `${r.tool}: reason 必须可读懂`);
    assert.match(r.reviewBy, /^\d{4}-\d{2}-\d{2}$/);
  }
});

check("渲染：文本/markdown/json 三形态的分组与表头语义", () => {
  const now = buildDebtReport(new Date("2026-10-09T00:00:00Z").getTime());
  const textNow = renderText(now);
  assert.ok(!textNow.includes("已逾期"), "无逾期时文本不得渲染空的 🔴 小节（噪音）");
  assert.match(textNow, /🟢 在期/);

  const past = buildDebtReport(new Date("2026-12-01T00:00:00Z").getTime());
  assert.ok(past.expired.length > 0);
  const mdPast = renderMarkdown(past);
  assert.match(mdPast, /已逾期 \d+ 项/, "markdown 表头必须点名逾期数");
  assert.match(mdPast, /\| `check-circular\.ts` \| \*\*逾期 \d+ 天\*\*/, "逾期行必须加重点名");
  assert.match(mdPast, /doctor --all/, "必须指明硬处置地点（读者知道去哪解决）");
  const mdNow = renderMarkdown(now);
  assert.match(mdNow, /无逾期/);
  assert.match(mdNow, /最近复审：`[^`]+`（2026-11/, "在期视角也要报最近复审日（常态可见性）");
  assert.ok(!mdNow.includes("### 已逾期"), "无逾期时不渲染逾期小节");
});

check("非闸身份：debt-report 不进 gate-coverage 分母（命名是刻意的）", () => {
  const all = listAllGateScripts();
  assert.ok(
    !all.some((f) => f.includes("debt-report")),
    "debt-report 是呈现物不是闸——混进「N/M 已接入」分母会虚增门禁计数（本轮锐评数过的那笔口径债）",
  );
});

check("wiring：CI 有 debt-report 步、写 STEP_SUMMARY、且不传播退出码", () => {
  const yml = fs.readFileSync(path.join(ROOT, ".github", "workflows", "test.yml"), "utf8");
  assert.match(yml, /node scripts\/debt-report\.ts --md \| Out-File -FilePath \$env:GITHUB_STEP_SUMMARY/);
  assert.match(yml, /存量债到期报告[^\n]*非门禁/, "步骤名必须自述非门禁（读者与 AI 都不会把它当闸）");
  // 报告步不得带 --strict：CI 消费的是呈现，退出码若传播 = 假红新源头。
  // 切割锚用步骤 `- name:` 行本身（步骤说明注释里合法地提到 "--strict 只留手动收债"，
  // 若从注释处切会把说明文本误判为命令——判别式测试自身也要防文本匹配假红）。
  const stepBlock = yml.split("- name: 存量债到期报告")[1]?.split("- name:")[0] ?? "";
  assert.ok(stepBlock, "测试解析锚失效：CI 里找不到该步骤块（步骤改名会让本锚静默失去意义）");
  assert.doesNotMatch(stepBlock, /--strict/, "CI 报告步不传播退出码（--strict 只留手动收债）");
});

finish("test_debt_report.ts 全部断言通过");
