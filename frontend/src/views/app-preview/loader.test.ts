// @vitest-environment node
// ===== 模型数据加载（loader.ts）测试 =====
// 覆盖：缓存命中 / WASM 解码成功 / WASM 空结果回退 Go / Go 兜底 + texMappingLog /
//       .json 目录 authors 填补 / 缓存 authors 填补 / 空结果返回 null
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BedrockGeometry } from "./geometry.ts";

const { cacheGetMock, cacheSetMock, AnalyzeMock, parseAnimMock, ExtractSummaryMock, CacheAvatarsMock, CachedAvatarMock } =
  vi.hoisted(() => ({
    cacheGetMock: vi.fn(),
    cacheSetMock: vi.fn(),
    AnalyzeMock: vi.fn(),
    parseAnimMock: vi.fn(),
    ExtractSummaryMock: vi.fn(),
    CacheAvatarsMock: vi.fn(),
    CachedAvatarMock: vi.fn(),
  }));

vi.mock("./cache.ts", () => ({
  cacheGet: cacheGetMock,
  cacheSet: cacheSetMock,
}));

vi.mock("../../backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    AnalyzeBedrockModel: AnalyzeMock,
    ExtractYsmSummary: ExtractSummaryMock,
    CacheModelAvatars: CacheAvatarsMock,
    CachedCreatorAvatar: CachedAvatarMock,
  }),
}));

vi.mock("../../utils/animation/animation.ts", () => ({
  parseBedrockAnimationJSON: parseAnimMock,
}));

import { loadModelData, fillAuthorsAsync } from "./loader.ts";

/** 构造一个带骨骼的几何对象（测试用，走 cast 绕开 BedrockBone 细节） */
function geo(over: Partial<BedrockGeometry> = {}): BedrockGeometry {
  return {
    boneCount: 1,
    cubeCount: 1,
    texWidth: 64,
    texHeight: 64,
    bones: [{ id: "bone1" }] as unknown as BedrockGeometry["bones"],
    ...over,
  };
}

function ctx(over: { decode?: unknown; appendDebug?: unknown } = {}) {
  return {
    decodeYsmViaWasm: over.decode ?? vi.fn(),
    appendDebug: over.appendDebug ?? vi.fn(),
  } as unknown as Parameters<typeof loadModelData>[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  cacheGetMock.mockReturnValue(null);
  cacheSetMock.mockImplementation(() => {});
  AnalyzeMock.mockResolvedValue(null);
  parseAnimMock.mockReturnValue({ clips: [], errors: [] });
  ExtractSummaryMock.mockResolvedValue(null);
  CacheAvatarsMock.mockResolvedValue(undefined);
  CachedAvatarMock.mockResolvedValue(null);
});

describe("loadModelData — 缓存命中", () => {
  it("缓存含骨骼几何 → 直接复用，不触 WASM / Go", async () => {
    const cached = geo();
    cacheGetMock.mockReturnValue({ geometry: cached, _decodedBy: "🧠 WASM 内置解码" });
    const decode = vi.fn();
    const r = await loadModelData("/m/a.ysm", ctx({ decode }));

    expect(decode).not.toHaveBeenCalled();
    expect(AnalyzeMock).not.toHaveBeenCalled();
    expect(r.model).toBe(cached);
    expect(r.decodedBy).toBe("🧠 WASM 内置解码");
    expect(cached._modelPath).toBe("/m/a.ysm");
  });

  it("缓存无骨骼 → 走 WASM 解码", async () => {
    cacheGetMock.mockReturnValue({ geometry: { bones: [] } });
    const decoded = geo();
    const decode = vi.fn().mockResolvedValue({ geometry: decoded, authors: [] });
    const r = await loadModelData("/m/a.ysm", ctx({ decode }));

    expect(decode).toHaveBeenCalledWith("/m/a.ysm");
    expect(r.model).toBe(decoded);
  });
});

describe("loadModelData — WASM 解码路径（.ysm）", () => {
  it("WASM 返回有骨骼 → 使用 WASM 结果 + 写回缓存", async () => {
    const decoded = geo();
    const decode = vi.fn().mockResolvedValue({
      geometry: decoded,
      authors: [{ name: "作者A" }],
      avatars: { "作者A": "blob:x" },
    });
    const r = await loadModelData("/m/a.ysm", ctx({ decode }));

    expect(r.decodedBy).toBe("🧠 WASM 内置解码");
    expect(decoded._authors).toEqual([{ name: "作者A" }]);
    expect(decoded._avatars).toEqual({ "作者A": "blob:x" });
    expect(cacheSetMock).toHaveBeenCalledWith(
      "/m/a.ysm",
      expect.objectContaining({ geometry: decoded, _decodedBy: "🧠 WASM 内置解码" }),
    );
  });

  it("WASM 返回空 → 回退 Go AnalyzeBedrockModel", async () => {
    const decode = vi.fn().mockResolvedValue(null);
    const goModel = geo();
    AnalyzeMock.mockResolvedValue(goModel);
    const appendDebug = vi.fn();

    const r = await loadModelData("/m/a.ysm", ctx({ decode, appendDebug }));

    expect(appendDebug).toHaveBeenCalledWith(
      null,
      expect.stringContaining("WASM 返回空或无骨骼"),
    );
    expect(AnalyzeMock).toHaveBeenCalledWith("/m/a.ysm");
    expect(r.model).toBe(goModel);
    expect(r.decodedBy).toBe("📦 Go 原生解析");
  });

  it("WASM 解码抛错 → 异常向上传播（不静默吞错）", async () => {
    const decode = vi.fn().mockRejectedValue(new Error("wasm boom"));
    await expect(loadModelData("/m/a.ysm", ctx({ decode }))).rejects.toThrow(
      "wasm boom",
    );
  });
});

describe("loadModelData — Go 兜底路径", () => {
  it(".json（解压目录）→ 直接走 Go，不经 WASM（WASM 仅 .ysm 二进制格式）", async () => {
    const goModel = geo();
    AnalyzeMock.mockResolvedValue(goModel);
    const decode = vi.fn();

    const r = await loadModelData("/m/b.json", ctx({ decode }));

    expect(decode).not.toHaveBeenCalled();
    expect(AnalyzeMock).toHaveBeenCalledWith("/m/b.json");
    expect(r.model).toBe(goModel);
    expect(r.decodedBy).toBe("📦 Go 原生解析");
  });

  it(".json 且 WASM 失败 → 回退 Go", async () => {
    const goModel = geo();
    AnalyzeMock.mockResolvedValue(goModel);
    const decode = vi.fn().mockResolvedValue(null);

    const r = await loadModelData("/m/b.json", ctx({ decode }));

    expect(AnalyzeMock).toHaveBeenCalledWith("/m/b.json");
    expect(r.model).toBe(goModel);
    expect(r.decodedBy).toBe("📦 Go 原生解析");
  });

  it("Go 返回带骨骼 → 填充 _texMappingLog 并写缓存（单纹理）", async () => {
    const goModel = geo({ textures: ["t.png"], texWidth: 32, texHeight: 16 });
    AnalyzeMock.mockResolvedValue(goModel);

    await loadModelData("/m/b.json", ctx());

    expect(goModel._texMappingLog).toEqual([
      expect.objectContaining({
        file: "b.json",
        texKey: "texture[0]",
        finalSize: "32×16",
      }),
    ]);
    expect(cacheSetMock).toHaveBeenCalledWith(
      "/m/b.json",
      expect.objectContaining({ _decodedBy: "📦 Go 原生解析" }),
    );
  });

  it("Go 返回多纹理 → 追加 (+多纹理) 日志", async () => {
    const goModel = geo({ textures: ["t0.png", "t1.png"] });
    AnalyzeMock.mockResolvedValue(goModel);

    await loadModelData("/m/b.json", ctx());

    expect(goModel._texMappingLog).toHaveLength(2);
    expect(goModel._texMappingLog![1]).toEqual(
      expect.objectContaining({ texKey: "+1" }),
    );
  });

  it("Go 动画 JSON → 解析 clips 写入缓存 animations", async () => {
    const goModel = geo({ animations: ['{"animations":{}}'] });
    AnalyzeMock.mockResolvedValue(goModel);
    parseAnimMock.mockReturnValue({ clips: ["clipA", "clipB"], errors: [] });

    await loadModelData("/m/b.json", ctx());

    expect(parseAnimMock).toHaveBeenCalledWith('{"animations":{}}');
    expect(cacheSetMock).toHaveBeenCalledWith(
      "/m/b.json",
      expect.objectContaining({ animations: ["clipA", "clipB"] }),
    );
  });

  it("Go 返回无骨骼 → 返回空骨骼对象（调用方按无几何兜底）+ decodedBy 空串", async () => {
    AnalyzeMock.mockResolvedValue({ bones: [] });
    const r = await loadModelData("/m/empty.bedrock", ctx());

    // 空骨骼对象仍被返回（非 null），skeleton.ts 以 !model.bones.length 判"未找到几何数据"
    expect(r.model?.bones).toEqual([]);
    expect(r.decodedBy).toBe("");
  });
});

describe("loadModelData — authors 填补", () => {
  it(".ysm：WASM 无几何但带 authors → 走 Go 后由 WASM authors 填补（Go 无 authors 字段）", async () => {
    const goModel = geo();
    AnalyzeMock.mockResolvedValue(goModel);
    const decode = vi.fn().mockResolvedValue({
      geometry: null, // WASM 无法解出几何 → 回退 Go，authors 保留待填补
      authors: [{ name: "作者B" }],
      avatars: { 作者B: "blob:y" },
    });

    const r = await loadModelData("/m/c.ysm", ctx({ decode }));

    expect(decode).toHaveBeenCalledWith("/m/c.ysm");
    expect(AnalyzeMock).toHaveBeenCalledWith("/m/c.ysm");
    expect(r.model).toBe(goModel);
    expect(goModel._authors).toEqual([{ name: "作者B" }]);
    expect(goModel._avatars).toEqual({ 作者B: "blob:y" });
  });

  it("model 无 authors 且缓存有 → 从缓存填补", async () => {
    const goModel = geo();
    AnalyzeMock.mockResolvedValue(goModel);
    cacheGetMock
      .mockReturnValueOnce(null)
      .mockReturnValue({
        authors: [{ name: "缓存作者" }],
        avatars: { 缓存作者: "blob:z" },
      });

    const r = await loadModelData("/m/d.bedrock", ctx());

    expect(r.model?._authors).toEqual([{ name: "缓存作者" }]);
    expect(r.model?._avatars).toEqual({ 缓存作者: "blob:z" });
  });

  it("缓存 authors 含字符串元素 → 过滤为对象数组后填补", async () => {
    const goModel = geo();
    AnalyzeMock.mockResolvedValue(goModel);
    cacheGetMock
      .mockReturnValueOnce(null)
      .mockReturnValue({ authors: ["纯字符串", { name: "对象作者" }] });

    const r = await loadModelData("/m/e.bedrock", ctx());

    expect(r.model?._authors).toEqual([{ name: "对象作者" }]);
  });

  it("model 无 authors → loadModelData 不填充（延迟到 fillAuthorsAsync）", async () => {
    const goModel = geo();
    AnalyzeMock.mockResolvedValue(goModel);
    ExtractSummaryMock.mockResolvedValue({
      authors: [{ name: "作者X", roles: "模型" }],
    });

    const r = await loadModelData("/m/f.ysm", ctx());

    // loadModelData 不再填充 authors（延迟加载）
    expect(r.model?._authors).toBeUndefined();
    expect(ExtractSummaryMock).not.toHaveBeenCalled();
  });

  it("fillAuthorsAsync → ExtractYsmSummary 补齐作者名", async () => {
    const goModel = geo({ _authors: [] });
    AnalyzeMock.mockResolvedValue(goModel);
    ExtractSummaryMock.mockResolvedValue({
      authors: [{ name: "作者X", roles: "模型" }],
    });

    await fillAuthorsAsync("/m/f.ysm", goModel);

    expect(ExtractSummaryMock).toHaveBeenCalledWith("/m/f.ysm");
    expect(goModel._authors).toEqual([
      { name: "作者X", role: "模型", avatarUrl: null, avatarPath: "", bilibili: "" },
    ]);
  });

  it("fillAuthorsAsync → 并行回填所有作者头像", async () => {
    const goModel = geo({ _authors: [] });
    AnalyzeMock.mockResolvedValue(goModel);
    ExtractSummaryMock.mockResolvedValue({
      authors: [
        { name: "作者X", roles: "模型" },
        { name: "作者Y", roles: "纹理" },
      ],
    });
    CachedAvatarMock.mockResolvedValue("blob:avatar");

    await fillAuthorsAsync("/m/g.ysm", goModel);

    expect(CacheAvatarsMock).toHaveBeenCalledWith("/m/g.ysm");
    // 并行请求两个作者头像
    expect(CachedAvatarMock).toHaveBeenCalledWith("作者X");
    expect(CachedAvatarMock).toHaveBeenCalledWith("作者Y");
    expect(goModel._authors?.[0].avatarUrl).toBe("blob:avatar");
    expect(goModel._authors?.[1].avatarUrl).toBe("blob:avatar");
  });

  it("fillAuthorsAsync → ExtractYsmSummary 抛错静默吞掉", async () => {
    const goModel = geo({ _authors: [] });
    AnalyzeMock.mockResolvedValue(goModel);
    ExtractSummaryMock.mockRejectedValue(new Error("go summary boom"));

    await fillAuthorsAsync("/m/h.ysm", goModel);

    expect(goModel._authors).toEqual([]);
  });

  it("fillAuthorsAsync → CacheModelAvatars 抛错静默吞掉", async () => {
    const goModel = geo({ _authors: [] });
    AnalyzeMock.mockResolvedValue(goModel);
    ExtractSummaryMock.mockResolvedValue({
      authors: [{ name: "作者X", roles: "模型" }],
    });
    CacheAvatarsMock.mockRejectedValue(new Error("avatar boom"));

    await fillAuthorsAsync("/m/i.ysm", goModel);

    expect(goModel._authors?.[0]).toMatchObject({ name: "作者X", avatarUrl: null });
  });
});

describe("loadModelData — _animClips 挂载（动画数据统一供给适配器）", () => {
  it("WASM 解码含 animations → 挂到 model._animClips", async () => {
    const clip = { name: "idle" };
    const decoded = geo();
    const decode = vi.fn().mockResolvedValue({ geometry: decoded, animations: [clip], authors: [] });

    const r = await loadModelData("/m/a.ysm", ctx({ decode }));

    expect(r.model?._animClips).toEqual([clip]);
  });

  it("Go 动画 JSON 解析出 clips → 挂到 model._animClips（不只写缓存）", async () => {
    const goModel = geo({ animations: ['{"animations":{}}'] });
    AnalyzeMock.mockResolvedValue(goModel);
    parseAnimMock.mockReturnValue({ clips: ["clipA", "clipB"], errors: [] });

    const r = await loadModelData("/m/b.json", ctx());

    expect(r.model?._animClips).toEqual(["clipA", "clipB"]);
  });

  it("缓存命中且缓存有 animations → 挂到 model._animClips", async () => {
    const cached = geo();
    cacheGetMock.mockReturnValue({
      geometry: cached,
      animations: ["clipC"],
      _decodedBy: "🧠 WASM 内置解码",
    });

    const r = await loadModelData("/m/a.ysm", ctx());

    expect(r.model?._animClips).toEqual(["clipC"]);
  });

  it("无任何动画来源 → _animClips 保持 undefined（适配器走磁盘兜底）", async () => {
    const decode = vi.fn().mockResolvedValue({ geometry: geo(), animations: [], authors: [] });

    const r = await loadModelData("/m/a.ysm", ctx({ decode }));

    expect(r.model?._animClips).toBeUndefined();
  });
});
