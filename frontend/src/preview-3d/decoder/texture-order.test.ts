// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildOrderedTexKeys } from "./texture-order.ts";

// 纹理序口径（2026-08-10 统一）：与 Go 端 texture_order.go 对称。
// 声明序 + default_texture 置首 / 无声明序按尺寸降序。

const match = (tn: string) => (Object.hasOwn({ arrow: 1, default: 1, default2: 1, texture: 1 }, tn) ? tn : null);

describe("buildOrderedTexKeys 声明序 + default_texture 置首", () => {
  it("声明序与文件序不同时，default_texture 置首", () => {
    const keys = buildOrderedTexKeys({
      texKeys: ["arrow", "default", "default2"],
      areaOf: () => 0,
      ysmTexOrder: ["arrow.png", "default.png", "default2.png"],
      ysmDefaultTex: "default.png",
      matchTexKey: match,
    });
    expect(keys).toEqual(["default", "arrow", "default2"]);
  });

  it("default_texture 已是首位时不重复移动", () => {
    const keys = buildOrderedTexKeys({
      texKeys: ["default", "arrow"],
      areaOf: () => 0,
      ysmTexOrder: ["default.png", "arrow.png"],
      ysmDefaultTex: "default.png",
      matchTexKey: match,
    });
    expect(keys).toEqual(["default", "arrow"]);
  });

  it("只保留声明中的纹理（排除头像/预览图）", () => {
    const keys = buildOrderedTexKeys({
      texKeys: ["arrow", "avatar", "default"],
      areaOf: () => 0,
      ysmTexOrder: ["arrow.png", "default.png"],
      ysmDefaultTex: null,
      matchTexKey: match,
    });
    expect(keys).toEqual(["arrow", "default"]);
  });
});

describe("buildOrderedTexKeys 无声明序（加密模型）按尺寸降序", () => {
  it("主纹理（最大）置首", () => {
    const keys = buildOrderedTexKeys({
      texKeys: ["arrow", "texture"],
      areaOf: (k) => (k === "texture" ? 512 * 512 : 64 * 64),
      ysmTexOrder: undefined,
      ysmDefaultTex: null,
      matchTexKey: match,
    });
    expect(keys).toEqual(["texture", "arrow"]);
  });

  it("尺寸相同时保持收集序（稳定）", () => {
    const keys = buildOrderedTexKeys({
      texKeys: ["a", "b"],
      areaOf: () => 256 * 256,
      ysmTexOrder: undefined,
      ysmDefaultTex: null,
      matchTexKey: match,
    });
    expect(keys).toEqual(["a", "b"]);
  });

  it("空声明数组视为无声明 → 尺寸降序", () => {
    const keys = buildOrderedTexKeys({
      texKeys: ["arrow", "texture"],
      areaOf: (k) => (k === "texture" ? 512 * 512 : 64 * 64),
      ysmTexOrder: [],
      ysmDefaultTex: null,
      matchTexKey: match,
    });
    expect(keys).toEqual(["texture", "arrow"]);
  });

  it("default_texture 不在声明中时不移动", () => {
    const keys = buildOrderedTexKeys({
      texKeys: ["arrow", "texture"],
      areaOf: () => 0,
      ysmTexOrder: ["arrow.png", "texture.png"],
      ysmDefaultTex: "missing.png",
      matchTexKey: match,
    });
    expect(keys).toEqual(["arrow", "texture"]);
  });

  it("声明元素为 {uv} 对象时同样匹配", () => {
    const keys = buildOrderedTexKeys({
      texKeys: ["texture", "arrow"],
      areaOf: () => 0,
      ysmTexOrder: [{ uv: "texture.png" }, { uv: "arrow.png" }],
      ysmDefaultTex: "texture.png",
      matchTexKey: match,
    });
    expect(keys).toEqual(["texture", "arrow"]);
  });

  it("声明元素为 {path} 对象时同样匹配", () => {
    const keys = buildOrderedTexKeys({
      texKeys: ["arrow", "texture"],
      areaOf: () => 0,
      ysmTexOrder: [{ path: "arrow.png" }, { path: "texture.png" }],
      ysmDefaultTex: "texture.png",
      matchTexKey: match,
    });
    expect(keys).toEqual(["texture", "arrow"]);
  });

  it("matchTexKey 全不命中时返回空列表（不崩）", () => {
    const keys = buildOrderedTexKeys({
      texKeys: ["arrow", "texture"],
      areaOf: () => 0,
      ysmTexOrder: ["xxx.png", "yyy.png"],
      ysmDefaultTex: null,
      matchTexKey: match,
    });
    expect(keys).toEqual([]);
  });

  it("areaOf 全 0（尺寸不可解）→ 稳定保持收集序", () => {
    const keys = buildOrderedTexKeys({
      texKeys: ["arrow", "texture"],
      areaOf: () => 0,
      ysmTexOrder: undefined,
      ysmDefaultTex: null,
      matchTexKey: match,
    });
    expect(keys).toEqual(["arrow", "texture"]);
  });
});
