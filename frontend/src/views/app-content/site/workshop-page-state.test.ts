// ===== 创意工坊页作用域状态单测（ADR-263）=====
// 锁定「currentSite 下沉为页作用域单源」的契约：三个消费者（tabs 写、opener 读、
// init-workshop 的 showRepoModels 注入链读/写）共享**同一个**实例，杜绝「形状相同、
// 实例不同」的 stale 错位 bug——与 createWorkshopRefs 同族（同因同治）。
//
// 另锁定两条约束：
//  - currentSite 只住页作用域，不再借宿 AppContentState（结构性断言见 init-workshop.test.ts）；
//  - setCurrentSite(null) 必须立即对 getCurrentSite() 可见（showSiteView 的闭包守卫
//    读的是实时值，不是渲染时的快照）。
import { describe, it, expect } from "vitest";
import { createWorkshopPageState } from "./workshop-page-state.ts";

const siteA = { id: "bilibili", url: "https://bilibili.com", label: "B站" } as never;
const siteB = { id: "afdian", url: "https://afdian.com", label: "爱发电" } as never;

describe("createWorkshopPageState — currentSite 页作用域单源", () => {
  it("初始为空：页作用域不沿用上一次进入的站点", () => {
    const page = createWorkshopPageState();
    expect(page.getCurrentSite()).toBeNull();
  });

  it("set → get 往返：写入即读回同一引用", () => {
    const page = createWorkshopPageState();
    page.setCurrentSite(siteA);
    expect(page.getCurrentSite()).toBe(siteA);
  });

  it("覆盖写：切站点后读到新站点（单源，无副本残留）", () => {
    const page = createWorkshopPageState();
    page.setCurrentSite(siteA);
    page.setCurrentSite(siteB);
    expect(page.getCurrentSite()).toBe(siteB);
  });

  it("setCurrentSite(null) 立即对 getCurrentSite 可见（守卫读实时值，不读渲染快照）", () => {
    const page = createWorkshopPageState();
    page.setCurrentSite(siteA);
    page.setCurrentSite(null);
    expect(page.getCurrentSite()).toBeNull();
  });

  it("两个实例互不串扰（页作用域隔离；单源靠调用方共享同一实例）", () => {
    const p1 = createWorkshopPageState();
    const p2 = createWorkshopPageState();
    p1.setCurrentSite(siteA);
    expect(p2.getCurrentSite()).toBeNull();
  });

  it("引用身份稳定：getCurrentSite 是属性而非快照拷贝", () => {
    const page = createWorkshopPageState();
    page.setCurrentSite(siteA);
    const a = page.getCurrentSite();
    const b = page.getCurrentSite();
    expect(a).toBe(b);
    expect(a).toBe(siteA);
  });
});
