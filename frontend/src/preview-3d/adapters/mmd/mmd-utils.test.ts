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
import { estimateTexGpuBytes } from "./mmd-utils.ts";

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
