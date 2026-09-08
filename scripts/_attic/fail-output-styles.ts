#!/usr/bin/env node
/**
 * fail-output-styles.ts — 门禁 FAIL 输出排版实验（样式 A/B/C/D 对比）。
 *
 * 设计意图：验证不同 FAIL 输出格式的可读性，供本地评估是否采纳到生产门禁。
 * 依赖：零依赖（仅 Node 内置 process/console）。
 *
 * 用法：node scripts/experiments/fail-output-styles.ts [A|B|C|D]
 * 退出码：0（成功渲染）；1（无效样式参数）。
 */
const STYLE = process.argv[2] || "A"; // A/B/C/D 选一

/* ---------------- 真实数据代入 ---------------- */
const samples = [
  {
    kind: "存量债",
    tool: "check-knowledge-drift.ts",
    rc: 1,
    hasJson: true,
    json: {
      _summary: { errors: 3, warns: 0 },
      errors: [
        "知识卡 animation-system.md 的 source_files 引用不存在: frontend/src/utils/animation/molang-lib/molang-prism-syntax.js",
        "知识卡 app-content.md 的机制锚失效: 声称 frontend/src/views/app-content/index.ts 含「_unsubs」，实际不存在（机制描述漂移）",
        "知识卡 utils-icon.md 的机制锚失效: 声称 frontend/src/utils/icon/icon.ts 含「isYsmName」，实际不存在",
      ],
    },
  },
  {
    kind: "本次引入",
    tool: "check-diff-coverage.ts",
    rc: 1,
    hasJson: false,
    raw: "frontend/src/views/app-content/index.ts: 低于 60% 变更行覆盖率，建议补测\nTS2345: Argument of type 'boolean | null' ...\nscripts/pre-push-gate.ts(687,75): error TS2345",
  },
  {
    kind: "失守",
    tool: "check-redlines.ts",
    rc: 1,
    hasJson: false,
    raw: "rg 缺失：fail-closed 阻断，红线门禁未执行",
  },
];

function styleA(s) {
  // 现状基线：只显示 label + note，tail 几乎看不见
  const label = `node scripts/${s.tool} --json`;
  return `[FAIL] ${label}  ${s.kind} errors=3`;
}
function styleB(s) {
  // 改进1：归属标签 + 首个 error 首行
  const label = `node scripts/${s.tool} --json`;
  let err = "";
  if (s.hasJson && s.json.errors?.length) err = s.json.errors[0];
  else if (s.raw) err = s.raw.split("\n")[0];
  return `[FAIL][${s.kind}] ${label}\n       ${err}\n       复现: ${label}`;
}
function styleC(s) {
  // 改进2：归属标签 + 全部 error（预估 ≤2 行）+ 复现；无 JSON 时取 raw 首 3 行
  const label = `node scripts/${s.tool} --json`;
  let lines = [];
  if (s.hasJson && s.json.errors?.length)
    lines = s.json.errors.map((e, i) => (i === 0 ? e : `      ${i + 1}. ${e}`));
  else if (s.raw) lines = s.raw.split("\n").slice(0, 3);
  return `[FAIL][${s.kind}] ${label}\n       ${lines.join("\n")}\n       复现: ${label}`;
}
function styleD(s) {
  // 改进3（激进）：单行密集，错误内联 + 是否阻断声明
  const label = `node scripts/${s.tool} --json`;
  const err = s.hasJson && s.json.errors?.length ? s.json.errors[0] : s.raw?.split("\n")[0] || "";
  const block = s.kind === "本次引入" ? "阻断" : "不阻断";
  return `[FAIL][${s.kind}|${block}] ${label} → ${err.slice(0, 80)}${err.length > 80 ? "…" : ""}（复现: ${label}）`;
}

const fns = { A: styleA, B: styleB, C: styleC, D: styleD };
const fn = fns[STYLE];
if (!fn) {
  console.error("用法: node scripts/experiments/fail-output-styles.ts [A|B|C|D]");
  process.exit(1);
}

console.log(`═══════════ 样式 ${STYLE} ═══════════`);
for (const s of samples) {
  console.log(fn(s));
  console.log("");
}
console.log("───────────── 模拟 3 个 FAIL 一起出现（AI 只看这 25 行）─────────────");
for (const s of samples) {
  console.log(fn(s));
  console.log("");
}
