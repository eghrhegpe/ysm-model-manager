// ===== environment-ownership — scene.environment 槽位所有权纯判定（暗线 B 收口）=====
// 抽取自 environment-capability.ts：原「谁拥有 scene.environment / 谁可被 env 安全 dispose」
// 的判定散在 4 个方法里（applyBackground / pmremToSceneEnv / disposeEnvironment / dispose），
// 每个都是 `tex !== customHdrTex && tex !== skySourcedTex && …` 的手抄排除集——ADR-292 D1/D3/D7
// 的「写者唯一」契约全靠这套重复硬比对钉住，漏改任一即静默错 dispose（如误释 sky 的
// renderTarget 纹理 → 天空 IBL 黑）。
// 现收口为两个纯函数（零 EnvironmentCapability 依赖，实例字段经参数注入），与 env-pixels.ts
// 同范式：让 ownership 契约集中在可单测的一处，行为与原实现逐字等价
// （契约：environment-capability.test.ts 的 D-3/D-4/E-4 用例 + 本文件 environment-ownership.test.ts）。
//
// 背景事实（ADR-292）：scene.environment 是**多 cap 共享全局槽位**，唯一写者是本 env cap。
// 三条纹理 env cap **不得 dispose**：
//   - customHdrTex：本 cap 长期缓存（由 disposeCustomCache 释放），非本次重建产物
//   - skySourcedTex：sky 的 renderTarget 产物，归 sky 所有（env 直装其 cubeUV，严禁二次滤波/释放）
//   - prevEnvironment：构造前快照，dispose 还原用，非本 cap 创建
// 其余（preset 程序化 CanvasTexture / 本 cap 自建 PMREM RT 源）env cap 拥有，可释放。

import type * as THREE from "three";

/** env cap 不得 dispose 的「借来/他人所有」纹理集合（实例字段经参数注入） */
export interface EnvBorrowedTextures {
  /** 用户 HDR 长期缓存（disposeCustomCache 释放，非 env 重建产物） */
  customHdrTex: THREE.Texture | null;
  /** 天空直装烘焙纹理（归 sky 的 renderTarget 所有） */
  skySourcedTex: THREE.Texture | null;
  /** 复审 D 收口：同引用短路时覆盖前的旧图（天空分支 disposeEnvironment 传入），并入排除集 */
  extraExclude?: THREE.Texture | null | undefined;
}

/**
 * env cap 是否可安全 dispose 给定源纹理（不含 PMREM RT 自身——那由 envRT 管）。
 * 返回 false 的纹理（customHdrTex / skySourcedTex / extraExclude / null）一律不得由本 cap 释放。
 * 收口原 `srcTex !== customHdrTex && srcTex !== skySourcedTex`（pmremToSceneEnv）与
 * `backgroundSrcTex !== customHdrTex && … && !== extraExclude`（disposeEnvironment / applyBackground）
 * 两套手抄排除集为单一事实源——extraExclude 缺省（undefined）时退化为后两者，
 * 故 applyBackground / pmremToSceneEnv 无 extraExclude 传参亦逐字等价。
 */
export function isEnvDisposableSource(tex: THREE.Texture | null, b: EnvBorrowedTextures): boolean {
  if (!tex) return false;
  return tex !== b.customHdrTex && tex !== b.skySourcedTex && tex !== (b.extraExclude ?? null);
}

/**
 * env 离场时是否可安全把 scene.environment 还原为 prevEnvironment（收口原散落两处的手写判定：
 * environment-capability.dispose 的 `=== null || === envTexture || === skySourcedTex` 与
 * sky-capability.dispose 的 `=== null || === ownedEnv` 为单一事实源）。
 * `owned` 为本 cap 享有还原权的纹理集合：env cap 传 [envTexture, skySourcedTex]（D-3 直装独占），
 * sky cap 传 [renderTarget.texture]（自身烘焙产物）。null 槽位恒可还原（早已清或本 cap 清空）。
 * 否则槽位被**后续其它 cap**写入，越权还原会冲掉他人贴图（黑天）→ 不碰。
 */
export function envOwnsSceneEnvironment(
  slot: THREE.Texture | null,
  owned: THREE.Texture | null | readonly (THREE.Texture | null)[],
): boolean {
  if (slot === null) return true;
  const owners = Array.isArray(owned) ? owned : [owned];
  return owners.includes(slot);
}
