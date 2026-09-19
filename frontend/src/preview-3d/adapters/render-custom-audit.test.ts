// @vitest-environment node
// ===== renderCustom 构造点审计门（锐评 G3 剩余项收口）=====
//
// 背景：renderCustom 是「真·无法数据化的复杂交互内容」的受限逃生舱——新增面板一律走
// schema-registry（受控 builder）或 children 声明式节点，不得直接拼 DOM（schema-registry.ts
// 头注释「不再允许直接拼 DOM 的 renderCustom 捷径」）。但该声明无机器守护，逃生舱通道仍开放。
//
// 本审计门 = 源码静态扫描：非测试源码中出现新 `renderCustom:` 构造点 → 测试红。
// 当前白名单（1 个：ADR-193 第三刀后 env 已退役出名单，唯余 bones——§2.2 最终决策点）：
//   1. preview-3d/menu/panels/bones-panel-node.ts  — id="bones"  骨骼面板（动态树 + 跨域拾取联动，
//      豁免理由见该文件头注释 13-18 行；ADR-193 §2.2 唯一决策点；路径随 ADR-235 批次 A 归位 menu/）
//
// 豁免流程：真·无法数据化才可新增构造点 —— 白名单追加路径 + 构造点处注明豁免理由，
// 且先经 code review（防「图省事走逃生舱」回归）。测试/类型声明/渲染器读字段不在此列
// 豁免须自证三件：decidedBy（ADR 依据）+ rationale（真·无法数据化的具体性质）+ exitWhen（假释条件）。
// （*.test.ts 排除；node-types.ts 类型声明与 render.ts 读取处无 `renderCustom:` 字面量）。
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { SANCTIONED_PROCEDURAL_PANELS } from "@/preview-3d/menu/engine/sanctioned.ts";

/** frontend/src 根（本文件位于 src/preview-3d/adapters/） */
const SRC_ROOT = join(fileURLToPath(new URL("../../..", import.meta.url)), "src");

/**
 * 允许出现 `renderCustom:` 构造点的生产源码文件（相对 src 的正斜杠路径）。
 * **单一事实源 = `menu/sanctioned.ts`**（ADR-193 §2.2② 拍板 + §3「不可静默」）——
 * 本处不再自带一份数组：名单、报告、代码注释三处各说各话正是被收口的病灶。
 */
const RENDER_CUSTOM_ALLOWLIST = SANCTIONED_PROCEDURAL_PANELS.map((p) => p.sourceFile);

function collectTsFiles(dir: string, acc: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      collectTsFiles(full, acc);
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      acc.push(full);
    }
  }
  return acc;
}

describe("renderCustom 构造点白名单（逃生舱审计门）", () => {
  it("生产源码中 `renderCustom:` 构造点不超出 1 个既有白名单文件", () => {
    const files = collectTsFiles(SRC_ROOT, []);
    const hits = files.filter((f) => readFileSync(f, "utf8").includes("renderCustom:"));
    const norm = hits.map((f) => relative(SRC_ROOT, f).split(sep).join("/")).sort();
    const allow = [...RENDER_CUSTOM_ALLOWLIST].sort();
    expect(norm).toEqual(allow);
  });

  it("白名单文件均存在（防路径漂移导致白名单空转）", () => {
    for (const rel of RENDER_CUSTOM_ALLOWLIST) {
      const full = join(SRC_ROOT, ...rel.split("/"));
      expect(readFileSync(full, "utf8").includes("renderCustom:")).toBe(true);
    }
  });

  it("豁免条目必自证三件（ADR 依据 + 具体理由 + 假释条件），防「裸加白名单」", () => {
    // 名单被清空 → 本门空转恒绿，故先钉非空
    // 名单一增长即说明「第二个需外部回流的声明式面板」出现，触发选项① 抽象提取（两次法则）。
    // 断言变红时不要改这个数字：应按 ADR-276 §2.3 先拍板抽象方案，而非再挂一个例外。
    expect(
      SANCTIONED_PROCEDURAL_PANELS.length,
      "豁免名单增长 → 触发 ADR-276 §2.3 选项① 抽象提取复查（勿直接放宽本断言）",
    ).toBe(1);
    for (const p of SANCTIONED_PROCEDURAL_PANELS) {
      expect(p.id, "条目缺 id").toBeTruthy();
      expect(p.decidedBy, `"${p.id}" 缺 ADR 依据`).toMatch(/ADR-\d+/);
      // 理由须写「真·无法数据化的具体性质」而非「很复杂」套话（ADR-193 §2.2 豁免流程）
      expect(p.rationale.length, `"${p.id}" 豁免理由过短，疑为套话`).toBeGreaterThan(40);
      // 假释条件（exitWhen）：永久例外 ≠ 永久特权（ADR-193 §2.2「拒绍挂着不动」）——
      // 缺「什么情况下本例外不再成立」的豁免是无到期日的债，故同样机器守护。
      expect(p.exitWhen, `"${p.id}" 缺假释条件（exitWhen）`).toBeTruthy();
      expect(p.exitWhen.length, `"${p.id}" 假释条件过短，疑为套话`).toBeGreaterThan(20);
    }
  });
});
