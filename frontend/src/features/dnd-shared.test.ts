// ===== DnD 导入共享逻辑测试（dnd-shared.ts）=====
// 覆盖：isSupportedFile、shouldEnterForm、getExt
import { describe, it, expect, vi, beforeEach } from "vitest";
import { isSupportedFile, shouldEnterForm, getExt } from "./dnd-shared.ts";
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

describe("shouldEnterForm — 是否进入命名表单", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it(".ysm 文件直接返回 true（不查 zip 类型）", async () => {
    const result = await shouldEnterForm("model.ysm", "fakebase64");
    expect(result).toBe(true);
  });

  it("ysm.json 文件直接返回 true", async () => {
    const result = await shouldEnterForm("ysm.json", "fakebase64");
    expect(result).toBe(true);
  });

  it("大写 YSM.JSON 也返回 true", async () => {
    const result = await shouldEnterForm("YSM.JSON", "fakebase64");
    expect(result).toBe(true);
  });

  it(".zip 文件调用 DetectZipType 并返回结果", async () => {
    (getApp as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      DetectZipType: vi.fn().mockResolvedValue("ysm"),
    });
    const result = await shouldEnterForm("archive.zip", "fakebase64");
    expect(result).toBe(true);
  });

  it(".7z 文件调用 DetectZipType 并返回结果", async () => {
    (getApp as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      DetectZipType: vi.fn().mockResolvedValue("ysm"),
    });
    const result = await shouldEnterForm("archive.7z", "fakebase64");
    expect(result).toBe(true);
  });

  it("DetectZipType 返回非 ysm 时返回 false", async () => {
    (getApp as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      DetectZipType: vi.fn().mockResolvedValue("resourcepack"),
    });
    const result = await shouldEnterForm("archive.zip", "fakebase64");
    expect(result).toBe(false);
  });

  it("DetectZipType 抛错时返回 false（不传播异常）", async () => {
    (getApp as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      DetectZipType: vi.fn().mockRejectedValue(new Error("timeout")),
    });
    const result = await shouldEnterForm("archive.zip", "fakebase64");
    expect(result).toBe(false);
  });

  it("不支持的扩展名返回 false（不查 zip 类型）", async () => {
    const result = await shouldEnterForm("file.txt", "fakebase64");
    expect(result).toBe(false);
  });
});
