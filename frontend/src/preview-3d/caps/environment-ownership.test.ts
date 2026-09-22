// ===== environment-ownership 纯判定单测（暗线 B 收口）=====
// 锁定「scene.environment 槽位所有权 / 源纹理可释放判定」单一事实源行为，
// 替代原先散在 environment-capability.ts 4 处的手抄排除集。零 THREE/DOM 依赖。

import { describe, it, expect } from "vitest";
import type * as THREE from "three";
import {
  envOwnsSceneEnvironment,
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
    expect(envOwnsSceneEnvironment(null, { envTexture: envTex, skySourcedTex: skySrc })).toBe(true);
  });

  it("槽位等于本 cap 自建 envTexture → 可还原", () => {
    expect(envOwnsSceneEnvironment(envTex, { envTexture: envTex, skySourcedTex: skySrc })).toBe(true);
  });

  it("槽位等于 sky 直装交回纹理（D-3 写者唯一红线）→ 可还原", () => {
    expect(envOwnsSceneEnvironment(skySrc, { envTexture: envTex, skySourcedTex: skySrc })).toBe(true);
  });

  it("槽位被后续其它 cap 写入（prev 非本 cap 所有）→ 不可还原（防冲掉他人）", () => {
    expect(envOwnsSceneEnvironment(prev, { envTexture: envTex, skySourcedTex: skySrc })).toBe(false);
  });
});
