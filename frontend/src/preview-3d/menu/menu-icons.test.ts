// ===== 3D 菜单/卡片图标契约：icon 字段必须是语义名，且渲染为 SVG（ADR-238 / ADR-245）=====
//
// 为什么需要（2026-09 菜单勘察查获的**口径盲区**）：
//   emoji 扫描闸只认「标签内容起始处」（`>😀` / `' + 😀`），而 3D 菜单的图标是**数据字面量**
//   （`icon: "🧍"`）→ 两者都不是 → 长期逃逸。于是「emoji 债 = 1」与「3D 菜单满屏 emoji 图标」
//   可以同时为真，**债在账外**。这与令牌闸「预筛关键词陈旧致整类静默失明」是同一种病。
//
// 既有约定（`utils/icon/resolve.ts|resolveIcon`，ADR-238/ADR-245）：icon 字段填**语义名**
//  （UI_ICONS / ICON_KIT 的 key），由 resolveIcon/applyIcon 解析为渲染串。工具栏下拉（ADR-239）
//  与右键菜单（ADR-245）早已迁完，本仓 3D 菜单域于 2026-09 分批迁移。
//
// 本测试把该约定钉在两个层面：
//   ① **数据层**：可直接 import 的表（`defs.ts` 的坞站组与 core 菜单项）；
//   ② **源码层**：图标写在 `build: (o) => ({…})` 闭包里的适配器表无法静态 import 枚举，
//      故对已迁文件做源码扫描（与 `check-menu-health` 的正则解析同源思路）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isIconName, resolveIcon } from "@/utils/icon/resolve.ts";
import { CORE_MENU_ITEMS, PREVIEW_MENU_GROUPS } from "./defs.ts";

const MENU_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(MENU_DIR, "..", ".."); // frontend/src

/** emoji 与「当图标用的符号字形」——结构槽里都不该再出现 */
const GLYPH_RE =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{25A0}-\u{25FF}\u{FE0F}]/u;

/**
 * 已迁语义名的**结构槽**文件（相对 frontend/src）。
 * 新增一处迁移就往这里加一行——清单本身就是「还有哪些没迁」的记录。
 */
const MIGRATED_FILES = [
  "preview-3d/menu/defs.ts",
  "preview-3d/menu/bones-panel-node.ts",
  "preview-3d/menu/stats.ts",
  "preview-3d/adapters/ysm-adapter.ts",
  "preview-3d/adapters/vrm/vrm-adapter.ts",
  "preview-3d/adapters/mmd/mmd-build-menu.ts",
  "preview-3d/adapters/litematic-adapter.ts",
  "views/app-preview/shot-panel-shared.ts",
  "views/app-preview/detail-3d.ts",
  "views/app-preview/preview-router.ts",
];

/**
 * 豁免（ADR-238 §1.4 文本槽）：`menu/env.ts` 的快捷环境预设图标**不是结构槽**——
 * 它被拼进 `label` 喂给 `<select>` 的 `<option>`，而 `renderCapSelect` 用 `o.textContent` 落位、
 * `<option>` 的内容模型**只能是文本**。迁 SVG 只会让下拉里显示一屏 `<svg…>` 字面量。
 * 故按 §1.4「文本槽内符号允许保留」豁免，不列入 MIGRATED_FILES。
 */
const TEXT_SLOT_FILES = ["preview-3d/menu/env.ts"];

/** 从源码里抽出所有 `icon: "…"` 字面量（闭包内的表只能这样枚举） */
function scanIconLiterals(rel: string): { value: string; line: number }[] {
  const src = fs.readFileSync(path.join(SRC, rel), "utf8");
  const out: { value: string; line: number }[] = [];
  src.split("\n").forEach((line, i) => {
    const m = /\bicon:\s*"([^"]*)"/.exec(line);
    if (m) out.push({ value: m[1]!, line: i + 1 });
  });
  return out;
}

describe("3D 菜单图标契约（ADR-238/ADR-245 单一事实源）", () => {
  describe("① 数据层：defs.ts 的坞站组与 core 菜单项", () => {
    const entries = [
      ...PREVIEW_MENU_GROUPS.map((g) => ({ kind: "坞站组", id: g.id, icon: g.icon })),
      ...CORE_MENU_ITEMS.map((n) => ({ kind: "菜单项", id: n.id, icon: n.icon ?? "" })),
    ];

    it("每个 icon 都是已知语义名（isIconName 认得）", () => {
      const bad = entries.filter((e) => !isIconName(e.icon));
      expect(
        bad.map((b) => `${b.kind} ${b.id}: "${b.icon}"`),
        "icon 必须是 UI_ICONS / ICON_KIT 的语义名（未命中 resolveIcon 返回空 → 图标消失）",
      ).toEqual([]);
    });

    it("每个 icon 都渲染为 SVG（而非字形文本）", () => {
      const bad = entries.filter((e) => !resolveIcon(e.icon).includes("<svg"));
      expect(bad.map((b) => `${b.kind} ${b.id}: "${b.icon}"`)).toEqual([]);
    });

    it("回归锁：icon 里不得再出现 emoji / 符号字形", () => {
      const bad = entries.filter((e) => GLYPH_RE.test(e.icon));
      expect(bad.map((b) => `${b.kind} ${b.id}: "${b.icon}"`)).toEqual([]);
    });
  });

  describe("② 源码层：图标写在闭包表里的已迁文件", () => {
    for (const rel of MIGRATED_FILES) {
      it(`${rel} 的 icon 字面量均为语义名且无字形`, () => {
        const literals = scanIconLiterals(rel);
        // 防空转：文件里若一个 icon 都扫不到，说明路径已失效（本仓踩过「路径漂移致闸恒绿」）
        expect(literals.length, `${rel} 未扫到任何 icon 字面量——路径是否已迁移？`).toBeGreaterThan(
          0,
        );
        const bad = literals.filter((l) => !isIconName(l.value) || GLYPH_RE.test(l.value));
        expect(
          bad.map((b) => `L${b.line}: "${b.value}"`),
          `${rel} 的 icon 必须是语义名（且不得含 emoji/符号字形）`,
        ).toEqual([]);
      });
    }
  });

  describe("③ 豁免清单自检（防「豁免」悄悄变成漏检）", () => {
    for (const rel of TEXT_SLOT_FILES) {
      it(`${rel} 仍只出现在文本槽（豁免理由见文件头）`, () => {
        const literals = scanIconLiterals(rel);
        expect(literals.length).toBeGreaterThan(0);
        // 豁免的前提是「喂给 <option> 文本」。若将来该文件改为结构槽渲染，本条会提醒撤销豁免。
        const src = fs.readFileSync(path.join(SRC, rel), "utf8");
        expect(
          src.includes("label:"),
          `${rel} 不再走 label 文本拼接？请复核 §1.4 豁免是否仍成立`,
        ).toBe(true);
      });
    }
  });
});
