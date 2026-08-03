// ===== context-menus 映射测试（ADR-021 A 层）=====
// 触发 ctx:show → 断言 menu:show 载荷与 menu-defs.ts 声明一致；
// 点击 item → 断言 handler 发出正确的 bus 事件 / getApp 调用。
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { bus } from "../bus.ts";
import { registerContextMenus } from "./context-menus.ts";
import { MENU_DEFS, getMenuDef } from "./menu-defs.ts";

// getApp 是动态 import（wails/app.ts），测试用 mock 替代
const { openFolderMock } = vi.hoisted(() => ({
  openFolderMock: vi.fn(),
}));
vi.mock("../wails/app.ts", () => ({
  getApp: () => Promise.resolve({ OpenInstanceFolder: openFolderMock }),
}));

// 收集 menu:show 与 handler 发出的业务事件
const menuShows = [];
const emitted = [];
const TRACKED = [
  "instance:export-list",
  "instance:clear",
  "batch:rename",
  "dir:rename",
  "dir:batch-rename",
  "dir:mkdir",
  "dir:recycle",
  "toast:show",
];

beforeAll(() => {
  bus.on("menu:show", (p) => menuShows.push(p));
  TRACKED.forEach((e) => bus.on(e, (p) => emitted.push({ e, p })));
  registerContextMenus();
});

beforeEach(() => {
  menuShows.length = 0;
  emitted.length = 0;
  openFolderMock.mockClear();
});

/** 触发一次 ctx:show，返回对应的 menu:show 载荷 */
function showMenu(type, overrides = {}) {
  bus.emit("ctx:show", { x: 10, y: 20, type, paths: ["/a.ysm"], ...overrides });
  expect(menuShows).toHaveLength(1);
  return menuShows[0];
}

/** 断言 items 载荷与声明逐条一致（结构 + label 求值） */
function expectItemsMatchDef(payload, type) {
  const def = getMenuDef(type);
  expect(payload.x).toBe(10);
  expect(payload.y).toBe(20);
  expect(payload.items).toHaveLength(def.items.length);
  def.items.forEach((d, i) => {
    const item = payload.items[i];
    if (d.divider) {
      expect(item).toEqual({ divider: true });
      return;
    }
    expect(item.label).toBe(typeof d.label === "function" ? d.label(payloadCtx(type)) : d.label);
    expect(item.icon).toBe(d.icon);
    expect(item.danger).toBe(d.danger);
    expect(typeof item.onClick).toBe("function");
  });
}

/** 构造与声明 label 函数匹配的 ctx 上下文 */
function payloadCtx(type) {
  const base = { paths: ["/a.ysm"] };
  if (type === "instance") return { ...base, instanceName: "测试整合包", rtype: "ysm" };
  if (type === "batch") return { ...base, count: 3 };
  return base;
}

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

  it("MENU_DEFS 覆盖全部四种类型", () => {
    const types = MENU_DEFS.map((d) => d.type);
    expect(types.sort()).toEqual(["batch", "dir", "file", "instance"]);
  });
});

describe("菜单项点击行为", () => {
  /** 取某类菜单中 label 匹配的 item，触发 onClick */
  function clickItem(type, labelText, overrides = {}) {
    const payload = showMenu(type, { ...payloadCtx(type), ...overrides });
    const item = payload.items.find((i) => i.label === labelText);
    expect(item, `找不到菜单项: ${labelText}`).toBeTruthy();
    item.onClick();
    return item;
  }

  it("instance 复制模型清单 → instance:export-list", () => {
    clickItem("instance", "复制模型清单");
    expect(emitted).toContainEqual({
      e: "instance:export-list",
      p: { name: "测试整合包", rtype: "ysm" },
    });
  });

  it("instance 清空模型（danger）→ instance:clear", () => {
    const item = clickItem("instance", "清空此整合包的模型");
    expect(item.danger).toBe(true);
    expect(emitted).toContainEqual({
      e: "instance:clear",
      p: { name: "测试整合包", rtype: "ysm" },
    });
  });

  it("instance 打开文件夹 → getApp().OpenInstanceFolder", async () => {
    const payload = showMenu("instance", { ...payloadCtx("instance"), path: "/packs/x" });
    const item = payload.items.find((i) => i.label === "打开文件夹");
    item.onClick();
    await vi.waitFor(() => expect(openFolderMock).toHaveBeenCalled());
    expect(openFolderMock).toHaveBeenCalledWith("/packs/x", "ysm");
  });

  it("batch 批量重命名 → batch:rename（paths 透传）", () => {
    clickItem("batch", "批量重命名...", { paths: ["/a.ysm", "/b.ysm"] });
    expect(emitted).toContainEqual({
      e: "batch:rename",
      p: { paths: ["/a.ysm", "/b.ysm"] },
    });
  });

  it("dir 重命名 → dir:rename（dir 透传）", () => {
    clickItem("dir", "重命名…", { dir: "/packs/x" });
    expect(emitted).toContainEqual({ e: "dir:rename", p: { dir: "/packs/x" } });
  });

  it("dir 新建子文件夹 → dir:mkdir", () => {
    clickItem("dir", "新建子文件夹…", { dir: "/packs/x" });
    expect(emitted).toContainEqual({ e: "dir:mkdir", p: { dir: "/packs/x" } });
  });

  it("dir 移入回收站（danger）→ dir:recycle", () => {
    const item = clickItem("dir", "移入回收站", { dir: "/packs/x" });
    expect(item.danger).toBe(true);
    expect(emitted).toContainEqual({ e: "dir:recycle", p: { dir: "/packs/x" } });
  });
});
