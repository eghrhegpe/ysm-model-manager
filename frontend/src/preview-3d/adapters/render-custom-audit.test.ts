// @vitest-environment node
// ===== renderCustom 构造点审计门（锐评 G3 剩余项收口）=====
//
// 背景：renderCustom 是「真·无法数据化的复杂交互内容」的受限逃生舱——新增面板一律走
// schema-registry（受控 builder）或 children 声明式节点，不得直接拼 DOM（schema-registry.ts
// 头注释「不再允许直接拼 DOM 的 renderCustom 捷径」）。但该声明无机器守护，逃生舱通道仍开放。
//
// 本审计门 = 源码静态扫描：非测试源码中出现新 `renderCustom:` 构造点 → 测试红。
// 当前白名单（3 个既有合法构造点，均为 kind="custom" 复杂交互面板，声明式化 ROI 为负）：
//   1. preview-3d/adapters/bones-panel-node.ts  — id="bones"  骨骼面板（动态树 + 跨域拾取联动，
//      豁免理由见该文件头注释 13-18 行）
//   2. preview-3d/menu/env.ts                    — id="environment" 环境面板（cap 控件包装）
//   3. preview-3d/menu/settings.ts               — id="camera" 相机面板（buildCameraControls 包装）
//
// 豁免流程：真·无法数据化才可新增构造点 —— 白名单追加路径 + 构造点处注明豁免理由，
// 且先经 code review（防「图省事走逃生舱」回归）。测试/类型声明/渲染器读字段不在此列
// （*.test.ts 排除；node-types.ts 类型声明与 render.ts 读取处无 `renderCustom:` 字面量）。
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** frontend/src 根（本文件位于 src/preview-3d/adapters/） */
const SRC_ROOT = join(fileURLToPath(new URL("../../..", import.meta.url)), "src");

/** 允许出现 `renderCustom:` 构造点的生产源码文件（相对 src 的正斜杠路径） */
const RENDER_CUSTOM_ALLOWLIST = [
  "preview-3d/adapters/bones-panel-node.ts",
  "preview-3d/menu/env.ts",
  "preview-3d/menu/settings.ts",
];

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
  it("生产源码中 `renderCustom:` 构造点不超出 3 个既有白名单文件", () => {
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
});
