// ===== MMD 动画库路径解析与文件过滤 单元测试 =====
// 覆盖：filterAnimFiles（vmd/vpd 过滤/大小写/边界）
// @vitest-environment node

import { describe, it, expect } from "vitest";
import { filterAnimFiles } from "./mmd-anim-library";

// ---- filterAnimFiles ----
describe("filterAnimFiles", () => {
  it("筛选出 .vmd 文件", () => {
    const files = ["dance.vmd", "model.pmx", "skin.tga", "pose.vpd"];
    const result = filterAnimFiles(files);
    expect(result).toEqual(["dance.vmd", "pose.vpd"]);
  });

  it("筛选出 .vpd 文件", () => {
    const files = ["pose.vpd", "other.txt"];
    const result = filterAnimFiles(files);
    expect(result).toEqual(["pose.vpd"]);
  });

  it("大小写不敏感：.VMD / .Vpd 都能匹配", () => {
    const files = ["DANCE.VMD", "Pose.VPD", "pose.Vpd", "model.pmx"];
    const result = filterAnimFiles(files);
    expect(result).toEqual(["DANCE.VMD", "Pose.VPD", "pose.Vpd"]);
  });

  it("空数组返回空数组", () => {
    expect(filterAnimFiles([])).toEqual([]);
  });

  it("无匹配文件时返回空数组", () => {
    const files = ["model.pmx", "texture.tga", "config.json"];
    expect(filterAnimFiles(files)).toEqual([]);
  });

  it("全为动画文件时全部返回", () => {
    const files = ["a.vmd", "b.vpd", "c.VMD"];
    expect(filterAnimFiles(files)).toEqual(files);
  });

  it("路径含子目录也能匹配", () => {
    const files = ["CustomAnim/dance.vmd", "Anim/sub/pose.VPD", "other.pmx"];
    const result = filterAnimFiles(files);
    expect(result).toEqual(["CustomAnim/dance.vmd", "Anim/sub/pose.VPD"]);
  });

  it("不带扩展名的文件不会被误匹配", () => {
    const files = ["noext", ".vmdhidden", "readme"];
    expect(filterAnimFiles(files)).toEqual([]);
  });

  it("扩展名嵌入中间不被误匹配（只检查 endWith）", () => {
    const files = ["vmd_inside.txt", "file.vmd.bak"];
    expect(filterAnimFiles(files)).toEqual([]);
  });
});
