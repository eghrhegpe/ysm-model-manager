// ===== node-validation.test.ts — per-kind 字段契约门禁（2026-10 锐评收口）=====
//
// 与 health.test.ts 同属「菜单契约门」：health 管「面板有无渲染通道 / 渲染非空」，
// 本门管「节点字段与 kind 是否配对」——补 PreviewMenuNode 宽接口无判别器留下的静默错配盲区
// （`{kind:"field", radio:{…}}` 编译通过、渲染器静默忽略）。
//
// 双向断言：
//  ① 正向：CORE_MENU_ITEMS + core 面板 builder 产出 + schema-registry 全量 → 零违规。
//  ② 负向自检：故意构造错配节点 → validateNode 必须报出（证明门非摆设，对齐
//     health.test.ts「自检：guard 能抓出坏 builder」与 render-custom-audit 的自检纪律）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CORE_MENU_ITEMS } from "@/preview-3d/menu/engine/defs.ts";
import { buildPreviewMenuRouters } from "@/preview-3d/menu/engine/core.ts";
import { getSchema, listSchemas, resetSchemas } from "@/preview-3d/infra/schema-registry.ts";
import type { PreviewMenuNode, PreviewMenuNodeKind } from "./menu-node-types.ts";
import {
  type AssertCommonFieldIsExact,
  COMMON_NODE_FIELDS,
  KIND_SPECIFIC_FIELDS,
  type NodeFor,
} from "./menu-node-types.ts";
import {
  validateNode,
  validateNodeTree,
} from "./node-validation.ts";
import { makeMenuCtx as makeCtx, mockMenuHandle as mockMenu } from "@/preview-3d/menu/menu-test-fixtures.ts";

// ===================================================================
// ① 负向自检：错配必须被抓（门非摆设）
// ===================================================================
describe("validateNode 自检（负向控制）", () => {
  it("抓到 kind 与专有字段错配（field 挂 row 的 radio）", () => {
    const bad = { id: "b", kind: "field", radio: { active: true, title: "t", onClick: () => {} } } as unknown as PreviewMenuNode;
    expect(validateNode(bad)).toEqual(["radio"]);
  });

  it("抓到 material-row 专有字段挂到 slider 上", () => {
    const bad = { id: "b", kind: "slider", eye: { get: () => true, set: () => {} } } as unknown as PreviewMenuNode;
    expect(validateNode(bad)).toEqual(["eye"]);
  });

  it("抓到 controls 通道字段挂到普通叶节点", () => {
    const bad = { id: "b", kind: "button", controls: [] } as unknown as PreviewMenuNode;
    expect(validateNode(bad)).toEqual(["controls"]);
  });

  it("抓到卡牌折叠字段挂到 folder（collapsible 仅 card 合法）", () => {
    const bad = { id: "b", kind: "folder", collapsible: true } as unknown as PreviewMenuNode;
    expect(validateNode(bad)).toEqual(["collapsible"]);
  });

  it("validateNodeTree 递归下钻 children 并聚合违规", () => {
    const tree: PreviewMenuNode[] = [
      {
        id: "folder-ok",
        kind: "folder",
        children: [
          { id: "bad-leaf", kind: "divider", value: "不该有" } as unknown as PreviewMenuNode,
        ],
      },
    ];
    const out = validateNodeTree(tree);
    expect(out).toEqual([{ id: "bad-leaf", kind: "divider", fields: ["value"] }]);
  });

  it("精确性：只认渲染器真正读取的字段——button/row 的 danger 未被读取 → 判契约外", () => {
    // danger 仅读于 core.ts|makePreviewMenuRow（叶节点 makeRow 路径，panel/action/custom），
    // button 走 rmMakeRowBase、row 走 rmAppendDynamicRow 均不读它。
    expect(
      validateNode({ id: "b", kind: "button", danger: true } as unknown as PreviewMenuNode),
    ).toEqual(["danger"]);
    expect(
      validateNode({ id: "r", kind: "row", danger: true } as unknown as PreviewMenuNode),
    ).toEqual(["danger"]);
    // 反证：同样 danger 在 action（makeRow 路径）合法
    expect(validateNode({ id: "a", kind: "action", danger: true } as unknown as PreviewMenuNode)).toEqual(
      [],
    );
  });
});

// ===================================================================
// ①′ 负向自检的反面：合法组合不得误报（防空转/过严）
// ===================================================================
describe("validateNode 正例（合法组合不误报）", () => {
  it("row 带 value/radio/badge/headerToggle/action/rowDensity 全合法", () => {
    const ok: PreviewMenuNode = {
      id: "ok-row",
      kind: "row",
      value: "meta",
      radio: { active: false, title: "t", onClick: () => {} },
      badge: { icon: "settings", title: "t", onClick: () => {} },
      headerToggle: { value: true, onChange: () => {} },
      action: () => {},
      rowDensity: "compact",
    };
    expect(validateNode(ok)).toEqual([]);
  });

  it("field 带 value、panel 带 children/schemaId/action、controls 带 controls 均合法", () => {
    expect(validateNode({ id: "f", kind: "field", value: 1 })).toEqual([]);
    expect(
      validateNode({ id: "p", kind: "panel", children: [], schemaId: "x", action: () => {} }),
    ).toEqual([]);
    expect(validateNode({ id: "c", kind: "controls", controls: [] })).toEqual([]);
  });

  it("button 带 rowDensity（rmMakeRowBase 共用行壳）、custom 带 action/danger（rmAppendLeaf）均合法", () => {
    expect(
      validateNode({ id: "b", kind: "button", rowDensity: "compact", action: () => {} }),
    ).toEqual([]);
    expect(
      validateNode({
        id: "cu",
        kind: "custom",
        renderCustom: () => {},
        action: () => {},
        danger: true,
      }),
    ).toEqual([]);
  });

  it("通用字段（labelKey/label/icon/visibleWhen/dockGroup/settingsOrder/hintKey）全 kind 合法", () => {
    // 用 folder 作代表：通用字段一个不落都不应报违规
    const ok = {
      id: "f",
      kind: "folder",
      labelKey: "preview.x",
      label: "明文",
      icon: "settings",
      hintKey: "preview.h",
      settingsOrder: 1,
      dockGroup: "settings",
      visibleWhen: () => true,
    } as unknown as PreviewMenuNode;
    expect(validateNode(ok)).toEqual([]);
  });

  it("COMMON_NODE_FIELDS 与 KIND_SPECIFIC_FIELDS 无交集（防重复登记漂移）", () => {
    const common = new Set<string>(COMMON_NODE_FIELDS);
    for (const [kind, fields] of Object.entries(KIND_SPECIFIC_FIELDS)) {
      for (const f of fields) {
        expect(common.has(f), `kind "${kind}" 的专有字段 "${f}" 与通用集重叠`).toBe(false);
      }
    }
  });

  it("跨 kind 共用图恒等于预期（任意「放宽某 kind 字段集」都会改图 → 完整守卫）", () => {
    // 先说清契约表的真实形状：它是**多对多**关系，不是「一个字段一个归属」——`action` 被 5 个 kind
    // 合法共用（面板/动作/按钮/行/自定义），`control` 同理（4 种控件 + 按钮）。2026-09 曾误按
    // 「字段唯一归属」写下成对互斥断言，被 `action` 当场证伪（失败信息点名 panel ⇄ action）——
    // **共用是设计，不是漂移**。
    //
    // 但共用图恰好给了「任意放宽」一个**完整**守卫：往任意 kind 的字段集里加任意字段 F，共用图必然变化——
    //   · F 此前无人登记 → 图中**新增**一项；
    //   · F 此前只属一个 kind → F **变成**共用项（或在图中新增）；
    //   · F 此前已共用 → 该项**计数 +1**。
    // 三种情形都逃不掉下面的 deep-equal。于是本用例 + 编译期 `AssertCommonFieldIsExact` +
    // `satisfies readonly (keyof PreviewMenuNode)[]` 三者合起来，穷举了全部改宽方式：
    //   加通用字段 / 加他 kind 专有字段 / 加接口里没登记的字段 / 加不存在的字段名。
    //
    // ⚠️ 类型级「每 kind 一条 @ts-expect-error」负控**不能**替代本用例：它只覆盖「用**被断言的
    // 那个**字段放宽」（2026-09 负控实证：给 slider 加 radio 时，测 opacity 的指令仍绿）。
    const EXPECTED_SHARING: Record<string, number> = {
      action: 5, // panel, action, button, row, custom
      control: 5, // slider, toggle, select, color, button
      danger: 3, // panel, action, custom
      renderCustom: 2, // panel, custom
      rowDensity: 2, // button, row
      value: 2, // field, row（语义不同：字段值 vs 行副标签，见 ADR-302 §3）
    };
    const counts: Record<string, number> = {};
    for (const fields of Object.values(KIND_SPECIFIC_FIELDS)) {
      for (const f of fields) counts[f] = (counts[f] ?? 0) + 1;
    }
    const shared: Record<string, number> = {};
    for (const [f, c] of Object.entries(counts)) if (c > 1) shared[f] = c;
    expect(shared).toEqual(EXPECTED_SHARING);
    // 防门空转：表里确实有 17 个 kind（含 2026-10 菜单收口新增的 note 脚注），且确有字段被登记（表被清空即报红）
    expect(Object.keys(KIND_SPECIFIC_FIELDS)).toHaveLength(17);
    expect(Object.keys(counts).length).toBeGreaterThan(0);
  });
});

// ===================================================================
// ② 正向门：真实菜单树零违规
// ===================================================================
describe("真实菜单树 per-kind 字段契约（零违规门）", () => {
  beforeEach(() => resetSchemas());
  afterEach(() => resetSchemas());

  it("CORE_MENU_ITEMS 零违规", () => {
    expect(validateNodeTree(CORE_MENU_ITEMS)).toEqual([]);
  });

  it("core 面板 builder 产出（含 children 下钻）零违规", () => {
    const menu = mockMenu();
    const routers = buildPreviewMenuRouters(
      makeCtx(),
      () => {},
      menu,
      { toast: vi.fn(), closeAllOverlays: vi.fn() },
      { handle: null } as unknown as Parameters<typeof buildPreviewMenuRouters>[4],
    );
    const violations: ReturnType<typeof validateNodeTree> = [];
    for (const [id, builder] of Object.entries(routers.schemaBuilders)) {
      const nodes = builder(menu);
      const bad = validateNodeTree(nodes);
      for (const b of bad) violations.push({ ...b, id: `${id}/${b.id}` });
    }
    expect(violations, `core 面板节点存在 kind/字段错配：${JSON.stringify(violations)}`).toEqual([]);
  });

  it("schema-registry 全量 builder 产出零违规（含 core 双注册——生产同路径，防门空转）", () => {
    // 生产里 core 面板经 buildPreviewMenuRouters 双注册进 registry；此处先复现该状态再枚举，
    // 否则 registry 为空 → 门空转恒绿（对齐 render-custom-audit 的「防白名单空转」自检纪律）。
    const menu = mockMenu();
    buildPreviewMenuRouters(
      makeCtx(),
      () => {},
      menu,
      { toast: vi.fn(), closeAllOverlays: vi.fn() },
      { handle: null } as unknown as Parameters<typeof buildPreviewMenuRouters>[4],
    );
    const ids = listSchemas();
    expect(ids.length, "registry 应至少含 core 七面板（防门空转恒绿）").toBeGreaterThanOrEqual(7);
    const violations: ReturnType<typeof validateNodeTree> = [];
    for (const id of ids) {
      const builder = getSchema(id);
      if (!builder) continue;
      const bad = validateNodeTree(builder({}));
      for (const b of bad) violations.push({ ...b, id: `${id}/${b.id}` });
    }
    expect(violations, `registry 面板节点存在 kind/字段错配：${JSON.stringify(violations)}`).toEqual(
      [],
    );
  });
});

// ===================================================================
// ③ [ADR-302 走法丙] NodeFor<K> 窄类型：类型层由运行期表派生（非第二份清单）
// ===================================================================
describe("NodeFor<K> 窄类型（类型层派生 ⇄ 运行期表 交叉锁）", () => {
  it("逐 kind 用 NodeFor<K> 构造的节点，在运行期门零违规", () => {
    // 本用例即「单一事实源」的交叉锁：左侧类型由 KIND_SPECIFIC_FIELDS 派生，
    // 右侧 validateNodeTree 是同一张表的运行期消费——派生一旦断裂，两侧必分叉。
    const nodes: PreviewMenuNode[] = [
      {
        id: "nf",
        kind: "folder",
        defaultOpen: true,
        headerToggle: { value: true, onChange: () => {} },
        children: [],
      } satisfies NodeFor<"folder">,
      {
        id: "np",
        kind: "panel",
        schemaId: "s",
        action: () => {},
        danger: true,
        children: [],
      } satisfies NodeFor<"panel">,
      { id: "na", kind: "action", action: () => {}, danger: true } satisfies NodeFor<"action">,
      {
        id: "nsl",
        kind: "slider",
        control: { get: () => 1, set: () => {} },
      } satisfies NodeFor<"slider">,
      {
        id: "ntg",
        kind: "toggle",
        control: { get: () => true, set: () => {} },
      } satisfies NodeFor<"toggle">,
      {
        id: "nse",
        kind: "select",
        control: { get: () => "a", set: () => {} },
      } satisfies NodeFor<"select">,
      {
        id: "ncl",
        kind: "color",
        control: { get: () => "a", set: () => {} },
      } satisfies NodeFor<"color">,
      {
        id: "nb",
        kind: "button",
        control: { action: () => {} },
        action: () => {},
        rowDensity: "compact",
      } satisfies NodeFor<"button">,
      { id: "nfi", kind: "field", value: 1 } satisfies NodeFor<"field">,
      {
        id: "nr",
        kind: "row",
        value: "v",
        radio: { active: true, title: "t", onClick: () => {} },
        headerToggle: { value: false, onChange: () => {} },
        action: () => {},
        rowDensity: "compact",
      } satisfies NodeFor<"row">,
      { id: "nd", kind: "divider" } satisfies NodeFor<"divider">,
      { id: "nst", kind: "sectionTitle" } satisfies NodeFor<"sectionTitle">,
      {
        id: "nca",
        kind: "card",
        collapsible: true,
        defaultOpen: true,
        children: [],
      } satisfies NodeFor<"card">,
      {
        id: "nm",
        kind: "material-row",
        eye: { get: () => true, set: () => {} },
        opacity: { get: () => 100, set: () => {} },
      } satisfies NodeFor<"material-row">,
      { id: "nct", kind: "controls", controls: [] } satisfies NodeFor<"controls">,
      {
        id: "ncu",
        kind: "custom",
        renderCustom: () => {},
        action: () => {},
        danger: true,
      } satisfies NodeFor<"custom">,
    ];
    // 防门空转：覆盖全部 16 kind（新增 kind 未纳入本表即数量不符）
    const kinds = new Set(nodes.map((n) => n.kind));
    expect(kinds.size, "应覆盖全部 PreviewMenuNodeKind").toBe(16);
    expect(validateNodeTree(nodes)).toEqual([]);
  });

  it("类型层负向：NodeFor<K> 拒绝该 kind 的契约外字段（指令失效即 tsc 直接报错）", () => {
    // 这些 @ts-expect-error 是**编译期断言**（运行时零成本）：若将来某 kind 的字段集被误放宽，
    // 指令变「未使用」→ tsc 报错 TS2578。
    //
    // ⚠️ 陷阱（2026-09 实证踩中）：tsconfig 开了 `exactOptionalPropertyTypes`，故**赋值 `undefined`
    // 本身就会报错**——若用 `control: undefined` 之类写法，指令被「拒绝 undefined」这个错满足，
    // 于是**无论字段归属对错都恒绿**（门空转）。故此处一律填**真值**，让唯一可能的错因就是
    // 「该字段不属于本 kind」的过量属性错误。负控验证见文件末注释。
    // @ts-expect-error control 非 folder 专有字段
    const a: NodeFor<"folder"> = { id: "a", kind: "folder", control: {} };
    // ⚠️ 多行字面量的过量属性错误报在**属性行**上，而 @ts-expect-error 只作用于紧邻下一行
    // （2026-09 实证：指令写在 const 行会让 const 行报 TS2578「未使用」、属性行报 TS2353 漏网）。
    const b: NodeFor<"slider"> = {
      id: "b",
      kind: "slider",
      // @ts-expect-error eye 仅 material-row 专有
      eye: { get: () => true, set: () => {} },
    };
    const c: NodeFor<"field"> = {
      id: "c",
      kind: "field",
      // @ts-expect-error radio 仅 row 专有
      radio: { active: true, title: "t", onClick: () => {} },
    };
    // @ts-expect-error controls 仅 controls kind 专有
    const d: NodeFor<"button"> = { id: "d", kind: "button", controls: [] };
    // @ts-expect-error collapsible 仅 card 专有
    const e: NodeFor<"folder"> = { id: "e", kind: "folder", collapsible: true };
    expect([a.kind, b.kind, c.kind, d.kind, e.kind]).toEqual([
      "folder",
      "slider",
      "field",
      "button",
      "folder",
    ]);
  });

  it("类型层负控铺满 16/16：每个 kind 各拒一个契约外字段（误放宽即 TS2578）", () => {
    // 与上一用例的分工：上例抽查几个 kind 并演示两处陷阱；本例把负控**铺满全部 kind**。
    // 理由：「某个 kind 的字段集被误放宽」不会触发任何其它门——`AssertCommonFieldIsExact` 只管
    // 公共侧；运行期交叉锁只保证「生产树不违反**当前**表」，对表本身被改宽零感知（ADR-302 §4）。
    // 故类型级负控是**该 kind 拒绝语义**的直接证据：拿它断言的**那个**字段去放宽该 kind 的字段集，
    // 指令即变「未使用」→ tsc 报 TS2578。
    // ⚠️ 边界（勿过度声称）：负控**只**覆盖「用被断言的那个字段放宽」这一种情形——2026-09 负控实证：
    // 给 slider 加 `radio` 时，断言 `opacity` 的指令仍绿。**任意放宽**的完整覆盖见上方「跨 kind 共用图
    // 恒等」用例（运行期）+ 编译期 `AssertCommonFieldIsExact` 与 `satisfies readonly (keyof
    // PreviewMenuNode)[]`，四者合起来穷举了全部改宽方式。
    // 值一律**真值**（禁 undefined，见 skills/pitfalls.md #21 规则 2）；多行字面量指令置属性行（规则 3）。
    const folder: NodeFor<"folder"> = {
      id: "neg-folder",
      kind: "folder",
      // @ts-expect-error radio 仅 row 专有
      radio: { active: true, title: "t", onClick: () => {} },
    };
    const panel: NodeFor<"panel"> = {
      id: "neg-panel",
      kind: "panel",
      // @ts-expect-error eye 仅 material-row 专有
      eye: { get: () => true, set: () => {} },
    };
    const action: NodeFor<"action"> = {
      id: "neg-action",
      kind: "action",
      // @ts-expect-error controls 仅 controls kind 专有
      controls: [],
    };
    const slider: NodeFor<"slider"> = {
      id: "neg-slider",
      kind: "slider",
      // @ts-expect-error opacity 仅 material-row 专有
      opacity: { get: () => 1, set: () => {} },
    };
    const toggle: NodeFor<"toggle"> = {
      id: "neg-toggle",
      kind: "toggle",
      // @ts-expect-error collapsible 仅 card 专有
      collapsible: true,
    };
    const select: NodeFor<"select"> = {
      id: "neg-select",
      kind: "select",
      // @ts-expect-error rowDensity 仅 button/row 专有
      rowDensity: "compact",
    };
    const color: NodeFor<"color"> = {
      id: "neg-color",
      kind: "color",
      // @ts-expect-error value 仅 field/row 专有
      value: "x",
    };
    const button: NodeFor<"button"> = {
      id: "neg-button",
      kind: "button",
      // @ts-expect-error controls 仅 controls kind 专有
      controls: [],
    };
    const fieldNode: NodeFor<"field"> = {
      id: "neg-field",
      kind: "field",
      // @ts-expect-error eye 仅 material-row 专有
      eye: { get: () => true, set: () => {} },
    };
    const row: NodeFor<"row"> = {
      id: "neg-row",
      kind: "row",
      // @ts-expect-error controls 仅 controls kind 专有
      controls: [],
    };
    const divider: NodeFor<"divider"> = {
      id: "neg-divider",
      kind: "divider",
      // @ts-expect-error divider 专有字段集为空（仅公共字段合法）
      value: "x",
    };
    const sectionTitle: NodeFor<"sectionTitle"> = {
      id: "neg-section-title",
      kind: "sectionTitle",
      // @ts-expect-error sectionTitle 专有字段集为空（仅公共字段合法）
      danger: true,
    };
    const card: NodeFor<"card"> = {
      id: "neg-card",
      kind: "card",
      // @ts-expect-error rowDensity 仅 button/row 专有
      rowDensity: "compact",
    };
    const materialRow: NodeFor<"material-row"> = {
      id: "neg-material-row",
      kind: "material-row",
      // @ts-expect-error radio 仅 row 专有
      radio: { active: true, title: "t", onClick: () => {} },
    };
    const controlsKind: NodeFor<"controls"> = {
      id: "neg-controls",
      kind: "controls",
      // @ts-expect-error value 仅 field/row 专有
      value: "x",
    };
    const custom: NodeFor<"custom"> = {
      id: "neg-custom",
      kind: "custom",
      // @ts-expect-error eye 仅 material-row 专有
      eye: { get: () => true, set: () => {} },
    };
    // 消费全部 16 条（兼防「删掉一条负控没人发现」）：每条窄类型都可赋回宽形态
    const all: Array<NodeFor<PreviewMenuNodeKind>> = [
      folder,
      panel,
      action,
      slider,
      toggle,
      select,
      color,
      button,
      fieldNode,
      row,
      divider,
      sectionTitle,
      card,
      materialRow,
      controlsKind,
      custom,
    ];
    expect(all, "负控必须铺满全部 kind，少一条即该 kind 失去唯一守卫").toHaveLength(16);
    expect(new Set(all.map((n) => n.kind)).size).toBe(16);
  });

  it("类型层正向：公共字段与各 kind 合法专有字段均被接受，且窄类型可赋回宽别名", () => {
    const folder: NodeFor<"folder"> = {
      id: "a",
      kind: "folder",
      label: "plain",
      settingsOrder: 1,
      children: [],
    };
    const row: NodeFor<"row"> = { id: "b", kind: "row", value: 1, rowDensity: "compact" };
    const custom: NodeFor<"custom"> = {
      id: "c",
      kind: "custom",
      renderCustom: () => {},
      danger: true,
    };
    expect([folder.kind, row.kind, custom.kind]).toEqual(["folder", "row", "custom"]);
    // 走法丙前提：既有无处不在的宽别名不被改动，窄类型仅是「可选前哨」
    const widened: PreviewMenuNode[] = [folder, row, custom];
    expect(widened).toHaveLength(3);
  });
});

// ===================================================================
// ④ 契约表自身的完整性——「单一事实源」闭环的另一半
// ===================================================================
describe("契约表完整性（ADR-302 单一事实源闭环）", () => {
  it("形状前置字段（children/defaultOpen/headerToggle）对任意 kind 合法——P1 误报修复锁", () => {
    // 锁定一个**真被踩到的误报**（2026-09 实证）：形状前置判定
    // `kind==="folder" || Array.isArray(children)` 刻意与 kind 脱钩（ADR-240），
    // 任何带 children 的节点都先于 kind 分派被 rmAppendFolder 接管，而它无条件读
    // defaultOpen/headerToggle。故这三个字段属**通用字段**：留在逐 kind 白名单会对其余 kind 误报。
    expect(
      validateNode({
        id: "p",
        kind: "panel",
        children: [],
        defaultOpen: false,
        headerToggle: { value: true, onChange: () => {} },
      }),
    ).toEqual([]);
    expect(validateNode({ id: "r", kind: "row", children: [], defaultOpen: true })).toEqual([]);
    expect(validateNode({ id: "a", kind: "action", children: [] })).toEqual([]);
    expect(validateNode({ id: "cu", kind: "custom", children: [], defaultOpen: true })).toEqual([]);
  });

  it("编译期：推导公共集恰为 ExpectedCommonField（新字段未登记归属即在此报错）", () => {
    // 类型级断言（运行期恒真）：若给 PreviewMenuNode 新增字段却既不入任何 kind、
    // 也不进 COMMON_NODE_FIELDS，它会静默落进推导公共集 → 类型不再等于 true →
    // 下列赋值编译失败，且错误信息直接指出缺哪些/多了哪些字段名。
    const exact: AssertCommonFieldIsExact = true;
    expect(exact).toBe(true);
  });
});
