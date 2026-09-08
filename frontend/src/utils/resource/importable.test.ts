// @vitest-environment node
// ===== importable.ts 测试（安全守卫：ysm.json 白名单边界）=====
// 覆盖：isImportableFile 的扩展名白名单 + .json 安全拦截。
import { describe, it, expect } from "vitest";
import { isImportableFile } from "./importable.ts";

describe("isImportableFile — 可独立导入判定（安全守卫）", () => {
  it("已知扩展名 → true", () => {
    expect(isImportableFile("model.ysm")).toBe(true);
    expect(isImportableFile("skin.pmx")).toBe(true);
    expect(isImportableFile("avatar.vrm")).toBe(true);
    expect(isImportableFile("archive.zip")).toBe(true);
    expect(isImportableFile("archive.7z")).toBe(true);
  });

  it(".json 且文件名含 ysm（白名单）→ true", () => {
    expect(isImportableFile("ysm.json")).toBe(true);
    expect(isImportableFile("YSM.JSON")).toBe(true);
    expect(isImportableFile("Ysm.Json")).toBe(true);
  });

  it(".json 但文件名不含 ysm（安全拦截）→ false", () => {
    expect(isImportableFile("main.json")).toBe(false);
    expect(isImportableFile("arm.json")).toBe(false);
    expect(isImportableFile("slashblade.animation.json")).toBe(false);
    expect(isImportableFile("tac.animation.json")).toBe(false);
    expect(isImportableFile("zh_cn.json")).toBe(false);
    expect(isImportableFile("en_us.json")).toBe(false);
  });

  it("无扩展名 → false", () => {
    expect(isImportableFile("Makefile")).toBe(false);
    expect(isImportableFile("README")).toBe(false);
    expect(isImportableFile("noext")).toBe(false);
  });

  it("大小写混合扩展名 → true", () => {
    expect(isImportableFile("model.YSM")).toBe(true);
    expect(isImportableFile("model.Ysm")).toBe(true);
    expect(isImportableFile("skin.Pmx")).toBe(true);
    expect(isImportableFile("archive.ZIP")).toBe(true);
    expect(isImportableFile("archive.7Z")).toBe(true);
  });

  it("路径含点（如 /path/to/file.backup/ysm.json）→ true", () => {
    expect(isImportableFile("/path/to/file.backup/ysm.json")).toBe(true);
    expect(isImportableFile("C:\\Users\\me\\models\\ysm.json")).toBe(true);
    expect(isImportableFile("/path/to/file.backup/main.json")).toBe(false);
    expect(isImportableFile("/path.to/file/ysm.json")).toBe(true);
  });
});
