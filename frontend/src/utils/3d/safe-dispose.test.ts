// @vitest-environment node
// ===== safeDispose / safeDisposeMat 契约测试 =====
// 覆盖：null/undefined 不抛、正常 dispose 被调用、dispose 抛错被吞（不阻塞）、
// 无 dispose 方法的对象不抛、safeDisposeMat 连带释放 map/emissiveMap 纹理。
import { describe, it, expect, vi } from "vitest";
import { safeDispose, safeDisposeMat } from "./safe-dispose.ts";

describe("safeDispose", () => {
  it("null / undefined 不抛错", () => {
    expect(() => safeDispose(null)).not.toThrow();
    expect(() => safeDispose(undefined)).not.toThrow();
  });

  it("正常对象 → 调用 dispose", () => {
    const dispose = vi.fn();
    safeDispose({ dispose });
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("dispose 抛错 → 被吞（不向调用方传播）", () => {
    const dispose = vi.fn(() => {
      throw new Error("boom");
    });
    expect(() => safeDispose({ dispose })).not.toThrow();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("无 dispose 方法的对象 → 不抛错", () => {
    expect(() => safeDispose({})).not.toThrow();
  });
});

describe("safeDisposeMat", () => {
  it("null / undefined 不抛错", () => {
    expect(() => safeDisposeMat(null)).not.toThrow();
    expect(() => safeDisposeMat(undefined)).not.toThrow();
  });

  it("释放材质 + map/emissiveMap 纹理", () => {
    const matDispose = vi.fn();
    const mapDispose = vi.fn();
    const emissiveDispose = vi.fn();
    const mat = {
      dispose: matDispose,
      map: { dispose: mapDispose },
      emissiveMap: { dispose: emissiveDispose },
    };
    safeDisposeMat(mat);
    expect(mapDispose).toHaveBeenCalledTimes(1);
    expect(emissiveDispose).toHaveBeenCalledTimes(1);
    expect(matDispose).toHaveBeenCalledTimes(1);
  });

  it("纹理 dispose 抛错 → 材质仍被释放", () => {
    const matDispose = vi.fn();
    const mat = {
      dispose: matDispose,
      map: {
        dispose: () => {
          throw new Error("tex boom");
        },
      },
    };
    expect(() => safeDisposeMat(mat)).not.toThrow();
    expect(matDispose).toHaveBeenCalledTimes(1);
  });

  it("材质 dispose 抛错 → 被吞（不向调用方传播）", () => {
    const mat = {
      dispose: () => {
        throw new Error("mat boom");
      },
    } as unknown as { dispose: () => void };
    expect(() => safeDisposeMat(mat)).not.toThrow();
  });
});
