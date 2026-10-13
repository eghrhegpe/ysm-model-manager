#!/usr/bin/env node
/**
 * adr-tier-gate.ts — ADR 准入三问（第三刀：ADR 增量门槛）。
 *
 * 立 ADR（含 --tier decisions 执行级）前必须过准入三问；三问全否则该裁定属
 * 「单点执行裁定」，应降格为所属知识卡的「裁定记录」段，不占 ADR 编号。
 *
 * 三问（任一为「是」才可立 ADR）：
 *   Q1 公共契约变更 —— 绑定签名 / 注册表 schema / 跨进程协议 / i18n key 契约
 *   Q2 跨域纪律政策 —— 测试纪律 / 门禁口径 / 命名规范 / 红线执法等级
 *   Q3 难逆转或跨域影响面 ≥ 多模块 —— 推翻难 / 影响面跨模块
 *
 * 零依赖（仅正则）。判据为「关键词启发式 + 一句准入凭据」——工具只做 fail-loud
 * 拦截（明显不符时拒绝并给出降格指引），不替代人的判断；拿不准可补一句凭据重试。
 *
 * 用法（import）：
 *   import { PASS, admissionReasons, passesAdmissionGate } from "./_lib/adr-tier-gate.ts";
 *   const r = passesAdmissionGate(justify);
 *   // r.pass=false 时 r.reasons 给出未命中的问号，r.hint 给出降格指引
 *
 * 设计意图：把「单点执行裁定不立 ADR」从口头约定变成可执行的准入闸
 * 退出码：本文件无 main（纯函数库）
 */

/** 三问关键词（命中任一即视为该问为「是」）。 */
export const ADMISSION_QUESTIONS: { q: string; re: RegExp }[] = [
  {
    q: "Q1 公共契约变更（绑定签名 / 注册表 schema / 跨进程协议 / i18n key）",
    re: /公共契约|契约变更|绑定签名|绑定契约|bindings? 签名|注册表\s*schema|schema\s*变更|进程协议|协议变更|i18n\s*key|跨端契约|契约锁/i,
  },
  {
    q: "Q2 跨域纪律政策（测试纪律 / 门禁口径 / 命名规范 / 红线执法等级）",
    re: /纪律|政策|规范|红线|门禁|口径|执法等级|命名规则|测试口径/i,
  },
  {
    q: "Q3 难逆转或跨域影响面（推翻难 / 影响面跨多模块）",
    re: /难逆转|不可逆|跨域|跨模块|跨子系统|影响面|推翻/i,
  },
];

/** 降格指引（--tier decisions 被拒时提示）。 */
export const RULING_HINT =
  '本裁定属单点执行裁定（准入三问全否）——不占 ADR 编号，请写入所属知识卡的「裁定记录」段：node scripts/add-card-ruling.ts <kind> --decision "..." --why "..." --revert "文件|符号" [--date YYYY-MM-DD]';

/** 命中哪些问号。 */
export function admissionReasons(justify: string): string[] {
  const text = String(justify ?? "");
  return ADMISSION_QUESTIONS.filter(({ re }) => re.test(text)).map(({ q }) => q);
}

/** 准入判定：至少命中一问 → 通过；全否 → 拒绝并给降格指引。 */
export function passesAdmissionGate(justify: string): {
  pass: boolean;
  hit: string[];
  missing: string[];
  hint: string;
} {
  const hit = admissionReasons(justify);
  const missing = ADMISSION_QUESTIONS.map(({ q }) => q).filter((q) => !hit.includes(q));
  return { pass: hit.length > 0, hit, missing, hint: RULING_HINT };
}

// 支持直接运行打印三问清单（`node scripts/_lib/adr-tier-gate.ts`），便于人工复核判据。
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  console.log("ADR 准入三问（任一为「是」才可立 ADR）：");
  for (const { q, re } of ADMISSION_QUESTIONS) {
    console.log(`  - ${q}\n      关键词: ${re.source}`);
  }
  console.log(`\n降格指引：${RULING_HINT}`);
}
