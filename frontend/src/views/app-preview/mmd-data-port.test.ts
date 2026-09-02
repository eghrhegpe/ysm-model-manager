// @vitest-environment node
// ===== mmd-data-port 共享端口测试（mmd-3d / scene-3d 共用的 Go RPC 接入层）=====
// 覆盖：六个端口方法的委托与边界——批量读 null/undefined 归一为 null、异常短路返回
// 空表 / null、addOpLog 失败吞掉不阻断（诊断不阻断）、scope 打标透传。
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAppMock } = vi.hoisted(() => ({ getAppMock: vi.fn() }));
vi.mock("../../backend/app.ts", () => ({ getApp: getAppMock }));

import { makeMmdDataPort } from "./mmd-data-port.ts";

/** 构造带全量绑定方法的 App mock */
function makeAppMock() {
  return {
    ReadFileBytes: vi.fn(),
    ReadFileBytesBatch: vi.fn(),
    ReadFileBytesBatchWithMeta: vi.fn(),
    ListAllFilePaths: vi.fn(),
    AddOpLog: vi.fn().mockResolvedValue(undefined),
    GetCachedTexture: vi.fn(),
    SaveCachedTexture: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("makeMmdDataPort", () => {
  it("readFileBytes / listAllFilePaths 直接委托 App 绑定（含 null 透传）", async () => {
    const App = makeAppMock();
    getAppMock.mockResolvedValue(App);
    App.ReadFileBytes.mockResolvedValue("base64-data");
    App.ListAllFilePaths.mockResolvedValue(["/d/a.png", "/d/b.png"]);

    const port = await makeMmdDataPort("mmd-preview");
    expect(await port.readFileBytes("/model.pmx")).toBe("base64-data");
    expect(App.ReadFileBytes).toHaveBeenCalledWith("/model.pmx");
    expect(await port.listAllFilePaths("/tex")).toEqual(["/d/a.png", "/d/b.png"]);
    expect(App.ListAllFilePaths).toHaveBeenCalledWith("/tex");

    App.ReadFileBytes.mockResolvedValue(null);
    App.ListAllFilePaths.mockResolvedValue(null);
    expect(await port.readFileBytes("/missing.pmx")).toBeNull();
    expect(await port.listAllFilePaths("/empty")).toBeNull();
  });

  it("readFileBytesBatch：值原样映射，undefined 归一为 null", async () => {
    const App = makeAppMock();
    getAppMock.mockResolvedValue(App);
    App.ReadFileBytesBatch.mockResolvedValue({ a: "x", b: null, c: undefined });
    const port = await makeMmdDataPort("mmd-preview");
    expect(await port.readFileBytesBatch(["a", "b", "c"])).toEqual({ a: "x", b: null, c: null });
    expect(App.ReadFileBytesBatch).toHaveBeenCalledWith(["a", "b", "c"]);
  });

  it("readFileBytesBatch：RPC 返回 null → {}；RPC 抛异常 → {}（短路不炸加载）", async () => {
    const App = makeAppMock();
    getAppMock.mockResolvedValue(App);
    App.ReadFileBytesBatch.mockResolvedValue(null);
    const port = await makeMmdDataPort("mmd-preview");
    expect(await port.readFileBytesBatch(["p"])).toEqual({});
    App.ReadFileBytesBatch.mockRejectedValue(new Error("rpc down"));
    expect(await port.readFileBytesBatch(["p"])).toEqual({});
  });

  it("readFileBytesBatchWithMeta：data+hash 原样映射，undefined 归一为 null；null → {}", async () => {
    const App = makeAppMock();
    getAppMock.mockResolvedValue(App);
    App.ReadFileBytesBatchWithMeta.mockResolvedValue({
      tex1: { data: "d1", hash: "h1" },
      tex2: null,
      tex3: undefined,
    });
    const port = await makeMmdDataPort("mmd-scene");
    expect(await port.readFileBytesBatchWithMeta!(["tex1", "tex2", "tex3"])).toEqual({
      tex1: { data: "d1", hash: "h1" },
      tex2: null,
      tex3: null,
    });
    App.ReadFileBytesBatchWithMeta.mockResolvedValue(null);
    expect(await port.readFileBytesBatchWithMeta!(["x"])).toEqual({});
  });

  it("readFileBytesBatchWithMeta：RPC 抛异常 → {}", async () => {
    const App = makeAppMock();
    getAppMock.mockResolvedValue(App);
    App.ReadFileBytesBatchWithMeta.mockRejectedValue(new Error("rpc down"));
    const port = await makeMmdDataPort("mmd-scene");
    expect(await port.readFileBytesBatchWithMeta!(["x"])).toEqual({});
  });

  it("addOpLog：以 scope 打标透传，err 缺省补空串", async () => {
    const App = makeAppMock();
    getAppMock.mockResolvedValue(App);
    const port = await makeMmdDataPort("mmd-preview");
    await port.addOpLog("load", "加载模型", "ok");
    expect(App.AddOpLog).toHaveBeenCalledWith("mmd-preview", "load", "加载模型", "", 0, "ok", "");
    await port.addOpLog("load", "读文件失败", "fail", "ENOENT");
    expect(App.AddOpLog).toHaveBeenLastCalledWith(
      "mmd-preview",
      "load",
      "读文件失败",
      "",
      0,
      "fail",
      "ENOENT",
    );
  });

  it("addOpLog：AddOpLog 抛异常被吞掉（诊断不阻断）", async () => {
    const App = makeAppMock();
    getAppMock.mockResolvedValue(App);
    App.AddOpLog.mockRejectedValue(new Error("log rpc down"));
    const port = await makeMmdDataPort("mmd-preview");
    await expect(port.addOpLog("load", "x", "warn")).resolves.toBeUndefined();
  });

  it("getCachedTexture：命中返回结果，未命中（undefined）→ null", async () => {
    const App = makeAppMock();
    getAppMock.mockResolvedValue(App);
    const cached = { format: "ktx2", data: "base64", hash: "h" };
    App.GetCachedTexture.mockResolvedValue(cached);
    const port = await makeMmdDataPort("mmd-preview");
    expect(await port.getCachedTexture!("/t.png")).toEqual(cached);
    expect(App.GetCachedTexture).toHaveBeenCalledWith("/t.png");
    App.GetCachedTexture.mockResolvedValue(undefined);
    expect(await port.getCachedTexture!("/miss.png")).toBeNull();
  });

  it("getCachedTexture：RPC 抛异常 → null（缓存失败降级）", async () => {
    const App = makeAppMock();
    getAppMock.mockResolvedValue(App);
    App.GetCachedTexture.mockRejectedValue(new Error("cache rpc down"));
    const port = await makeMmdDataPort("mmd-preview");
    expect(await port.getCachedTexture!("/t.png")).toBeNull();
  });

  it("saveCachedTexture：委托 SaveCachedTexture（P2-1 落盘通道）", async () => {
    const App = makeAppMock();
    getAppMock.mockResolvedValue(App);
    const port = await makeMmdDataPort("mmd-preview");
    await port.saveCachedTexture!("h1", "b64data");
    expect(App.SaveCachedTexture).toHaveBeenCalledWith("h1", "b64data");
  });

  it("saveCachedTexture：RPC 抛异常被吞掉（无持久化通道不阻断编码）", async () => {
    const App = makeAppMock();
    getAppMock.mockResolvedValue(App);
    App.SaveCachedTexture.mockRejectedValue(new Error("save rpc down"));
    const port = await makeMmdDataPort("mmd-preview");
    await expect(port.saveCachedTexture!("h1", "b64")).resolves.toBeUndefined();
  });

  it("scope 打标随端口实例区分（mmd-preview / mmd-scene 各自透传）", async () => {
    const AppA = makeAppMock();
    const AppB = makeAppMock();
    getAppMock.mockResolvedValueOnce(AppA).mockResolvedValueOnce(AppB);
    const p1 = await makeMmdDataPort("mmd-preview");
    const p2 = await makeMmdDataPort("mmd-scene");
    await p1.addOpLog("op", "m1", "ok");
    await p2.addOpLog("op", "m2", "ok");
    expect(AppA.AddOpLog.mock.calls[0][0]).toBe("mmd-preview");
    expect(AppB.AddOpLog.mock.calls[0][0]).toBe("mmd-scene");
  });
});
