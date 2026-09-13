#!/usr/bin/env node
/**
 * 契约测试：ctx.sh / ctx.shAsync 调用点安全不变式（2026-09-13 锐评 P1 #4）。
 *
 * 背景：gate-ctx.ts 的 sh/shAsync 走 shell:true，每条命令都过 cmd.exe 解析——
 * 「禁止把运行期用户可控字符串（pre-push stdin 的 localRef、CLI 参数等）传入本函数」
 * 是整个门禁最关键的安全不变式，但长期只活在注释里（人自觉 + code review）。
 * 本测试把它升级为**可执行契约**，两层防线：
 *
 *   1. 禁入清单：任何 sh/shAsync 实参中插值/拼接 push-stdin 派生标识符
 *      （localRef/localOid/remoteOid/remoteName/remoteUrl/pushed/refFiles/stdin/args._）
 *      → FAIL（命令注入面）。含外部输入的执行必须数组化 procRun（同 git()/gofmtCheck 先例）
 *   2. 动态命令冻结清单：实参为字符串字面量的调用点任意新增；**含插值/变量**的调用点
 *      必须逐个登记在 DYNAMIC_ALLOWLIST（带归属理由）——新增动态命令而没有在清单里
 *      写明「插值内容全部为开发者常量」的依据 → FAIL，强制安全审查显式化
 *
 * 依赖：node:assert / node:fs / node:path（源码扫描式契约测试，同 test_gate_iife_correctness 风格）。
 * 用法：node tests/test_gate_sh_invariants.ts（或经 _lib/contract-tests.ts 统一入口）。
 * 退出码：0 全绿；非 0 断言失败。
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../scripts/_lib/scan-files.ts";

/** 扫描范围：gate 体系内全部可能调用 ctx.sh/ctx.shAsync 的源码 */
const SCAN_FILES = [
  "scripts/pre-push-gate.ts",
  ...fs
    .readdirSync(path.join(ROOT, "scripts", "_lib", "gate-blocks"))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => path.join("scripts", "_lib", "gate-blocks", f)),
];

/** push-stdin / 运行期参数派生的标识符——出现即注入面，零豁免 */
const DENYLIST =
  /\b(localRef|localOid|remoteOid|remoteName|remoteUrl|pushed|refFiles|stdin|args\._)\b/;

/**
 * 动态命令冻结清单：key = 「文件名 + 归一化实参文本」，value = 安全依据。
 * 新增动态调用点必须在此登记「插值内容全部为开发者常量」的理由并通过 review。
 */
const DYNAMIC_ALLOWLIST: Record<string, string> = {
  // schedule.ts：tSC 来自 npx tsc --version 探测的本机 tsc 路径（npx 解析产物，非用户输入）
  'schedule.ts|`"${tSC}" --noEmit -p scripts/tsconfig.json`':
    "tSC 为 npx 探测的本机 tsc 路径（工具链产物）",
  // static-tools：tool 来自 gate-config 清单（开发者维护的常量表），stagedArg/extra 为常量
  'static-tools.ts|`node scripts/${tool} --json ${stagedArg} ${extra.join(" ")}`':
    "tool 来自 gate-config 开发者清单，stagedArg 为常量 --staged，extra 为清单 args",
  "static-tools.ts|`node scripts/${tool} --json`": "tool 来自 gate-config 开发者清单",
};

/** 提取 ctx.sh(...) / ctx.shAsync(...) 的平衡括号实参文本 */
function extractArgs(src: string): { call: string; arg: string }[] {
  const out: { call: string; arg: string }[] = [];
  const re = /ctx\.sh(Async)?\(/g;
  let m: RegExpExecArray | null = re.exec(src);
  while (m) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < src.length && depth > 0; i++) {
      const c = src[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === '"' || c === "'" || c === "`") {
        // 跳过字符串字面量（含转义），防括号计数被字符串内的括号干扰
        const quote = c;
        i++;
        while (i < src.length && src[i] !== quote) {
          if (src[i] === "\\") i++;
          i++;
        }
      }
    }
    out.push({ call: m[0].trim(), arg: src.slice(m.index + m[0].length, i - 1).trim() });
    m = re.exec(src);
  }
  return out;
}

const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
let staticCount = 0;
const dynamicSeen: string[] = [];

for (const rel of SCAN_FILES) {
  const src = fs.readFileSync(path.join(ROOT, rel), "utf-8");
  for (const { arg } of extractArgs(src)) {
    // 实参 = 命令字符串 + 可选 opts 对象：只对首个表达式做静态/动态判定
    // （`"cmd", { cwd }` / `"cmd"` / 反引号模板同理）
    const dq = arg.match(/^"((?:[^"\\]|\\.)*)"\s*(?:,|$)/);
    const sq = arg.match(/^'((?:[^'\\]|\\.)*)'\s*(?:,|$)/);
    const tpl = arg.match(/^`([^`]*)`\s*(?:,|$)/);
    const cmd = dq?.[1] ?? sq?.[1] ?? tpl?.[1];
    const isLiteral = cmd !== undefined && !cmd.includes("${");
    if (isLiteral) {
      staticCount++;
      continue;
    }
    // 动态实参：先过禁入清单（注入面零豁免），再过冻结清单（须登记安全依据）
    assert.ok(
      !DENYLIST.test(arg),
      `[sh-invariants] ${rel}: ctx.sh/shAsync 实参含 push-stdin/运行期派生标识符「${arg}」——` +
        `违反 gate-ctx 安全不变式（shell:true 命令过 cmd.exe 解析）。` +
        `含外部输入的执行必须改数组式 procRun（见 git()/gofmtCheck 先例）`,
    );
    const key = `${path.basename(rel)}|${normalize(arg)}`;
    const reason = DYNAMIC_ALLOWLIST[key];
    assert.ok(
      reason,
      `[sh-invariants] ${rel}: 未登记的动态 ctx.sh/shAsync 实参「${arg}」——` +
        `请在 tests/test_gate_sh_invariants.ts 的 DYNAMIC_ALLOWLIST 登记插值来源与安全依据` +
        `（插值内容必须全部为开发者常量/工具链产物），或改数组式 procRun`,
    );
    dynamicSeen.push(key);
  }
}

// 冻结清单双向一致：登记了但已不存在的动态调用点也要清理（防清单腐化）
for (const key of Object.keys(DYNAMIC_ALLOWLIST)) {
  assert.ok(
    dynamicSeen.includes(key),
    `[sh-invariants] DYNAMIC_ALLOWLIST 条目「${key}」已无对应调用点——请从清单删除（防清单腐化）`,
  );
}

assert.ok(staticCount > 0, "应存在字面量实参的 ctx.sh/shAsync 调用点（扫描范围失效？）");
console.log(
  `[OK] test_gate_sh_invariants.ts：${staticCount} 个字面量调用点 + ${dynamicSeen.length} 个已登记动态调用点，禁入清单零命中`,
);
