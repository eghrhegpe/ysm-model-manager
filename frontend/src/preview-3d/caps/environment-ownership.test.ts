// ===== environment-ownership 纯判定单测（暗线 B 收口）=====
// 锁定「scene.environment 槽位所有权 / 源纹理可释放判定」单一事实源行为，
// 替代原先散在 environment-capability.ts 4 处的手抄排除集。零 THREE/DOM 依赖。

import { describe, it, expect } from "vitest";
import type * as THREE from "three";
import {
  envOwnsSceneEnvironment,
  envShouldYieldSlot,
  isEnvDisposableSource,
  type EnvBorrowedTextures,
} from "./environment-ownership.ts";

// 用最小桩模拟 THREE.Texture（仅取引用身份）；引用相等是判定核心。
function tex(id: string): THREE.Texture {
  return { id } as unknown as THREE.Texture;
}

const custom = tex("custom");
const sky = tex("sky");
const owned = tex("owned");
const prev = tex("prev");

describe("isEnvDisposableSource（源纹理可释放判定）", () => {
  const base: EnvBorrowedTextures = { customHdrTex: custom, skySourcedTex: sky };

  it("null 永远不可释放", () => {
    expect(isEnvDisposableSource(null, base)).toBe(false);
  });

  it("customHdrTex / skySourcedTex 不可释放（借来/他人所有）", () => {
    expect(isEnvDisposableSource(custom, base)).toBe(false);
    expect(isEnvDisposableSource(sky, base)).toBe(false);
  });

  it("本 cap 自建产物可释放", () => {
    expect(isEnvDisposableSource(owned, base)).toBe(true);
  });

  it("extraExclude 缺省（undefined）时退化为仅排除 custom/sky", () => {
    // 与旧 applyBackground / pmremToSceneEnv 无 extraExclude 传参逐字等价
    expect(isEnvDisposableSource(owned, { ...base, extraExclude: undefined })).toBe(true);
  });

  it("extraExclude 命中时不可释放（复审 D：同引用短路旧图并入排除集）", () => {
    expect(isEnvDisposableSource(owned, { ...base, extraExclude: owned })).toBe(false);
  });
});

describe("envOwnsSceneEnvironment（离场还原守卫）", () => {
  const envTex = tex("envRT");
  const skySrc = tex("sky");

  it("槽位为 null → 可还原（已清或本 cap 清空）", () => {
    expect(envOwnsSceneEnvironment(null, [envTex, skySrc])).toBe(true);
  });

  it("槽位等于本 cap 自建 envTexture → 可还原", () => {
    expect(envOwnsSceneEnvironment(envTex, [envTex, skySrc])).toBe(true);
  });

  it("槽位等于 sky 直装交回纹理（D-3 写者唯一红线）→ 可还原", () => {
    expect(envOwnsSceneEnvironment(skySrc, [envTex, skySrc])).toBe(true);
  });

  it("槽位被后续其它 cap 写入（prev 非本 cap 所有）→ 不可还原（防冲掉他人）", () => {
    expect(envOwnsSceneEnvironment(prev, [envTex, skySrc])).toBe(false);
  });

  it("sky cap 单 owned 纹理形态（[ownedEnv] 等价 {envTexture}）→ 仅认自身 renderTarget 纹理", () => {
    // sky-capability.dispose 复用同一谓词，传单一 renderTarget.texture 集合
    expect(envOwnsSceneEnvironment(owned, owned)).toBe(true);
    expect(envOwnsSceneEnvironment(prev, owned)).toBe(false);
  });
});

// [锐评 2026-10-08 P1-2] D10 让权判据单一事实源。
// 收口前该判据手抄 4 处（sky×3 + light×1），其中 sky|clearEnvironment 的注释自称
// 「与 requestEnvironmentRefresh 同源」实为复制——注释断言的「同源」当时并未成立。
// 守卫重点 = **三种否定形态**（这正是原手抄 `env?.isEnabled?.()` 的全部语义）：
// nullish / isEnabled 缺省 / 显式 false，三者都必须「不让权」——
// 因为只有让权 false 才轮到 sky 走自持兜底装载，那条路才受 skyEnvironment 旧开关门控。
describe("envShouldYieldSlot（D10 让权判据：槽位去留是否归 env）", () => {
  it("env 在场且启用 → 让权（env 是 scene.environment 唯一写者）", () => {
    expect(envShouldYieldSlot({ isEnabled: () => true })).toBe(true);
  });

  it("env 在场但关闭 → 不让权（sky 才走自持兜底路）", () => {
    expect(envShouldYieldSlot({ isEnabled: () => false })).toBe(false);
  });

  it("env 缺席（undefined / null）→ 不让权", () => {
    expect(envShouldYieldSlot(undefined)).toBe(false);
    expect(envShouldYieldSlot(null)).toBe(false);
  });

  it("isEnabled 缺省（宽 cap / 测试桩形态）→ 不让权，与旧手抄逐字等价且不抛错", () => {
    expect(envShouldYieldSlot({})).toBe(false);
  });

  // 语义边界守卫：本判据问的是「env 在场吗」，**不是**「env 是不是 sky 源」。
  // 混淆二者正是 ce0ec8090 修掉的原病灶（默认 envSource="preset" 下 sky 顶掉 env 装载，
  // 「写者唯一」形同虚设）。纯函数层无从得知 envSource——本例锁死「不引入该语义」。
  it("判据只问在场与否：预设通路（env 开但非 sky 源）同样让权", () => {
    expect(envShouldYieldSlot({ isEnabled: () => true })).toBe(true);
  });
});
