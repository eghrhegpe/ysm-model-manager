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
  // 左导航（2026-09）：`<span class="icon">${resolveIcon(item.icon)}</span>` 结构槽
  "views/app-nav/index.ts",
  // 包内文件清单芯片（2026-09）：同上；label 已同时转 i18n
  "views/app-preview/tpl.ts",
  // 能力类（2026-09）：`readonly icon = "…"` 经 `menu/env.ts|envCapRow` 流入菜单行图标位。
  // ⚠️ 这批是**放宽扫描口径**后才现形的——原正则只认 `icon: "…"`（冒号），漏了等号形态。
  "preview-3d/caps/environment-capability.ts",
  "preview-3d/caps/fog-capability.ts",
  "preview-3d/caps/ground-capability.ts",
  "preview-3d/caps/light-capability.ts",
  "preview-3d/caps/postprocessing-capability.ts",
  "preview-3d/caps/reflector-capability.ts",
  "preview-3d/caps/render-mode-capability.ts",
  "preview-3d/caps/shadow-capability.ts",
  "preview-3d/caps/water-capability.ts",
  "preview-3d/caps/sky-capability.ts",
];

/**
 * 豁免（ADR-238 §1.4 文本槽）：**登记理由 + 通道证据**，避免豁免退化成漏检。
 *
 * `marker` 是该文件走文本槽的**结构性证据**——测试断言它仍存在；
 * 若某文件将来改为结构槽渲染（marker 消失），本条会失败并提醒撤销豁免。
 */
const TEXT_SLOT_FILES: { rel: string; marker: string; why: string }[] = [
  {
    rel: "preview-3d/menu/env.ts",
    marker: "label:",
    why: "预设 emoji 拼进 label 喂 <select> 的 <option>；renderCapSelect 用 o.textContent，<option> 只能文本",
  },
  // 以下文件的 icon 一律作为「标题/文案前缀」传入 modal 或 toast 模板，
  // 最终经 utils/dom/modal-core.ts 的 `esc(icon)` 转义内联——SVG 会被转义成字面量，故属文本槽。
  { rel: "features/dialogs/adv-filter.ts", marker: "createDialog", why: "对话框标题前缀（esc 通道）" },
  { rel: "features/dialogs/rename.ts", marker: "createDialog", why: "对话框标题前缀（esc 通道）" },
  { rel: "features/dialogs/tag-editor.ts", marker: "createDialog", why: "对话框标题前缀（esc 通道）" },
  { rel: "features/maintenance/recycle-bin.ts", marker: "modalConfirm", why: "确认框标题前缀" },
  { rel: "features/maintenance/version-updater.ts", marker: "modalConfirm", why: "确认框标题前缀" },
  { rel: "features/pack-ops/instance-ops.ts", marker: "modalConfirm", why: "确认框标题前缀" },
  { rel: "views/app-content/settings/path-cards.ts", marker: "modalPicker", why: "选择器标题前缀" },
  {
    rel: "views/app-sidebar/launcher-detect.ts",
    marker: "modalSelect",
    why: "选择器标题前缀（esc 通道）",
  },
  { rel: "views/app-tree/bus-handlers.ts", marker: "modalConfirm", why: "确认框标题前缀" },
  { rel: "views/app-tree/index.ts", marker: "modalConfirm", why: "确认框标题前缀" },
  {
    rel: "features/community/repo-events-bindings.ts",
    marker: "modalConfirm",
    why: "确认框标题前缀",
  },
  // 右键菜单的 toast/弹窗**文案模板**（BATCH_TPL）——不是菜单项图标（ADR-245 迁移完好）
  { rel: "features/context-menu/context-menu-handlers.ts", marker: "BATCH_TPL", why: "toast 文案模板" },
  {
    rel: "features/context-menu/context-menu-file-handlers.ts",
    marker: "modalSelect",
    why: "选择器标题前缀（esc 通道）",
  },
  // **数据图标**兜底（ADR-238 §1.3 🚨不可动）：资源类型图标来自 resource_types.json，
  // 本来就是彩色 emoji；此处的 `|| "📦"` 是未知类型的兜底字面量，属数据域而非 UI chrome。
  {
    rel: "views/app-content/diagnostics/dedup-scan.ts",
    marker: "typeIcon",
    why: "数据图标兜底（§1.3 不可动）",
  },
];

/** 从源码里抽出所有 `icon: "…"` / `icon = "…"` 字面量（闭包内的表只能这样枚举）。
 *
 * ⚠️ 必须同时认**冒号**与**等号**两种形态：菜单表用对象字面量 `icon: "x"`，
 * 而能力类用字段声明 `readonly icon = "🌍"`——只写冒号会漏掉整族（2026-09 实测漏了
 * `preview-3d/caps/*-capability.ts` 的 9 处，正是这条教训促成的放宽）。
 *
 * ⚠️ 必须**剥注释**：文档注释里常引用形如 `icon="🦴"` 的示例（本仓实测命中，
 * 且那条注释当时已过时）。不剥会把注释当违规行——与 check-redlines R8「扫描器不剥注释」
 * 踩的是同一个坑。
 */
function scanIconLiterals(rel: string): { value: string; line: number }[] {
  const src = fs.readFileSync(path.join(SRC, rel), "utf8");
  const out: { value: string; line: number }[] = [];
  let inBlockComment = false;
  src.split("\n").forEach((line, i) => {
    const trimmed = line.trim();
    // 块注释开关（简化处理：逐行检测 /* 与 */，足够覆盖本仓注释风格）
    if (inBlockComment) {
      if (trimmed.includes("*/")) inBlockComment = false;
      return;
    }
    if (trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/")) inBlockComment = true;
      return;
    }
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
    const m = /\bicon\s*[:=]\s*"([^"]*)"/.exec(line);
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
    for (const { rel, marker, why } of TEXT_SLOT_FILES) {
      it(`${rel} 仍走文本槽（${why}）`, () => {
        const literals = scanIconLiterals(rel);
        // 豁免的前提是「该文件确有字形 icon」——若已无，说明已迁走，本条提醒从清单移除
        expect(literals.length, `${rel} 已无 icon 字面量？可移出豁免清单`).toBeGreaterThan(0);
        const src = fs.readFileSync(path.join(SRC, rel), "utf8");
        expect(
          src.includes(marker),
          `${rel} 不再含文本槽通道标记「${marker}」？请复核 §1.4 豁免是否仍成立`,
        ).toBe(true);
      });
    }

    it("豁免清单与迁移清单不重叠（同一文件不能既迁又豁免）", () => {
      const overlap = TEXT_SLOT_FILES.map((t) => t.rel).filter((r) => MIGRATED_FILES.includes(r));
      expect(overlap).toEqual([]);
    });
  });

  // ── ④ 仓级扫描：全仓 `icon:` 字形只许出现在登记过的豁免文件里 ──────────
  // 这是本测试的**牙齿**：前两组靠清单自律，这一组把「有没有漏网之鱼」变成可执行断言。
  // 口径按**渲染槽**，不按字段名——所以放行的是「登记 + 带通道证据」的豁免文件（见 ③ 自检），
  // 而非「看起来像文本就只能放过」的猜测。
  //
  // ⚠️ 覆盖边界（有意为之，非遗漏）：本组只扫**字面量** `icon: "…"`。动态赋值（如
  // `icon: cap.icon`、`icon: def?.icon || "📦"`）不在其内——因为**数据图标**
  // （`resource_types.json` 的 icon/groupIcon，ADR-238 §1.3 🚨不可动）本就是彩色 emoji，
  // 且会经 `views/app-preview/preview-router.ts|routeTypeMeta` 流入卡片图标通道。
  // 那是合法来源，不该被本测试拦；渲染层由 `applyIcon` 的兜底分支承载（见该函数注释）。
  describe("④ 仓级扫描：未登记的文件不得再出现 icon 字形", () => {
    /** 递归收集 frontend/src 下非测试 .ts 文件（相对 SRC 的 POSIX 路径） */
    function walk(dir: string, out: string[] = []): string[] {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (["node_modules", "dist", "coverage", ".git"].includes(e.name)) continue;
          walk(p, out);
        } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
          out.push(path.relative(SRC, p).split(path.sep).join("/"));
        }
      }
      return out;
    }

    it("全仓 icon 字形仅存在于迁移清单与豁免清单之中", () => {
      const allowed = new Set([...MIGRATED_FILES, ...TEXT_SLOT_FILES.map((t) => t.rel)]);
      const offenders: string[] = [];
      for (const rel of walk(SRC)) {
        if (allowed.has(rel)) continue;
        for (const { value, line } of scanIconLiterals(rel)) {
          if (GLYPH_RE.test(value)) offenders.push(`${rel}:${line}: "${value}"`);
        }
      }
      expect(
        offenders,
        "发现未登记的 icon 字形——若是结构槽请迁语义名并加入 MIGRATED_FILES；" +
          "若是文本槽请连同通道证据登记进 TEXT_SLOT_FILES（ADR-238 §1.4）",
      ).toEqual([]);
    });
  });
});
