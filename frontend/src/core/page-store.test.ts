// ===== page-store 导航状态机测试（陷阱 #13 幽灵路径守护）=====
// 唯一写入点：registerPageStore 的 nav:changed listener；
// 页面名收窄为 PageName 联合（编译期拦截拼错，运行时信任 emit 方类型）。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { bus } from "../bus.ts";
import { PageStore, registerPageStore, resolveInitialPage } from "./page-store.ts";

describe("resolveInitialPage（localStorage 恢复）", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("无保存记录时回退仓库页", () => {
    expect(resolveInitialPage()).toBe("repository");
  });

  it("读取上次保存的页面", () => {
    localStorage.setItem("nav_page", "settings");
    expect(resolveInitialPage()).toBe("settings");
  });

  it("历史页面名 resources 映射回仓库页", () => {
    localStorage.setItem("nav_page", "resources");
    expect(resolveInitialPage()).toBe("repository");
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
});
