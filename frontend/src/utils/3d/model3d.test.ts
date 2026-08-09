// ===== 3D 操作偏好加载测试（model3d 纯函数层）=====
// 覆盖：键位/速度/旋转模式 localStorage 解析与回退、compKey 口径
import { describe, it, expect, beforeEach } from "vitest";
import {
  loadTdKeymap,
  loadTdCamSpeed,
  loadTdRotMode,
  compKey,
  DEFAULT_TD_KEYMAP,
} from "./model3d.ts";

beforeEach(() => {
  localStorage.clear();
});

describe("loadTdKeymap", () => {
  it("无存储 → 默认键位", () => {
    expect(loadTdKeymap()).toEqual(DEFAULT_TD_KEYMAP);
  });

  it("合法自定义键位 → 逐字段合并", () => {
    localStorage.setItem(
      "td-keymap",
      JSON.stringify({ forward: "KeyE", up: "KeyQ" }),
    );
    const m = loadTdKeymap();
    expect(m.forward).toBe("KeyE");
    expect(m.up).toBe("KeyQ");
    expect(m.back).toBe(DEFAULT_TD_KEYMAP.back); // 未覆盖字段保留默认
  });

  it("损坏 JSON → 回退默认", () => {
    localStorage.setItem("td-keymap", "{bad json");
    expect(loadTdKeymap()).toEqual(DEFAULT_TD_KEYMAP);
  });

  it("空字符串字段 → 忽略用默认", () => {
    localStorage.setItem("td-keymap", JSON.stringify({ forward: "" }));
    expect(loadTdKeymap().forward).toBe(DEFAULT_TD_KEYMAP.forward);
  });
});

describe("loadTdCamSpeed", () => {
  it("默认 20；合法值保留；越界/非数字回退", () => {
    expect(loadTdCamSpeed()).toBe(20);
    localStorage.setItem("td-cam-speed", "55");
    expect(loadTdCamSpeed()).toBe(55);
    localStorage.setItem("td-cam-speed", "1"); // < 2
    expect(loadTdCamSpeed()).toBe(20);
    localStorage.setItem("td-cam-speed", "999"); // > 200
    expect(loadTdCamSpeed()).toBe(20);
    localStorage.setItem("td-cam-speed", "abc");
    expect(loadTdCamSpeed()).toBe(20);
  });
});

describe("loadTdRotMode", () => {
  it("非 free → orbit；free → 自由旋转", () => {
    expect(loadTdRotMode()).toBe(true);
    localStorage.setItem("td-rot-mode", "orbit");
    expect(loadTdRotMode()).toBe(true);
    localStorage.setItem("td-rot-mode", "free");
    expect(loadTdRotMode()).toBe(false);
  });
});

describe("compKey", () => {
  it("mi:id 口径（多组件同名骨骼不冲突）", () => {
    expect(compKey(0, "body")).toBe("0:body");
    expect(compKey(2, "body")).toBe("2:body");
  });
});
