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

/**
 * env cap 在场探针的**最小结构契约**（鸭子类型，非 `EnvironmentCapability`）。
 *
 * ⚠️ 刻意**不**在本文件 import `getTypedCap` / `EnvironmentCapability`：本模块是
 * **零依赖纯叶**（仅 `import type * as THREE`），是 `env-pixels.ts` / `persist-utils.ts`
 * 同款的建模范式（知识卡 preview-env-state 记其为「ownership 契约集中在可单测的一处」）。
 * 引入 cap 类型链会把整个 caps 层拖进依赖图，毁掉叶子性质并新增模块环风险。
 * 调用方用 `getTypedCap(lookup, "environment")` 产出的实例天然满足此结构。
 * `isEnabled` 声明为可选：兼容测试桩与「registry 不传 isEnabled」的宽cap 形态。
 */
export interface EnvPresenceProbe {
  isEnabled?: () => boolean;
}

/**
 * **D10「让权判据」单一事实源**：`scene.environment` 槽位此刻是否该让给 env cap。
 *
 * [ADR-292 D1 + D10] `scene.environment` 的唯一写者是 env cap；sky 只是数据源提供者。
 * 判「env 该不该让权」的正确问题是**「env cap 在场且启用吗」**——而非「env 是不是 sky 源」
 * （那是 `EnvironmentCapability.isSkySourced` 的问题，语义**不等价**，见其注释）。
 *
 * [锐评 2026-10-08 P1-2] 收口前该判据手抄**4 处**：
 *   - `sky-capability.ts|requestEnvironmentRefresh`（D10 路由器，原型）
 *   - `sky-capability.ts` 的 `skyEnvironment` 分支
 *   - `sky-capability.ts|clearEnvironment`（注释自称「与路由器同源」实为复制）
 *   - `light-capability.ts|refreshAmbientFromSky`（IBL 让位，同一问题的另一个问法）
 * 手抄即分账隐患：改判据须同步4 处，漏一处即复现 `ce0ec8090` 修掉的原病灶
 * （默认 `envSource="preset"` 下 sky 顶掉 env 装载，「写者唯一」形同虚设）。
 *
 * **env 缺席或关闭 ⇒ 不让权**（false）：此时 sky 才走自持兜底装载，那条路才受
 * `skyEnvironment` 旧开关门控——这是 D10 判据与「sky 自持开关」的分界，勿混。
 *
 * @param envCap env cap 实例或 undefined（cap 缺席/未构造）——nullish 与 isEnabled 缺省皆false
 */
/**
 * D10 让权判据，纯函数 + **类型谓词收窄**。
 * 收窄的意义（[锐评 2026-10-08 P1-2] tsc 实测）：返回类型标为
 * `envCap is EnvPresenceProbe` 后，「让权为 true ⇒ env 必然非空」这条**蕴含关系对编译器
 * 可见**，sky 侧 `if (envShouldYieldSlot(env)) { env.…(…) }` 不再需要 `!` 断言即可通过类型检查。
 * 这不是可有可无的类型体操——它是把「判据语义」与「判据之后必然成立的事实」绑在同一处定义，
 * 避免调用点各自补 `as` / `!`（那正是又一次分家）。
 */
export function envShouldYieldSlot(
  envCap: EnvPresenceProbe | null | undefined,
): envCap is EnvPresenceProbe {
  return envCap?.isEnabled?.() ?? false;
}
