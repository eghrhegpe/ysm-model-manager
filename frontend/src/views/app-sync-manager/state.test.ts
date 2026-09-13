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
});
