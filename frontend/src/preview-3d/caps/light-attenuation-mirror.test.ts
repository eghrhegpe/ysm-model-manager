// @vitest-environment node
// ===== spotDistanceAttenuation 与 three 上游公式的镜像守卫 =====
// 背景：`spotDistanceAttenuation`（light-capability.ts）是 three 官方 shader chunk
// `lights_pars_begin.glsl.js` 的 `getDistanceAttenuation` 的**手抄快照**——用于把 UI 暴露的
// 「到达目标处照度(lx)」反推回 SpotLight.intensity 所需 candela（单位补偿）。three 升级若改了
// 该公式，本仓快照不跟，则**预览照度与实际渲染静默分叉**（画面「看起来还行」但数值错了），
// 原防线只有源码注释里一句「升级 three 时必须复核本函数」——注释拦不住构建。
//
// 本测试把「复核」变成**机器强制**：直接读取 three 随包发布的 GLSL 原文（非 mock 的 "three"
// 主入口，故走 src 子路径拿真实字符串），断言镜像公式的结构锚点仍在。three 升级若改动该 chunk，
// 本测试红 → 强制人类重新审计 spotDistanceAttenuation 并更新 allowed 说明，而非静默漂移。
// 对齐先例：water-capability 的 REVISION 断言 / water.md「升级 three 后必须重跑」。
import { describe, it, expect } from "vitest";
import glslLightsPars from "three/src/renderers/shaders/ShaderChunk/lights_pars_begin.glsl.js";
import { spotDistanceAttenuation } from "./light-capability.ts";

/** three 上游 GLSL 原文（随包发布的 shader chunk 源字符串）。 */
const upstreamGlsl: string = glslLightsPars;

describe("spotDistanceAttenuation — three 上游公式镜像守卫", () => {
  it("three 仍提供 getDistanceAttenuation 函数（上游若改名/迁走，本守卫须重新定位锚点）", () => {
    expect(upstreamGlsl).toContain("getDistanceAttenuation");
  });

  it("上游公式的三个结构锚点与镜像实现一致（升级 three 后若红，请重新审计本函数）", () => {
    const fn = upstreamGlsl.slice(upstreamGlsl.indexOf("getDistanceAttenuation"));
    const body = fn.slice(0, fn.indexOf("getSpotAttenuation"));
    // 锚点①：基础衰减 = 1 / max(pow(d, decay), 0.01) —— 镜像的 `1 / Math.max(d ** decay, 0.01)`
    expect(body).toMatch(/1\.0\s*\/\s*max\(\s*pow\(\s*lightDistance\s*,\s*decayExponent\s*\)\s*,\s*0\.01\s*\)/);
    // 锚点②：cutoff 窗口存在且受 `cutoffDistance > 0.0` 守卫 —— 镜像的 `cutoff > 0 ? … : 1`
    expect(body).toMatch(/cutoffDistance\s*>\s*0\.0/);
    // 锚点③：窗口形 = pow2(saturate(1 − pow4(d / cutoff))) —— 镜像的 `clamp(1-(d/cutoff)**4,0,1)**2`
    expect(body).toMatch(/pow2\(\s*saturate\(\s*1\.0\s*-\s*pow4\(\s*lightDistance\s*\/\s*cutoffDistance\s*\)\s*\)\s*\)/);
  });

  it("镜像实现数值语义：与上游公式逐式等价（含 cutoff=0 关闭窗口）", () => {
    // 复刻上游 GLSL 公式的 JS 直译——两侧独立实现，任何一侧漂移即失配
    const glslPort = (d: number, cutoff: number, decay: number): number => {
      let falloff = 1.0 / Math.max(d ** decay, 0.01);
      if (cutoff > 0.0) {
        const saturate = Math.min(1, Math.max(0, 1 - (d / cutoff) ** 4));
        falloff *= saturate ** 2;
      }
      return falloff;
    };
    const cases: Array<[number, number, number]> = [
      [8, 30, 1.5], // 默认 targetHeight=8 / distance=30 / decay=1.5
      [1, 0, 2], // cutoff=0 → 关闭窗口分支
      [0, 30, 1.5], // 零距（pow 下限 0.01 生效）
      [29.9, 30, 1], // 窗口邻近边界
      [30, 30, 1.5], // 恰在 cutoff（窗口归零）
      [45, 30, 2], // 超出 cutoff
    ];
    for (const [d, cutoff, decay] of cases) {
      expect(spotDistanceAttenuation(d, cutoff, decay)).toBeCloseTo(glslPort(d, cutoff, decay), 12);
    }
  });

  it("越界/边界不被静默放行：cutoff<=0 时窗口系数恒为 1（不误伤基础衰减）", () => {
    // cutoff=0 语义 = 「无截止距离」→ 只留 1/d^decay
    expect(spotDistanceAttenuation(10, 0, 2)).toBeCloseTo(1 / 100, 12);
    // 恰在 cutoff 处窗口归零 → 整体归零（上游 pow4=1 → saturate(0) → pow2(0)=0）
    expect(spotDistanceAttenuation(30, 30, 1.5)).toBe(0);
  });
});
