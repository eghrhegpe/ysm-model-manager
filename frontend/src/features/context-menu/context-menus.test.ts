// @vitest-environment node
// ===== context-menus 映射测试（ADR-021 A 层）— 声明/点击/visibleWhen/divider 段 =====
// 触发 ctx:show → 断言 menu:show 载荷与 menu-defs.ts 声明一致；
// 点击 item → 断言 handler 发出正确的 bus 事件 / getApp 调用。
//
// ⚠️ ADR-187 D5 修订（2026-09-05）：vitest isolate:true（vitest.config.ts L26，
// 2026-08-22 迁移）下每文件独立 worker + 模块图，拆分无跨文件时序耦合——
// 原「isolate:false 全局时序耦合」例外依据在配置层已失效。1076 行拆 3 文件：
//   - context-menus.setup.ts：mock 矩阵 + DOM stub + bus 收集数组唯一事实源
//   - 本文件：四类菜单声明 + 点击行为 + visibleWhen + divider 折叠（同步域）
//   - context-menus-async.test.ts：异步 handler + 失败路径（动态 import 域）
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { stubConsoleWarn } from "@/test-utils/mock-log.ts";
// ⚠️ setup 必须最先 import：其顶层 vi.mock 需在 context-menus.ts 树（静态加载
// backend/app.ts）之前注册，否则 mock 晚于真实解析而失效（vitest 不 hoist 非测试文件）。
import "./context-menus.setup.ts";
import { bus } from "@/bus";
import type { MenuItem, CtxShowPayload, ToastPayload } from "@/bus";
import { registerContextMenus } from "./context-menus.ts";
import { MENU_DEFS, type MenuItemDef, type MenuAction } from "./menu-defs.ts";
import { HANDLERS, createContextMenuHandlers } from "./context-menu-handlers.ts";
import { RESOURCE_TYPES } from "@/utils/resource/types.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import {
  getMocks,
  menuShows,
  emitted,
  menuUnsubs,
  TRACKED,
  resetForCase,
  showMenu,
  payloadCtx,
  expectItemsMatchDef,
} from "./context-menus.setup.ts";

const { openFolderMock, isViewerModeMock, canMock } = getMocks();

// bus 订阅 + 菜单注册（setup.ts 不持有生命周期钩子——vitest 钩子须在测试文件注册）
beforeAll(() => {
  bus.on("menu:show", (p) => menuShows.push(p));
  TRACKED.forEach((e) => bus.on(e, (p) => emitted.push({ e, p })));
  registerContextMenus(menuUnsubs);
});

afterAll(() => {
  menuUnsubs.forEach((fn) => fn());
  vi.unstubAllGlobals();
});

beforeEach(() => {
  resetForCase();
});

describe("registerContextMenus 四类菜单声明", () => {
  it("instance：items 载荷与 MENU_DEFS 一致（含动态标题）", () => {
    const payload = showMenu("instance", payloadCtx("instance"));
    expectItemsMatchDef(payload, "instance");
  });

  it("batch：items 载荷与 MENU_DEFS 一致（含 count 动态标题）", () => {
    const payload = showMenu("batch", payloadCtx("batch"));
    expectItemsMatchDef(payload, "batch");
  });

  it("file：items 载荷与 MENU_DEFS 一致", () => {
    const payload = showMenu("file", payloadCtx("file"));
    expectItemsMatchDef(payload, "file");
  });

  it("dir：items 载荷与 MENU_DEFS 一致", () => {
    const payload = showMenu("dir", payloadCtx("dir"));
    expectItemsMatchDef(payload, "dir");
  });

  it("workshop：items 载荷与 MENU_DEFS 一致（4 条展示项全 header kind，noop 假动作已退役）", () => {
    const payload = showMenu("workshop", payloadCtx("workshop"));
    expectItemsMatchDef(payload, "workshop");
  });

  it("MENU_DEFS 覆盖全部五种类型", () => {
    const types = MENU_DEFS.map((d) => d.type);
    expect(types.sort()).toEqual(["batch", "dir", "file", "instance", "workshop"]);
  });

  it("MENU_DEFS 全部 action 均注册 handler（零失配警告）", async () => {
    // ADR-021 B 层：菜单即数据；测试应断言零警告——防新增菜单项忘挂 HANDLERS
    const { HANDLERS: handlers } = await import("./context-menu-handlers.ts");
    const declared = new Set<string>();
    for (const def of MENU_DEFS) {
      for (const it of def.items) {
        if (it.kind === "action") declared.add(it.action);
      }
    }
    const registered = new Set(Object.keys(handlers));
    const missing = [...declared].filter((a) => !registered.has(a));
    expect(missing, `menu-defs.ts 声明但未挂 handler 的 action: ${missing.join(", ")}`).toEqual([]);

    const warnSpy = stubConsoleWarn();
    try {
      MENU_DEFS.forEach((def) => {
        menuShows.length = 0; // showMenu 断言每次触发恰好 1 条 menu:show
        const payload = showMenu(def.type, payloadCtx(def.type));
        expect(payload.items).toHaveLength(def.items.length);
      });
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("查看器模式 → 仅保留纯前端动作（file 菜单只留 copy-path）", () => {
    isViewerModeMock.mockReturnValue(true);
    try {
      const payload = showMenu("file", payloadCtx("file"));
      const actions = payload.items.filter((i) => i.action).map((i) => i.action);
      expect(actions).toEqual(["file.copy-path"]);
    } finally {
      isViewerModeMock.mockReturnValue(false);
    }
  });

  it("查看器模式 → batch 菜单剔除调 Wails binding 的动作（标题项无 action，不参与过滤）", () => {
    isViewerModeMock.mockReturnValue(true);
    try {
      const payload = showMenu("batch", payloadCtx("batch"));
      const actions = payload.items.filter((i) => i.action).map((i) => i.action);
      expect(actions).toEqual(["batch.copy-paths", "batch.export-list"]);
    } finally {
      isViewerModeMock.mockReturnValue(false);
    }
  });

  it("查看器模式 → web 已实现 binding 的移动/复制放行（can 探测 true，P0 翻案）", () => {
    isViewerModeMock.mockReturnValue(true);
    canMock.mockReturnValue(true);
    try {
      // file 菜单：file.move/file.copy（MoveModelFile/CopyModelFile binding 已实现）出现
      const filePayload = showMenu("file", payloadCtx("file"));
      const fileActions = filePayload.items.filter((i) => i.action).map((i) => i.action);
      expect(fileActions).toEqual(
        expect.arrayContaining([
          "file.move",
          "file.copy",
          "file.rename",
          "file.edit-tags",
          "file.copy-path",
        ]),
      );
      // batch 菜单：batch.move/batch.copy（runBatchFileOp 走同一 binding）出现
      menuShows.length = 0; // showMenu 断言每次恰好 1 条 menu:show，触发前清空
      const batchPayload = showMenu("batch", payloadCtx("batch"));
      const batchActions = batchPayload.items.filter((i) => i.action).map((i) => i.action);
      expect(batchActions).toEqual(
        expect.arrayContaining([
          "batch.move",
          "batch.copy",
          "batch.copy-paths",
          "batch.export-list",
        ]),
      );
    } finally {
      canMock.mockReturnValue(false);
      isViewerModeMock.mockReturnValue(false);
    }
  });
});

describe("菜单项点击行为", () => {
  /** 取某类菜单中 action 匹配的 item，触发 onClick */
  function clickItem(
    type: CtxShowPayload["type"],
    action: string,
    overrides: Partial<CtxShowPayload> = {},
  ): MenuItem {
    const payload = showMenu(type, { ...payloadCtx(type), ...overrides });
    const item = payload.items.find((i) => i.action === action);
    expect(item, `找不到菜单项: ${action}`).toBeTruthy();
    item!.onClick!();
    return item!;
  }

  it("instance 复制模型清单 → instance:export-list", () => {
    clickItem("instance", "instance.export-list");
    expect(emitted).toContainEqual({
      e: "instance:export-list",
      p: { name: "测试整合包", rtype: RESOURCE_TYPES.YSM },
    });
  });

  it("instance 清空模型（danger）→ instance:clear", () => {
    const item = clickItem("instance", "instance.clear");
    expect(item.danger).toBe(true);
    expect(emitted).toContainEqual({
      e: "instance:clear",
      p: { name: "测试整合包", rtype: RESOURCE_TYPES.YSM },
    });
  });

  it("instance 打开文件夹 → getApp().OpenInstanceFolder", async () => {
    const payload = showMenu("instance", { ...payloadCtx("instance"), path: "/packs/x" });
    const item = payload.items.find((i) => i.action === "instance.open-folder");
    item!.onClick!();
    await vi.waitFor(() => expect(openFolderMock).toHaveBeenCalled());
    // 阶段 1：subdir 透传（MMD 用途子目录；无则 ""）
    expect(openFolderMock).toHaveBeenCalledWith("/packs/x", RESOURCE_TYPES.YSM, "");
  });

  it("instance 打开文件夹 带 subdir → 透传到后端", async () => {
    const payload = showMenu("instance", {
      ...payloadCtx("instance"),
      path: "/packs/x",
      subdir: "SceneModel",
    });
    const item = payload.items.find((i) => i.action === "instance.open-folder");
    item!.onClick!();
    await vi.waitFor(() => expect(openFolderMock).toHaveBeenCalled());
    expect(openFolderMock).toHaveBeenCalledWith("/packs/x", RESOURCE_TYPES.YSM, "SceneModel");
  });

  it("batch 批量重命名 → batch:rename（paths 透传）", () => {
    clickItem("batch", "batch.rename", { paths: ["/a.ysm", "/b.ysm"] });
    expect(emitted).toContainEqual({
      e: "batch:rename",
      p: { paths: ["/a.ysm", "/b.ysm"] },
    });
  });

  it("dir 重命名 → dir:rename（dir 透传）", () => {
    clickItem("dir", "dir.rename", { dir: "/packs/x" });
    expect(emitted).toContainEqual({ e: "dir:rename", p: { dir: "/packs/x" } });
  });

  it("dir 新建子文件夹 → dir:mkdir", () => {
    clickItem("dir", "dir.mkdir", { dir: "/packs/x" });
    expect(emitted).toContainEqual({ e: "dir:mkdir", p: { dir: "/packs/x" } });
  });

  it("dir 移入回收站（danger）→ dir:recycle", () => {
    const item = clickItem("dir", "dir.recycle", { dir: "/packs/x" });
    expect(item.danger).toBe(true);
    expect(emitted).toContainEqual({ e: "dir:recycle", p: { dir: "/packs/x" } });
  });

  it("dir 批量重命名 → dir:batch-rename", () => {
    clickItem("dir", "dir.batch-rename", { dir: "/packs/x" });
    expect(emitted).toContainEqual({ e: "dir:batch-rename", p: { dir: "/packs/x" } });
  });

  it("instance 打开文件夹 无 path → error toast 且不调后端", () => {
    clickItem("instance", "instance.open-folder");
    expect(openFolderMock).not.toHaveBeenCalled();
    expect(
      emitted.some(
        (e) =>
          e.e === "toast:show" &&
          (e.p as ToastPayload).type === "error" &&
          (e.p as ToastPayload).msg.includes("整合包目录未找到"),
      ),
    ).toBe(true);
  });

  // P0 修复：多类型 rtype 菜单行为测试——防 fallback 到 YSM
  it("instance MMD 打开文件夹 → 透传 EntityPlayer rtype", async () => {
    const payload = showMenu("instance", {
      ...payloadCtx("instance"),
      rtype: RESOURCE_TYPES.MMD,
      path: "/packs/mmd-pack",
    });
    const item = payload.items.find((i) => i.action === "instance.open-folder");
    item!.onClick!();
    await vi.waitFor(() => expect(openFolderMock).toHaveBeenCalled());
    expect(openFolderMock).toHaveBeenCalledWith("/packs/mmd-pack", RESOURCE_TYPES.MMD, "");
  });

  it("instance 复制模型清单 → 透传 rtype", () => {
    clickItem("instance", "instance.export-list", {
      rtype: "EntityPlayer",
    });
    expect(emitted).toContainEqual({
      e: "instance:export-list",
      p: { name: "测试整合包", rtype: "EntityPlayer" },
    });
  });

  it("instance 清空模型 → 透传 rtype（非 YSM）", () => {
    clickItem("instance", "instance.clear", {
      rtype: "resourcepack",
    });
    expect(emitted).toContainEqual({
      e: "instance:clear",
      p: { name: "测试整合包", rtype: "resourcepack" },
    });
  });
});

// ===== 节点级 visibleWhen（ADR-021 B 层扩展，与 PreviewMenuNode.visibleWhen 同构）=====
// 通过临时 push 一条带 visibleWhen 的项验证 filter 行为，测完 pop 保持全局清洁。
// MENU_DEFS 是普通 const 数组（TS 未加 readonly），可运行时 mutate。
// HANDLERS 同理：临时塞 dummy handler 让 action 不触发 console.warn（filter 测试只关心 items）。
describe("声明式菜单节点级 visibleWhen（菜单即数据 P1 扩展）", () => {
  const PROBE_ACTION = "__test_probe_visibleWhen__";
  const PROBE_DEF_TYPE = "batch" as const;
  let probeIndex = -1;

  function pushProbe(visibleWhen: ((ctx: CtxShowPayload) => boolean) | undefined) {
    const def = MENU_DEFS.find((d) => d.type === PROBE_DEF_TYPE);
    if (!def) throw new Error("missing batch def");
    def.items.push({
      kind: "action",
      // 探针 action 不属于 MENU_ACTIONS：显式越界（as MenuAction）注入运行时探针，
      // 与下方 HANDLERS`as Record<string, unknown>` 逃生舱同一模式，测完 pop 清理。
      action: PROBE_ACTION as MenuAction,
      label: () => "probe",
      icon: "info",
      ...(visibleWhen ? { visibleWhen } : {}),
    });
    probeIndex = def.items.length - 1;
    // 占位 handler：消除 filter 链路里 action 失配警告，filter 测试只关心 items 是否出现
    (HANDLERS as Record<string, unknown>)[PROBE_ACTION] = () => {};
  }

  function popProbe() {
    const def = MENU_DEFS.find((d) => d.type === PROBE_DEF_TYPE);
    if (def && probeIndex >= 0) {
      def.items.splice(probeIndex, 1);
      probeIndex = -1;
    }
    // 直接操作 HANDLERS：不在模块顶层捕获 originalHandler（加载时 probe 未注入，恒为 undefined）
    delete (HANDLERS as Record<string, unknown>)[PROBE_ACTION];
  }

  function actionsOf(payload: { items: MenuItem[] }): string[] {
    return payload.items.filter((i) => i.action).map((i) => i.action!);
  }

  afterEach(popProbe);

  it("visibleWhen 返回 false → 该 item 不出现", () => {
    pushProbe(() => false);
    const payload = showMenu("batch", payloadCtx("batch"));
    expect(actionsOf(payload)).not.toContain(PROBE_ACTION);
  });

  it("visibleWhen 返回 true → 该 item 出现", () => {
    pushProbe(() => true);
    const payload = showMenu("batch", payloadCtx("batch"));
    expect(actionsOf(payload)).toContain(PROBE_ACTION);
  });

  it("visibleWhen 未定义 → 行为不变（保留项，与既有契约一致）", () => {
    pushProbe(undefined);
    const payload = showMenu("batch", payloadCtx("batch"));
    expect(actionsOf(payload)).toContain(PROBE_ACTION);
  });

  it("visibleWhen 吃 ctx 快照 → count=0 时隐藏、count=3 时显示", () => {
    pushProbe((ctx) => (ctx.count ?? 0) > 1);
    const hidden = showMenu("batch", { x: 10, y: 20, type: "batch", paths: [], count: 0 });
    expect(actionsOf(hidden)).not.toContain(PROBE_ACTION);
    menuShows.length = 0;
    const shown = showMenu("batch", payloadCtx("batch"));
    expect(actionsOf(shown)).toContain(PROBE_ACTION);
  });

  it("visibleWhen 与 viewer-mode 守卫 AND：visibleWhen=true 但 viewer-mode 拒 → 仍被拒（验证第二关独立生效）", () => {
    // pushProbe(action=__test_probe...) 不在 VIEWER_OK_ACTIONS 白名单也不在
    // VIEWER_WEB_ACTION_BINDINGS；visibleWhen=true（放行）+ viewer=true + can=false
    // → 仅 viewer-mode 守卫能拒；若仍被拒 = AND 关系正确（两关都生效）。
    pushProbe(() => true);
    isViewerModeMock.mockReturnValue(true);
    canMock.mockReturnValue(false);
    try {
      const payload = showMenu("batch", payloadCtx("batch"));
      expect(actionsOf(payload)).not.toContain(PROBE_ACTION);
    } finally {
      isViewerModeMock.mockReturnValue(false);
    }
  });

  it("visibleWhen 抛异常 → 被吞、按不可见处理、不炸整条菜单（护栏）", () => {
    const warnSpy = stubConsoleWarn();
    try {
      // 故意访问 undefined.bar 抛 TypeError
      pushProbe((ctx) => (ctx as unknown as { bar: { baz: boolean } }).bar.baz);
      let payload!: { items: MenuItem[] };
      expect(() => {
        payload = showMenu("batch", payloadCtx("batch"));
      }).not.toThrow(); // 异常被 isItemVisible 兜底，不应炸出
      expect(actionsOf(payload)).not.toContain(PROBE_ACTION); // 抛异常的 item 按不可见剔除
      expect(warnSpy).toHaveBeenCalled(); // 应发 warn 便于定位
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ===== file.rename 的 ysm.json visibleWhen 守卫（ADR-038 D3 声明化）=====
// 原实现：handler 内 toast 教育（file-handlers.ts）——教育反模式，且后端
// （Go fileops.RenameFile / web-fs.ts）本就硬拒。守卫上移声明层：菜单直接不给死动作。
describe("file.rename 的 ysm.json visibleWhen 守卫", () => {
  function actionsOf(payload: { items: MenuItem[] }): string[] {
    return payload.items.filter((i) => i.action).map((i) => i.action!);
  }

  it("path 以 ysm.json 结尾 → file.rename 不出现（大小写不敏感）", () => {
    const payload = showMenu("file", {
      x: 10,
      y: 20,
      type: "file",
      path: "/models/模型A/YSM.JSON",
      paths: ["/models/模型A/YSM.JSON"],
    });
    expect(actionsOf(payload)).not.toContain("file.rename");
  });

  it("普通文件 → file.rename 正常出现", () => {
    const payload = showMenu("file", payloadCtx("file"));
    expect(actionsOf(payload)).toContain("file.rename");
  });
});

// ===== buildMenuItems divider 折叠（ADR-021 B 层：单一事实源收口，渲染层不再去重）=====
// 背景：context-menus.ts 旧注释声称「连续 divider 会在渲染时折叠」，但渲染层
// views/context-menu/index.ts 的 show() 仅 item.divider → <hr>，无折叠逻辑。
// 折叠已收敛至 buildMenuItems（菜单即数据），此处断言：最终 items 首尾不为 divider、
// 任意相邻两元素不同时为 divider。
describe("buildMenuItems divider 折叠（单一事实源收口）", () => {
  const PROBE_TYPE = "__test_divider_fold__" as unknown as CtxShowPayload["type"];

  function pushDef(items: MenuItemDef[]) {
    MENU_DEFS.push({ type: PROBE_TYPE, items });
  }
  function popDef() {
    const i = MENU_DEFS.findIndex((d) => d.type === PROBE_TYPE);
    if (i >= 0) MENU_DEFS.splice(i, 1);
  }
  afterEach(popDef);

  /** 断言：无首/尾 divider、无相邻 divider */
  function assertDividersCollapsed(items: MenuItem[]) {
    for (let i = 0; i < items.length; i++) {
      if (!items[i].divider) continue;
      expect(i, `divider 不应位于首/尾 (index ${i}/${items.length})`).not.toBe(0);
      expect(i, `divider 不应位于首/尾 (index ${i}/${items.length})`).not.toBe(items.length - 1);
      expect(items[i - 1]?.divider, `相邻 divider 未折叠 (index ${i})`).toBeFalsy();
      expect(items[i + 1]?.divider, `相邻 divider 未折叠 (index ${i})`).toBeFalsy();
    }
  }

  it("数据中连续 divider → 全部折叠（冗余相邻消除）", () => {
    pushDef([
      { kind: "header", label: () => "A" },
      { kind: "divider" },
      { kind: "divider" },
      { kind: "header", label: () => "B" },
    ]);
    const payload = showMenu(PROBE_TYPE);
    assertDividersCollapsed(payload.items);
    expect(payload.items).toHaveLength(2); // 仅 A、B
  });

  it("首/尾 divider → 移除，中间单 divider 保留", () => {
    pushDef([
      { kind: "divider" },
      { kind: "header", label: () => "A" },
      { kind: "divider" },
      { kind: "header", label: () => "B" },
      { kind: "divider" },
    ]);
    const payload = showMenu(PROBE_TYPE);
    assertDividersCollapsed(payload.items);
    // [div, A, div, B, div] → [A, div, B]
    expect(payload.items).toHaveLength(3);
    expect(payload.items[0].divider).toBeFalsy();
    expect(payload.items[1].divider).toBe(true);
    expect(payload.items[2].divider).toBeFalsy();
  });

  it("visibleWhen 隐藏相邻项 → 原本不相邻的 divider 变相邻并折叠", () => {
    // 隐藏项必须是 action kind（visibleWhen 只活在 action 分支）；借用真实已注册
    // action（file.copy-path）避免触发失配 console.warn
    pushDef([
      { kind: "header", label: () => "A" },
      { kind: "divider" },
      { kind: "action", action: "file.copy-path", label: () => "B", visibleWhen: () => false },
      { kind: "divider" },
      { kind: "header", label: () => "C" },
    ]);
    const payload = showMenu(PROBE_TYPE);
    assertDividersCollapsed(payload.items);
    const labels = payload.items.filter((i) => !i.divider).map((i) => i.label);
    expect(labels).toEqual(["A", "C"]); // B 被隐藏，两个 divider 相邻折叠为无
  });
});

describe("createContextMenuHandlers — 独立 handlers 实例隔离", () => {
  it("两个实例的 busy 锁互不干扰", () => {
    const handlersA = createContextMenuHandlers();
    const handlersB = createContextMenuHandlers();
    expect(handlersA.HANDLERS).not.toBe(handlersB.HANDLERS);
    // 两个实例应有相同的 action 键
    expect(Object.keys(handlersA.HANDLERS).sort()).toEqual(Object.keys(handlersB.HANDLERS).sort());
  });

  it("实例包含所有 MENU_ACTIONS 的 handler", () => {
    const { HANDLERS } = createContextMenuHandlers();
    expect(typeof HANDLERS["instance.open-folder"]).toBe("function");
    expect(typeof HANDLERS["batch.move"]).toBe("function");
    expect(typeof HANDLERS["batch.recycle"]).toBe("function");
    expect(typeof HANDLERS["file.rename"]).toBe("function");
    expect(typeof HANDLERS["dir.mkdir"]).toBe("function");
  });

  it("noop 假动作已退役（kind 判别后标题项不占 action 空间）", () => {
    const { HANDLERS } = createContextMenuHandlers();
    expect("noop" in HANDLERS).toBe(false);
    // 声明表中不得再有任何 action:"noop" 项——收集为 string 域再断言
    // （MenuAction 联合已无 noop，与 "noop" 直接比较会被 TS2367 拦下，正是退役的编译期证据）
    const actions: string[] = [];
    for (const def of MENU_DEFS) {
      for (const item of def.items) {
        if (item.kind === "action") actions.push(item.action);
      }
    }
    expect(actions).not.toContain("noop");
  });
});

// ===== ADR-245 守卫：menu-defs 的 icon 必须为 UI_ICONS 语义名（无彩色 emoji 残留）=====
// 扩展：label 也不得夹带 emoji——emoji 表意一律迁移到 icon 字段（如 workshop 信息行 📄→file）。
// EMOJI 只匹配 emoji/杂项符号频段（含变体选择符），放过 …—“”等合法排版标点与 CJK。
describe("ADR-245 — menu-defs icon 语义名化（无 emoji）", () => {
  const KNOWN = new Set(Object.keys(UI_ICONS));
  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/u;

  for (const def of MENU_DEFS) {
    for (const item of def.items) {
      if (item.kind === "divider") continue;
      if (item.icon) {
        const iconName = item.icon; // 收窄：闭包外固定，避免 TS 丢失收窄
        const idLabel = `${def.type}.${item.kind === "action" ? item.action : "header"}`;
        it(`${idLabel} icon="${iconName}" 为合法语义名`, () => {
          // emoji（非 ASCII 语义名）一律视为残留，须迁移为 UI_ICONS 语义名
          expect(KNOWN.has(iconName)).toBe(true);
          expect(iconName.match(/[^\x00-\x7F]/)).toBeNull();
        });
      }
      // label 求值防 emoji：用各类型的样例 ctx 渲染一次，断言结果无 emoji/图标字符
      const probeLabel = `${def.type}.${item.kind === "action" ? item.action : "header"}`;
      it(`${probeLabel} label 无 emoji 残留（表意走 icon 字段）`, () => {
        const rendered = item.label(payloadCtx(def.type));
        expect(EMOJI.test(rendered), `label 含 emoji 字符: ${rendered}`).toBe(false);
      });
    }
  }
});
