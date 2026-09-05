// @vitest-environment node
// ===== page-store 导航状态机测试（陷阱 #13 幽灵路径守护）=====
// 唯一写入点：registerPageStore 的 nav:changed listener；
// 页面名收窄为 PageName 联合（编译期拦截拼错，运行时信任 emit 方类型）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bus, type PageName } from "../bus.ts";
import {
  isValidPage,
  PageStore,
  registerPageStore,
  resolveInitialPage,
} from "./page-store.ts";

/** 隐私模式模拟：localStorage 读抛错（复用 app-modules.test.ts 的 breakLocalStorage 模式） */
function breakLocalStorageRead(): () => void {
  const getSpy = vi.spyOn(localStorage, "getItem").mockImplementation(() => {
    throw new Error("denied");
  });
  return () => getSpy.mockRestore();
}

describe("resolveInitialPage（localStorage 恢复）", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("无保存记录时回退仓库页", () => {
    expect(resolveInitialPage()).toBe("repository");
  });

  it("设置项启动默认页优先于上次停留页", () => {
    localStorage.setItem("ui-default-page", "workshop");
    localStorage.setItem("nav_page", "settings");
    expect(resolveInitialPage()).toBe("workshop");
  });

  it("仅设置项存在时用设置项", () => {
    localStorage.setItem("ui-default-page", "instances");
    expect(resolveInitialPage()).toBe("instances");
  });

  it("无设置项时读取上次保存的页面", () => {
    localStorage.setItem("nav_page", "settings");
    expect(resolveInitialPage()).toBe("settings");
  });

  it("设置项 resources 历史名映射回仓库页", () => {
    localStorage.setItem("ui-default-page", "resources");
    expect(resolveInitialPage()).toBe("repository");
  });

  it("历史页面名 resources 映射回仓库页", () => {
    localStorage.setItem("nav_page", "resources");
    expect(resolveInitialPage()).toBe("repository");
  });

  it("未知值回退仓库页防死页（P2 修复：遗留/损坏 localStorage）", () => {
    localStorage.setItem("ui-default-page", "bogus");
    expect(resolveInitialPage()).toBe("repository");
    localStorage.clear();
    localStorage.setItem("nav_page", "");
    expect(resolveInitialPage()).toBe("repository");
  });

  it("隐私模式 localStorage 读抛错 → 回退仓库页（P3 修复：读路径 try/catch 防组件起不来）", () => {
    const restore = breakLocalStorageRead();
    try {
      expect(resolveInitialPage()).toBe("repository");
    } finally {
      restore();
    }
  });
});

describe("isValidPage 运行时守卫", () => {
  it("六页合法（与 PageName 联合同源——VALID_PAGES 是类型源）", () => {
    for (const p of ["repository", "instances", "workshop", "github", "diagnostics", "settings"]) {
      expect(isValidPage(p)).toBe(true);
    }
  });

  it("未知值 / 非字符串拒绝", () => {
    expect(isValidPage("bogus")).toBe(false);
    expect(isValidPage(null)).toBe(false);
    expect(isValidPage(undefined)).toBe(false);
    expect(isValidPage(42)).toBe(false);
  });
});

describe("PageStore 导航状态机", () => {
  const unsubs: Array<() => void> = [];

  beforeEach(() => {
    unsubs.length = 0;
    registerPageStore(unsubs);
    bus.emit("nav:changed", { page: "repository" }); // 重置状态基线
  });

  afterEach(() => {
    unsubs.forEach((fn) => fn());
    unsubs.length = 0;
  });

  it("初始为仓库页", () => {
    expect(PageStore.currentPage).toBe("repository");
  });

  it("nav:changed 广播后同步页面状态", () => {
    bus.emit("nav:changed", { page: "settings" });
    expect(PageStore.currentPage).toBe("settings");
  });

  it("同页重复广播幂等（状态不抖动）", () => {
    bus.emit("nav:changed", { page: "instances" });
    bus.emit("nav:changed", { page: "instances" });
    expect(PageStore.currentPage).toBe("instances");
  });

  it("退订后不再同步（生命周期配对）", () => {
    unsubs.pop()!();
    bus.emit("nav:changed", { page: "github" });
    expect(PageStore.currentPage).toBe("repository");
  });

  it("非法页 emit → 拒绝（状态不变，防兜底污染）", () => {
    bus.emit("nav:changed", { page: "settings" });
    bus.emit("nav:changed", { page: "bogus" as unknown as PageName });
    expect(PageStore.currentPage).toBe("settings");
  });

  it("null/undefined 页 emit → 拒绝（状态不变）", () => {
    bus.emit("nav:changed", { page: "github" });
    bus.emit("nav:changed", { page: null as unknown as PageName });
    expect(PageStore.currentPage).toBe("github");
  });

  it("广播侧历史名 resources → 拒绝（宽容映射只属启动恢复）", () => {
    bus.emit("nav:changed", { page: "instances" });
    bus.emit("nav:changed", { page: "resources" as unknown as PageName });
    expect(PageStore.currentPage).toBe("instances");
  });
});
