// app-sync-manager/state 直测（2026-09 锐评 P1 收口）：export let _lastSelectedType →
// getLastSelectedType/setLastSelectedType 闭包封装，验证存储双写与内存读一致。
import { beforeEach, describe, expect, it } from "vitest";
import {
  getLastSelectedType,
  LAST_TYPE_KEY,
  setLastSelectedType,
} from "./state.ts";
import { RESOURCE_TYPES } from "@/utils/resource/types.ts";

describe("sync-manager/state 类型焦点封装", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("setLastSelectedType 同步写内存 + 双存储键", () => {
    setLastSelectedType(RESOURCE_TYPES.MMD);
    expect(getLastSelectedType()).toBe(RESOURCE_TYPES.MMD);
    expect(localStorage.getItem("repo_rtype")).toBe(RESOURCE_TYPES.MMD);
    expect(localStorage.getItem(LAST_TYPE_KEY)).toBe(RESOURCE_TYPES.MMD);
  });

  it("未写入时兜底 YSM（模块初值语义）", () => {
    // 只要不 set 过本用例前状态，getter 永不返回空串
    const v = getLastSelectedType();
    expect(typeof v).toBe("string");
    expect(v.length).toBeGreaterThan(0);
  });

  // 2026-10 修复回归锁：权威源 = localStorage `repo_rtype`（app-nav 切换器直接写该键，
  // 不经本模块）。原实现用模块级缓存（import 时读一次），「面板未挂载期间用户在仓库页
  // 切类型」后缓存陈旧，再挂载时旧值还会盖过新鲜的 default-type 属性 → 面板按错类型拉数据。
  it("外部直接写 repo_rtype（app-nav 切换）→ getter 实读新值，不吃模块级陈旧缓存", () => {
    localStorage.setItem("repo_rtype", "shaderpack");
    expect(getLastSelectedType()).toBe("shaderpack");
  });

  it("外部写入后 set 仍以参数为准（双写不反向覆盖）", () => {
    localStorage.setItem("repo_rtype", "shaderpack");
    setLastSelectedType(RESOURCE_TYPES.MMD);
    expect(getLastSelectedType()).toBe(RESOURCE_TYPES.MMD);
    expect(localStorage.getItem("repo_rtype")).toBe(RESOURCE_TYPES.MMD);
  });
});
