#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { finish, ok, runScript } from "./_lib.mts";
import { findLingeringProgressLines } from "../scripts/check-adr-health.ts";

// test_adr_lingering_progress — ADR ②「决策未定含进度化石」判定 + hard 闸契约（2026-10-10 A1 升档）。
// 背景：原 PROGRESS_RE（进度|排期|化石|待办|TODO|未落地|仍在进行|尚未完成|下一步|后续|计划）把
// 「后续/计划」等决策散文弱描述词与「知识卡实施进度」指针行误伤为化石——实测 21 条里 20 条是启发式
// 误伤。收紧后（强待办词 + 行级「知识卡/实施状态/状态快照」指针豁免）② 只捕真化石，并升 hard：
// 默认运行 errors 阻断、--suggest 命中即退出码 1。本测试钉死分类函数 + 仓内不变量 + 退出码语义。

const HERMETIC: { name: string; body: string; expect: number }[] = [
  { name: "强待办词「未落地」→ 命中", body: "P2 注释考古化（D6 未落地）\n", expect: 1 },
  { name: "「知识卡实施进度」指针行 → 豁免", body: "评估以当前源码树 + 知识卡实施进度为准\n", expect: 0 },
  { name: "「状态快照」注释 → 豁免", body: "<!-- 本节是决策当时的状态快照 -->\n", expect: 0 },
  { name: "弱描述词「后续」→ 不命中", body: "下载拦截后续迭代。\n", expect: 0 },
  { name: "弱描述词「计划」→ 不命中", body: "三档重构计划：\n", expect: 0 },
  { name: "强待办词「待办」→ 命中", body: "待办事项：X。\n", expect: 1 },
  { name: "「实施状态」指针行 → 豁免", body: "- **实施状态**：查知识卡（ADR 只记决策方向）\n", expect: 0 },
  { name: "强待办词「排期」→ 命中", body: "收尾排期：还差 X。\n", expect: 1 },
];

console.log("=== ADR ② 进度化石判定契约（test_adr_lingering_progress）===");
for (const c of HERMETIC) {
  const hits = findLingeringProgressLines(c.body);
  ok(c.name, hits.length === c.expect, `期望 ${c.expect} 命中，实际 ${hits.length}: ${JSON.stringify(hits)}`);
}

// 仓内不变量：决策未定 ADR 无真化石（②=0），且 --suggest 无化石时退出码 0。
const r = runScript("check-adr-health.ts", "--suggest", "--json");
const out = (r.stdout ? JSON.parse(r.stdout) : { lingeringProgress: [] }) as { lingeringProgress: { id: string }[] };
ok("仓内 ②=0（决策未定 ADR 无进度化石）", out.lingeringProgress.length === 0, `lingering=${JSON.stringify(out.lingeringProgress)}`);
ok("--suggest 无化石 → 退出码 0", r.status === 0, `status=${r.status}`);

// hard 语义：注入临时含化石的提议中 ADR → --suggest 退出码 1 且点名；测完即删（try/finally 兜底）。
const TMP_ADR = path.join(process.cwd(), "docs", "adr", "ADR-999-zzz-fossil-contract.md");
const TMP_BODY = [
  "# ADR-999：临时化石契约测试",
  "",
  "- **状态**：📝 提议中",
  "- **日期**：2026-10-10",
  "- **决策人**：契约测试",
  "",
  "待办：临时测试化石。",
  "",
].join("\n");
try {
  fs.writeFileSync(TMP_ADR, TMP_BODY, "utf8");
  const r2 = runScript("check-adr-health.ts", "--suggest", "--json");
  const out2 = (r2.stdout ? JSON.parse(r2.stdout) : { lingeringProgress: [] }) as {
    lingeringProgress: { id: string }[];
  };
  ok(
    "临时化石 ADR 被 ② 点名",
    out2.lingeringProgress.some((p) => p.id === "ADR-999"),
    `lingering=${JSON.stringify(out2.lingeringProgress)}`,
  );
  ok("--suggest 命中化石 → 退出码 1（hard 语义）", r2.status === 1, `status=${r2.status}`);
} finally {
  if (fs.existsSync(TMP_ADR)) fs.rmSync(TMP_ADR, { force: true });
}

finish("ADR ② 进度化石判定契约全过");
