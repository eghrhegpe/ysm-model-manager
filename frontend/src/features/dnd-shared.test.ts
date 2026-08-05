// ===== DnD 导入共享逻辑测试（dnd-shared.ts）=====
// 覆盖：isSupportedFile、isImportableFile、shouldEnterForm、getExt
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isSupportedFile,
  isImportableFile,
  shouldEnterForm,
  getExt,
} from "./dnd-shared.ts";
import { getApp } from "../wails/app.ts";

// mock getApp 以隔离 Wails 调用
vi.mock("../wails/app.ts", () => ({
  getApp: vi.fn(),
}));

describe("getExt — 扩展名提取", () => {
  it("提取单点文件名扩展名", () => {
    expect(getExt("model.ysm")).toBe(".ysm");
  });

  it("提取多点文件名最后一个扩展名", () => {
    expect(getExt("archive.zip.7z")).toBe(".7z");
  });

  it("无扩展名时返回文件名加前导点", () => {
    expect(getExt("README")).toBe(".readme");
  });

  it("大写扩展名转小写", () => {
    expect(getExt("Model.YSM")).toBe(".ysm");
  });
});

describe("isSupportedFile — 扩展名支持检查", () => {
  it("支持的扩展名返回 true", () => {
    expect(isSupportedFile("model.ysm")).toBe(true);
    expect(isSupportedFile("archive.zip")).toBe(true);
    expect(isSupportedFile("archive.7z")).toBe(true);
    expect(isSupportedFile("data.json")).toBe(true);
    expect(isSupportedFile("skin.pmx")).toBe(true);
    expect(isSupportedFile("avatar.vrm")).toBe(true);
  });

  it("不支持的扩展名返回 false", () => {
    expect(isSupportedFile("file.txt")).toBe(false);
    expect(isSupportedFile("file.exe")).toBe(false);
  });

  it("无扩展名返回 false", () => {
    expect(isSupportedFile("README")).toBe(false);
  });

  it("大小写不敏感", () => {
    expect(isSupportedFile("Model.YSM")).toBe(true);
    expect(isSupportedFile("Archive.ZIP")).toBe(true);
  });
});

describe("isImportableFile — 可独立导入判定（ysm 包内 json 白名单）", () => {
  it(".ysm / .zip / .7z 与扩展名支持一致", () => {
    expect(isImportableFile("model.ysm")).toBe(true);
    expect(isImportableFile("archive.zip")).toBe(true);
    expect(isImportableFile("archive.7z")).toBe(true);
  });

  it("ysm.json 是可导入入口清单", () => {
    expect(isImportableFile("ysm.json")).toBe(true);
    expect(isImportableFile("YSM.JSON")).toBe(true);
  });

  it("包内 geometry / animation / 语言 json 一律拒绝", () => {
    expect(isImportableFile("main.json")).toBe(false);
    expect(isImportableFile("arm.json")).toBe(false);
    expect(isImportableFile("slashblade.animation.json")).toBe(false);
    expect(isImportableFile("tac.animation.json")).toBe(false);
    expect(isImportableFile("zh_cn.json")).toBe(false);
    expect(isImportableFile("en_us.json")).toBe(false);
  });

  it("其它类型扩展名不受影响", () => {
    expect(isImportableFile("skin.pmx")).toBe(true);
    expect(isImportableFile("avatar.vrm")).toBe(true);
    expect(isImportableFile("file.txt")).toBe(false);
  });
});

describe("shouldEnterForm — 是否进入命名表单", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it(".ysm 默认直接导入（不进表单，2026-08-05 简化）", async () => {
    const result = await shouldEnterForm("model.ysm", "fakebase64");
    expect(result).toBe(false);
  });

  it(".zip / .7z 默认直接导入（后端自动路由类型，不再探测进表单）", async () => {
    expect(await shouldEnterForm("archive.zip", "fakebase64")).toBe(false);
    expect(await shouldEnterForm("archive.7z", "fakebase64")).toBe(false);
    // 不再调用 DetectZipType
    expect(getApp).not.toHaveBeenCalled();
  });

  it("ysm.json 单文件保留表单提示（整组导入走文件夹路由）", async () => {
    expect(await shouldEnterForm("ysm.json", "fakebase64")).toBe(true);
    expect(await shouldEnterForm("YSM.JSON", "fakebase64")).toBe(true);
  });

  it("不支持的扩展名返回 false", async () => {
    const result = await shouldEnterForm("file.txt", "fakebase64");
    expect(result).toBe(false);
  });
});
