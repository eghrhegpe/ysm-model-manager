#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { finish, ok, runScript } from "./_lib.mts";

// check-knowledge-drift 检查 5.15「跨卡认领重复」契约。
// 背景（2026-10-06）：source_files 是覆盖登记。实测 191 张有 source_files 的卡里，
// 130 个路径被 ≥2 张卡认领；32 张卡 0 条独占（multi-model-select 7/7、features-dialogs 6/6、
// utils-export 5/5）——零独占登记是重复劳动，却与真覆盖一样权威。此前无任何检查覆盖。
// 阈值 ≥3 条认领且 0 条独占：1~2 条全重叠多半是跨切面视图，单卡误伤率高。
// 隔离策略：临时卡 + --kc-dir（同 check-knowledge-* 家族范式）。

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ysm-claim-"));

// 真实存在的路径（认领检查只比字符串、不验存在性，但用真路径避免触发其他检查的噪音）
const P = [
  "frontend/src/utils/base/pure/array.ts",
  "frontend/src/preview-3d/adapters/mount-preview-core.ts",
  "frontend/src/preview-3d/caps/sky-capability.ts",
  "frontend/src/preview-3d/caps/ground-capability.ts",
  "frontend/src/preview-3d/bone/bone-tools.ts",
  "internal/app/app.go",
  "internal/app/app_config.go",
  "go/types/types.go",
  "frontend/src/utils/base/pure/clamp.ts",
  "frontend/src/utils/base/pure/label.ts",
];

function writeCard(kind: string, sources: string[], broadClaim = false) {
  const fm = [
    "---",
    `kind: ${kind}`,
    `name: 认领重复契约临时卡 ${kind}`,
    "tier: leaf",
    "category: utils",
    ...(broadClaim ? ["broad_claim: true"] : []),
    "source_files:",
    ...sources.map((s) => `  - ${s}`),
    "use_when:",
    "  - 认领重复护栏",
    "---",
    "",
    `# 认领重复契约临时卡 ${kind}`,
    "",
  ].join("\r\n");
  fs.writeFileSync(path.join(TMP_DIR, `${kind}.md`), fm, "utf8");
}

function runCheck() {
  const r = runScript("check-knowledge-drift.ts", "--json", "--kc-dir", TMP_DIR);
  const out = (r.stdout ? JSON.parse(r.stdout) : { errors: [], warns: [] }) as {
    errors: string[];
    warns: string[];
  };
  return { status: r.status, out };
}

/** 本卡是否被 5.15 鸣笛。 */
function overlapWarned(out: { warns: string[] }, kind: string) {
  return out.warns.some((w) => w.includes(`${kind}.md`) && w.includes("0 条独占"));
}

console.log("=== 知识卡跨卡认领重复契约 ===");

try {
  // A：3 条认领，全被 B 认领 → WARN
  // B：3 条认领，全被 A 认领 → WARN（对称）
  // C：4 条认领，1 条独有 → 不鸣笛
  // D：2 条全重叠但低于阈值下限 → 不鸣笛
  // E：3 条认领，全部独有 → 不鸣笛
  writeCard("zzz-ov-a", [P[0], P[1], P[2]]);
  writeCard("zzz-ov-b", [P[0], P[1], P[2]]);
  writeCard("zzz-ov-c", [P[0], P[1], P[2], P[3]]);
  writeCard("zzz-ov-d", [P[0], P[1]]);
  writeCard("zzz-ov-e", [P[4], P[5], P[6]]);

  let { status, out } = runCheck();
  ok("≥3 条全重叠 → WARN 且点名 0 条独占", overlapWarned(out, "zzz-ov-a"), `warns=${out.warns.slice(0, 5)}`);
  ok("对称卡同样鸣笛", overlapWarned(out, "zzz-ov-b"), `warns=${out.warns.slice(0, 5)}`);
  ok("部分独有（1/4 独占）→ 不鸣笛", !overlapWarned(out, "zzz-ov-c"), `warns=${out.warns.filter((w) => w.includes("zzz-ov-c")).join()}`);
  ok("2 条全重叠低于阈值下限 → 不鸣笛", !overlapWarned(out, "zzz-ov-d"), `warns=${out.warns.filter((w) => w.includes("zzz-ov-d")).join()}`);
  ok("3 条全部独有 → 不鸣笛", !overlapWarned(out, "zzz-ov-e"), `warns=${out.warns.filter((w) => w.includes("zzz-ov-e")).join()}`);
  ok("WARN 不阻断 → 退出码 0", status === 0, `status=${status}`);

  // 6. 阈值边界：恰好 3 条全重叠 → WARN（下限闭区间）
  writeCard("zzz-ov-f", [P[0], P[1], P[2]]);
  ({ status, out } = runCheck());
  ok("恰好 3 条全重叠 → WARN（下限闭区间）", overlapWarned(out, "zzz-ov-f"), `warns=${out.warns.slice(0, 5)}`);

  // 7. 建议文案可执行
  ok(
    "WARN 给出可执行建议（收窄或确认跨切面）",
    out.warns.some((w) => w.includes("zzz-ov-a") && w.includes("收窄到独有路径") && w.includes("跨切面视图")),
    `warns=${out.warns.filter((w) => w.includes("zzz-ov-a")).join().slice(0, 300)}`,
  );

  // 8. broad_claim 机器豁免出口（2026-10-09，台账 K1「有意跨切面，不盲目收窄」的机器表达）：
  //    G：3 条全重叠 + 旗标 → 5.15 豁免（条件成立 = 旗标新鲜）
  //    H：3 条全独有 + 旗标 → stale WARN（条件不成立，旗标该删——棘轮自清理，防豁免变永久逃生阀）
  //    I：2 条低于阈值 + 旗标 → 同样 stale WARN
  writeCard("zzz-ov-g", [P[0], P[1], P[2]], true);
  writeCard("zzz-ov-h", [P[7], P[8], P[9]], true);
  writeCard("zzz-ov-i", [P[0], P[1]], true);
  ({ status, out } = runCheck());
  ok(
    "3 条全重叠 + broad_claim → 5.15 豁免",
    !overlapWarned(out, "zzz-ov-g") && !out.warns.some((w) => w.includes("zzz-ov-g") && w.includes("broad_claim")),
    `warns=${out.warns.filter((w) => w.includes("zzz-ov-g")).join().slice(0, 300)}`,
  );
  ok(
    "全独有 + broad_claim → stale WARN（旗标失需）",
    out.warns.some((w) => w.includes("zzz-ov-h") && w.includes("broad_claim") && w.includes("不再需要")),
    `warns=${out.warns.filter((w) => w.includes("zzz-ov-h")).join().slice(0, 300)}`,
  );
  ok(
    "低于阈值 + broad_claim → stale WARN",
    out.warns.some((w) => w.includes("zzz-ov-i") && w.includes("不再需要")),
    `warns=${out.warns.filter((w) => w.includes("zzz-ov-i")).join().slice(0, 300)}`,
  );
  ok("豁免不改变 WARN 不阻断 → 退出码 0", status === 0, `status=${status}`);
} finally {
  if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true, force: true });
}

finish("知识卡跨卡认领重复契约全过");
