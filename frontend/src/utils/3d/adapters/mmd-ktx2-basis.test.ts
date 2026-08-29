// @vitest-environment node
// ===== MMD KTX2 Basis 编码核心测试（encodeToKTX2Basis + loadBasisModule 单例）=====
// 纯逻辑模块：只用 fetch + new Function（无 DOM 依赖），node 环境可测。
// 假方案：fetch 返回一段定义 `var BASIS` 的 jsText，工厂直接回吐挂在 globalThis 上的
// 测试模块（假 BasisEncoder 记录 setter/encode/delete 调用）——不加载真实 WASM。
// 既有 mmd-ktx2-encoder.test.ts 只覆盖 TextureTooLargeError 构造与同步降级失败路径，
// 本文件补齐：尺寸守卫、编码参数契约、slice 复制语义、n<=0 抛错、单例缓存、失败重试。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  encodeToKTX2Basis,
  MAX_KTX2_PIXELS,
  TextureTooLargeError,
} from "./mmd-ktx2-basis.ts";

// ===== 假 basis 模块（经 globalThis 传给 new Function 执行的 jsText）=====

const initMock = vi.fn();
const deleteMock = vi.fn();
const setterMocks = {
  setCreateKTX2File: vi.fn(),
  setKTX2UASTCSupercompression: vi.fn(),
  setKTX2SRGBTransferFunc: vi.fn(),
  setSliceSourceImage: vi.fn(),
  setPerceptual: vi.fn(),
  setMipSRGB: vi.fn(),
  setQualityLevel: vi.fn(),
  setUASTC: vi.fn(),
  setMipGen: vi.fn(),
};
const encodeMock = vi.fn((dst: Uint8Array): number => {
  // 假编码：写入 5 字节标记数据，返回写入长度
  dst[0] = 0xab;
  dst[1] = 0xcd;
  dst[2] = 0xef;
  dst[3] = 0x01;
  dst[4] = 0x02;
  return 5;
});
const BasisEncoderCtor = vi.fn(function (this: Record<string, unknown>) {
  Object.assign(this, setterMocks, { encode: encodeMock, delete: deleteMock });
});

/** jsText：定义模块工厂 `var BASIS`，捕获入参并回吐 globalThis 上的测试模块 */
const FAKE_JS = `
var BASIS = function (opts) {
  globalThis.__BASIS_TEST_OPTS__ = opts;
  return Promise.resolve(globalThis.__BASIS_TEST_MODULE__);
};
`;

function installBasisGlobals(): void {
  (globalThis as Record<string, unknown>).__BASIS_TEST_MODULE__ = {
    initializeBasis: initMock,
    BasisEncoder: BasisEncoderCtor,
  };
}

function installFetch(behavior: "ok" | "fail" = "ok"): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((url: string | URL) => {
    if (behavior === "fail") {
      // 延迟 reject：避免 Promise.all 挂 handler 前的 unhandled rejection（同 encoder 测试）
      return new Promise((_, rej) => {
        setTimeout(() => rej(new Error("basis files missing in test env")), 0);
      });
    }
    const u = String(url);
    if (u.endsWith(".js")) {
      return Promise.resolve({ text: () => Promise.resolve(FAKE_JS) });
    }
    return Promise.resolve({
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function makeImg(w: number, h: number): { data: Uint8Array; width: number; height: number } {
  return { data: new Uint8Array(w * h * 4), width: w, height: h };
}

beforeEach(() => {
  vi.clearAllMocks();
  installBasisGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as Record<string, unknown>).__BASIS_TEST_MODULE__;
  delete (globalThis as Record<string, unknown>).__BASIS_TEST_OPTS__;
});

describe("TextureTooLargeError", () => {
  it("名称与消息包含尺寸与上限", () => {
    const err = new TextureTooLargeError(8192, 8192);
    expect(err.name).toBe("TextureTooLargeError");
    expect(err.message).toContain("8192x8192");
    expect(err.message).toContain(String(MAX_KTX2_PIXELS));
  });

  it("MAX_KTX2_PIXELS = 4096²", () => {
    expect(MAX_KTX2_PIXELS).toBe(4096 * 4096);
  });
});

describe("encodeToKTX2Basis 尺寸守卫", () => {
  it("超大纹理（>4096²）→ 抛 TextureTooLargeError，不 fetch、不加载 WASM", async () => {
    const fetchMock = installFetch();
    await expect(encodeToKTX2Basis(makeImg(4096, 4097))).rejects.toThrow(
      TextureTooLargeError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("encodeToKTX2Basis 编码主路径", () => {
  it("编码成功 → ETC1S 参数契约 + initializeBasis 一次 + slice 复制真实长度 + delete 释放", async () => {
    const fetchMock = installFetch();
    const img = makeImg(4, 4);
    const result = await encodeToKTX2Basis(img);

    // 模块工厂入参：wasm 二进制经 opts 传入
    const opts = (globalThis as Record<string, unknown>).__BASIS_TEST_OPTS__ as {
      wasmBinary: ArrayBuffer;
    };
    expect(opts.wasmBinary).toBeInstanceOf(ArrayBuffer);
    expect(opts.wasmBinary.byteLength).toBe(16);
    expect(initMock).toHaveBeenCalledTimes(1);

    // 参数契约（与源码逐项对齐）
    expect(setterMocks.setCreateKTX2File).toHaveBeenCalledWith(true);
    expect(setterMocks.setKTX2UASTCSupercompression).toHaveBeenCalledWith(true);
    expect(setterMocks.setKTX2SRGBTransferFunc).toHaveBeenCalledWith(true);
    expect(setterMocks.setSliceSourceImage).toHaveBeenCalledWith(
      0,
      img.data,
      4,
      4,
      false,
    );
    expect(setterMocks.setPerceptual).toHaveBeenCalledWith(false);
    expect(setterMocks.setMipSRGB).toHaveBeenCalledWith(false);
    expect(setterMocks.setQualityLevel).toHaveBeenCalledWith(128);
    expect(setterMocks.setUASTC).toHaveBeenCalledWith(false); // ETC1S
    expect(setterMocks.setMipGen).toHaveBeenCalledWith(false);

    // encode 收到 w*h*4 的输出缓冲
    const dst = encodeMock.mock.calls[0][0] as Uint8Array;
    expect(dst.length).toBe(4 * 4 * 4);

    // slice(0, n) 复制真实压缩长度（subarray 视图陷阱回归：n=5 ≠ 64）
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(result.byteLength).toBe(5);
    expect(new Uint8Array(result)).toEqual(
      new Uint8Array([0xab, 0xcd, 0xef, 0x01, 0x02]),
    );
    // finally 释放
    expect(deleteMock).toHaveBeenCalledTimes(1);
    // js + wasm 各一次 fetch
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("encode 返回 n<=0 → 抛错（含返回值），delete 仍在 finally 释放", async () => {
    installFetch();
    encodeMock.mockReturnValueOnce(-1);
    await expect(encodeToKTX2Basis(makeImg(2, 2))).rejects.toThrow(
      "BasisEncoder.encode 返回 -1",
    );
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  it("模块单例缓存：重复编码只 fetch 一次 js+wasm", async () => {
    // 前序用例可能已缓存单例 → resetModules 取全新实例，从零验证缓存语义
    vi.resetModules();
    const fresh = (await import("./mmd-ktx2-basis.ts")) as {
      encodeToKTX2Basis: typeof encodeToKTX2Basis;
    };
    const fetchMock = installFetch();
    await fresh.encodeToKTX2Basis(makeImg(2, 2)); // 首次加载模块
    expect(fetchMock.mock.calls.length).toBe(2); // js + wasm
    await fresh.encodeToKTX2Basis(makeImg(2, 2)); // 走缓存单例
    expect(fetchMock.mock.calls.length).toBe(2);
    expect(BasisEncoderCtor).toHaveBeenCalledTimes(2); // 每次编码新建 encoder
    vi.resetModules();
  });
});

describe("loadBasisModule 失败重试", () => {
  // 用全新模块实例隔离单例状态（静态 import 的 basisModulePromise 已被上面的用例缓存）
  it("首次 fetch 失败 → 抛错后允许重试，恢复后再次调用成功", async () => {
    vi.resetModules();
    const fetchMock = installFetch("fail");
    const fresh = (await import("./mmd-ktx2-basis.ts")) as {
      encodeToKTX2Basis: typeof encodeToKTX2Basis;
    };

    await expect(fresh.encodeToKTX2Basis(makeImg(2, 2))).rejects.toThrow(
      "basis files missing in test env",
    );

    // 失败后单例被清空（catch 重置）→ 恢复 fetch 后重试成功
    fetchMock.mockImplementation((url: string | URL) => {
      const u = String(url);
      if (u.endsWith(".js")) {
        return Promise.resolve({ text: () => Promise.resolve(FAKE_JS) });
      }
      return Promise.resolve({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
      });
    });
    const result = await fresh.encodeToKTX2Basis(makeImg(2, 2));
    expect(result.byteLength).toBe(5);
    expect(initMock).toHaveBeenCalledTimes(1);
    vi.resetModules();
  });
});
