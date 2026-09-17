// ===== 创作者头像 store 契约测试（ADR-264）=====
//
// 背景：`avatarCache` 曾借宿 `AppContentState`。借宿的问题是**寿命错配**——写入方是
// `download-queue-store`（模块级持久层，`Events.On` 脚本加载即注册，页面切换不丢事件），
// 而载体却是「页面级容器」的字段。为了不丢增量，工坊页只能把订阅挂进 global 桶，
// 等于让工坊页长期持有一张**跳页令牌**（离开工坊页后它仍在写自己的数据）。
//
// 本文件锁定上收后的三条契约：
//  1. 单源：所有消费者共享同一份状态，不存在「形状相同、实例不同」的副本；
//  2. 写入纪律：只能经导出写函数改，订阅者在 notify 时刻看到的是最新值；
//  3. 引用替换 vs 原地增量**两种写语义都被保留**（这是本 store 最易踩的坑，见下）。
//
// ⚠️ 为什么第 3 条是重点：原实现里
//   - `extractAvatars` 是 `avatarCache = avatars`（**整表引用替换**）
//   - `avatar:refresh` 是 `avatarCache[author] = dataUri`（**原地增量改写**）
// 而 `init-workshop.ts` 把 `avatarCache` **按值**注入渲染 ctx（`:137`）。整表替换后，
// 已渲染的旧 ctx 仍持旧对象引用——原实现靠「config-loaded 后重渲染」兜底，而非靠引用自动可见。
// 上收时若把两种语义合并成一种（例如统一浅拷贝），会静默改变这条既有可见性行为。
import { describe, it, expect, beforeEach } from "vitest";
import {
  getAvatarSnapshot,
  getAvatar,
  setAvatars,
  setAvatar,
  clearAvatars,
  subscribeAvatars,
} from "./creator-avatar-store.ts";

beforeEach(() => {
  clearAvatars();
});

describe("creator-avatar-store — 单源与读接口", () => {
  it("初始为空表（不沿用上一次会话的残留）", () => {
    expect(getAvatarSnapshot()).toEqual({});
    expect(getAvatar("张三")).toBeUndefined();
  });

  it("getAvatar 命中 / 未命中（未命中返回 undefined，供渲染层 ?? 兜底）", () => {
    setAvatar("张三", "data:image/png;base64,AAA");
    expect(getAvatar("张三")).toBe("data:image/png;base64,AAA");
    expect(getAvatar("李四")).toBeUndefined();
  });

  it("同一模块实例被多处消费：写后立即读回（单源，无副本错位）", () => {
    setAvatar("a", "u1");
    expect(getAvatarSnapshot().a).toBe("u1");
  });
});

describe("creator-avatar-store — 写入纪律与通知", () => {
  it("setAvatar 通知订阅者，回调收到含新值的快照", () => {
    const seen: Array<Record<string, string>> = [];
    subscribeAvatars((s) => seen.push({ ...s }));
    setAvatar("张三", "u1");
    expect(seen).toHaveLength(1);
    expect(seen[0].张三).toBe("u1");
  });

  it("setAvatars 整表替换并通知", () => {
    setAvatar("旧作者", "old");
    const seen: Array<Record<string, string>> = [];
    subscribeAvatars((s) => seen.push({ ...s }));
    setAvatars({ 甲: "u1", 乙: "u2" });
    expect(getAvatarSnapshot()).toEqual({ 甲: "u1", 乙: "u2" });
    expect(getAvatar("旧作者")).toBeUndefined(); // 整表替换，旧的被丢弃
    expect(seen).toHaveLength(1);
  });

  it("setAvatars 空表不覆盖已有值（保留上次已知头像，防「提取失败抹掉」）", () => {
    setAvatar("张三", "keep");
    setAvatars({});
    expect(getAvatar("张三")).toBe("keep");
  });

  it("unsubscribe 后不再收到通知", () => {
    const seen: number[] = [];
    const off = subscribeAvatars(() => seen.push(1));
    setAvatar("a", "u1");
    off();
    setAvatar("b", "u2");
    expect(seen).toHaveLength(1);
  });

  it("clearAvatars 清空并通知（组件重建 / 测试隔离）", () => {
    const seen: number[] = [];
    setAvatar("张三", "u1");
    subscribeAvatars(() => seen.push(1));
    clearAvatars();
    expect(getAvatarSnapshot()).toEqual({});
    expect(seen).toHaveLength(1);
  });
});

describe("creator-avatar-store — 两种写语义的引用行为（防静默回归）", () => {
  it("setAvatar 原地改写：已持有的快照引用同步可见（增量路径靠此立即生效）", () => {
    setAvatars({ 张三: "u1" });
    const before = getAvatarSnapshot();
    setAvatar("李四", "u2"); // 原地增量，不换对象
    expect(getAvatarSnapshot()).toBe(before); // 同一引用
    expect(before.李四).toBe("u2"); // 旧引用也看得到新值
  });

  it("setAvatars 引用替换：旧快照引用**看不到**新值（既有行为，靠重渲染兜底）", () => {
    setAvatars({ 张三: "u1" });
    const old = getAvatarSnapshot();
    setAvatars({ 甲: "new" }); // 整表替换，换对象
    expect(getAvatarSnapshot()).not.toBe(old);
    expect(old.甲).toBeUndefined(); // 旧引用仍是旧内容——与上收前一致
    expect(getAvatarSnapshot().甲).toBe("new");
  });

  it("getAvatarSnapshot 返回原始引用（非拷贝）——供渲染 ctx 按值注入时保持既有可见性", () => {
    setAvatars({ 张三: "u1" });
    const a = getAvatarSnapshot();
    const b = getAvatarSnapshot();
    expect(a).toBe(b);
  });
});
