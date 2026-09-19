// ===== MMD 纯辅助测试（刀⑳ 新建：锁「GPU 字节估算单一事实源」契约）=====
// 本文件存在的唯一理由：`estimateTexGpuBytes` 曾在 mmd-utils 内**重复实现**且漏 mip 因子，
// 使 MMD 纹理字节低估 ~25%、削弱 GPU 预算拦截。现委托 infra/texture-bytes.ts 单一事实源，
// 用「双入口同值」断言把该等价关系固化为编译/测试期事实，防日后有人再抄一份。
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  estimateTextureBytes,
  MIPMAP_CHAIN_FACTOR,
} from "@/preview-3d/infra/texture-bytes.ts";
import {
  concurrentMap,
  estimateTexGpuBytes,
  isLikelyTga,
} from "./mmd-utils.ts";

/** 造一张带 image 尺寸的纹理（happy-dom 下 three 纹理不自动探测尺寸） */
function tex(w: number, h: number, opts: { generateMipmaps?: boolean } = {}): THREE.Texture {
  const t = new THREE.Texture();
  t.image = { width: w, height: h } as unknown as HTMLImageElement;
  if (opts.generateMipmaps === false) t.generateMipmaps = false;
  return t;
}

describe("estimateTexGpuBytes — 委托单一事实源（禁止第二个口径）", () => {
  it("与 infra/texture-bytes 的 estimateTextureBytes 恒等（含 mip 链因子）", () => {
    const t = tex(1024, 1024);
    expect(estimateTexGpuBytes(t)).toBe(estimateTextureBytes(t));
    // 独立复算一遍，防「两边一起写错」的假绿：必须含 mip 系数
    expect(estimateTexGpuBytes(t)).toBe(Math.round(1024 * 1024 * 4 * MIPMAP_CHAIN_FACTOR));
  });

  it("漏 mip 因子的旧口径（w*h*4）不再成立——回归守卫", () => {
    const t = tex(1024, 1024);
    // 旧实现返回 4194304；新口径必须严格更大（mip 链约 +1/3）
    expect(estimateTexGpuBytes(t)).toBeGreaterThan(1024 * 1024 * 4);
  });

  it("generateMipmaps=false 时不乘 mip 因子", () => {
    const t = tex(1024, 1024, { generateMipmaps: false });
    expect(estimateTexGpuBytes(t)).toBe(1024 * 1024 * 4);
  });

  it("未就绪 / 零尺寸纹理按 0 计（不抛错）", () => {
    expect(estimateTexGpuBytes(new THREE.Texture())).toBe(0);
    expect(estimateTexGpuBytes(tex(0, 0))).toBe(0);
    expect(estimateTexGpuBytes(tex(512, 0))).toBe(0);
  });
});

describe("concurrentMap — 有界并发映射（MMD/FBX 纹理降级读取的收敛点）", () => {
  it("空输入直接返回空数组，不调用 fn", async () => {
    let calls = 0;
    const out = await concurrentMap([], async () => {
      calls++;
      return 1;
    });
    expect(out).toEqual([]);
    expect(calls).toBe(0);
  });

  it("每条恰好处理一次、结果按输入位次落位（chunkSize < 条目数，跨多分片）", async () => {
    const items = ["a", "b", "c", "d", "e", "f", "g"];
    const seen: string[] = [];
    const out = await concurrentMap(
      items,
      async (x) => {
        seen.push(x);
        return x.toUpperCase();
      },
      3,
    );
    // 位次落位：out[i] 对应 items[i]（消费方 mmd-build-load 逐条回填 texBatch，长度必须等长）
    expect(out).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
    // 每条一次，不重不漏
    expect([...seen].sort()).toEqual([...items].sort());
  });

  it("分片内并发、分片间串行：在途峰值不超过 chunkSize（ADR-101 防爆栈/压垮桥）", async () => {
    let inFlight = 0;
    let peak = 0;
    await concurrentMap(
      Array.from({ length: 12 }, (_, i) => i),
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1)); // 制造同批真实重叠
        inFlight--;
      },
      3,
    );
    expect(peak).toBeLessThanOrEqual(3); // 有界
    expect(peak).toBeGreaterThan(1); // 证明确实并发，未退化为串行
  });
});

describe("isLikelyTga — TGA 图像类型头校验（挡 MMD 假 .tga 占位文件）", () => {
  /** 造一个 18 字节 TGA 头，图像类型设在第 3 字节 */
  const tgaHeaderWith = (type: number): Uint8Array => {
    const b = new Uint8Array(18);
    b[2] = type;
    return b;
  };

  it("合法图像类型 {1,2,3,9,10,11} → true", () => {
    for (const t of [1, 2, 3, 9, 10, 11]) expect(isLikelyTga(tgaHeaderWith(t))).toBe(true);
  });

  it("非法图像类型（0/4/5/6/255）→ false（TGALoader 会刷错，跳过）", () => {
    for (const t of [0, 4, 5, 6, 255]) expect(isLikelyTga(tgaHeaderWith(t))).toBe(false);
  });

  it("不足 18 字节 → false（头不完整，不越界读）", () => {
    expect(isLikelyTga(new Uint8Array(0))).toBe(false);
    expect(isLikelyTga(new Uint8Array(17))).toBe(false);
  });

  it("恰好 18 字节的合法头 → true（长度边界）", () => {
    expect(isLikelyTga(tgaHeaderWith(2))).toBe(true);
  });
});
