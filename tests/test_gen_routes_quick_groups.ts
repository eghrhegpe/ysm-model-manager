#!/usr/bin/env node
/**
 * test_gen_routes_quick_groups.ts — 路由表分组封闭词表契约（scripts/gen-routes-quick.ts +
 * scripts/_lib/knowledge-cards.ts）。
 *
 * 背景：quick_groups 原是每卡自由文本，80 个野生组名里 69 个只挂 1 张卡（近重复名成堆：
 * 3D×4 / 后端桥接×3 / 门禁×3），routes-quick 浏览式检索失效。2026-10-05 治理后
 * quick_groups 成为受控词表（QUICK_GROUPS，14 组），本测试锁四条不变量：
 *   ① 词表非空、无重复；
 *   ② 渲染分组序 = 词表序（高频域在前），不再是首现序；
 *   ③ 词表外组名并入「未归类」桶且置尾 + 恒 WARN（fail-visible，野生组名不得安静地
 *      多长一个分组标题）；
 *   ④ 多规范组卡的意图↔分组循环配对语义不受治理影响。
 * 运行：node tests/test_gen_routes_quick_groups.ts（失败 exit 1；契约 runner 收集）。
 */
import assert from "node:assert/strict";
import { QUICK_GROUPS } from "../scripts/_lib/knowledge-cards.ts";
import { render, UNCLASSIFIED_GROUP } from "../scripts/gen-routes-quick.ts";

function card(file: string, groups: string[], intents: string[]) {
  return { file, name: file, groups, intents, risks: [], adr: "-", pitfalls: [] };
}

// ─── 1) 词表形状：非空、规模收敛、无重复 ─────────────────────
{
  const size = QUICK_GROUPS.length;
  assert.ok(size >= 10 && size <= 20, `词表规模应收敛在 10~20 组，实际 ${size}`);
  assert.equal(new Set(QUICK_GROUPS).size, size, "词表不得有重复组名");
}

// ─── 2) 渲染分组序 = QUICK_GROUPS 词表序 ─────────────────────
{
  const out = render([
    card("b.md", ["门禁与脚本"], ["x"]),
    card("a.md", ["3D 预览与模型追加"], ["y"]),
  ]);
  const i3d = out.indexOf(`## 🎯 3D 预览与模型追加`);
  const iGate = out.indexOf(`## 🎯 门禁与脚本`);
  assert.ok(i3d !== -1 && iGate !== -1, "两个规范组都应渲染");
  assert.ok(
    i3d < iGate,
    "分组序须按 QUICK_GROUPS 词表序（3D 排在前、门禁排在后），不再是卡片首现序",
  );
}

// ─── 3) 词表外组名 → 未归类桶置尾 + WARN（fail-visible） ─────
{
  const warns: string[] = [];
  const origWarn = console.warn;
  console.warn = (m: unknown) => warns.push(String(m));
  let out: string;
  try {
    out = render([card("w.md", ["野生组名"], ["z"])]);
  } finally {
    console.warn = origWarn;
  }
  assert.ok(out.includes(`## 🎯 ${UNCLASSIFIED_GROUP}`), "词表外组名应落入未归类桶");
  assert.ok(!out.includes("## 🎯 野生组名"), "野生组名不得作为分组标题渲染");
  assert.ok(
    warns.some((w) => w.includes("词表外组名") && w.includes("QUICK_GROUPS")),
    "词表外组名必须打 WARN 且指路词表常量",
  );
  const heads = [...out.matchAll(/^## 🎯 .+$/gm)].map((m) => m[0]);
  assert.equal(heads[heads.length - 1], `## 🎯 ${UNCLASSIFIED_GROUP}`, "未归类桶必须置尾");
}

// ─── 4) 多规范组卡：意图↔分组循环配对语义不变 ────────────────
{
  const out = render([card("m.md", ["UI 交互与弹窗", "门禁与脚本"], ["i1", "i2"])]);
  assert.ok(out.includes("| i1 |"), "意图1 应保留");
  assert.ok(out.includes("| i2 |"), "意图2 应保留");
  const iUi = out.indexOf(`## 🎯 UI 交互与弹窗`);
  const iGate = out.indexOf(`## 🎯 门禁与脚本`);
  assert.ok(iUi < iGate, "同卡双组仍按词表序渲染");
}

// ─── 5) 超配红线 → 「通用红线」附加行（不再静默丢弃 / 不再丢失 WARN） ──
{
  const warns: string[] = [];
  const origWarn = console.warn;
  console.warn = (m: unknown) => warns.push(String(m));
  let out: string;
  try {
    out = render([{ ...card("e.md", ["门禁与脚本"], ["i1", "i2"]), risks: ["r1", "r2", "r3"] }]);
  } finally {
    console.warn = origWarn;
  }
  assert.ok(out.includes("| r1 |") && out.includes("| r3 |"), "超配红线必须全部渲染，不得丢弃");
  assert.ok(out.includes("| 通用红线 |"), "超配行意图列标注「通用红线」");
  assert.ok(
    !warns.some((w) => w.includes("不输出")),
    "内容已保全，不得再打「多余不输出」丢失 WARN",
  );
}

// ─── 6) 超配红线挂首分组：多组卡不跟随末组 ────────────────────
{
  const out = render([
    { ...card("f.md", ["3D 预览与模型追加", "门禁与脚本"], ["i1"]), risks: ["rX"] },
  ]);
  const seg3d = out.slice(out.indexOf("## 🎯 3D 预览与模型追加"), out.indexOf("## 🎯 UI 交互与弹窗"));
  assert.ok(seg3d.includes("| rX |"), "超配红线挂首分组（3D），不落入末组");
}

console.log("✅ test_gen_routes_quick_groups.ts 全部通过（6 组契约断言）");
