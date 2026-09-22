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

/** env cap 对 scene.environment 槽位的占有权（dispose 时是否可还原 prevEnvironment） */
export interface EnvSlotOwnership {
  /** 本 cap 自建的 PMREM 产物纹理（scene.environment 写者之一） */
  envTexture: THREE.Texture | null;
  /** 天空直装交回的纹理（env 经直装独占该槽位，D-3 红线） */
  skySourcedTex: THREE.Texture | null;
}

/**
 * [锐评 E-4 / D-3] env 离场时是否可安全把 scene.environment 还原为 prevEnvironment。
 * 收口原 `scene.environment === null || === ownedEnv || === skySourcedTex` 三态判定为单一事实源：
 *   - null：早已清（或本 cap 清空）
 *   - 等于本 cap 自建 envTexture：本 cap 写的，还原无碍
 *   - 等于 skySourcedTex：env 经直装独占该槽位（D1 写者唯一）→ env 离场即还原，不赌 registry 反序 dispose
 *   - 否则：槽位被**后续其它 cap**（或射线/后处理）写入，env 越权还原会冲掉他人贴图（黑天）→ 不碰。
 */
export function envOwnsSceneEnvironment(slot: THREE.Texture | null, o: EnvSlotOwnership): boolean {
  return slot === null || slot === o.envTexture || slot === o.skySourcedTex;
}
