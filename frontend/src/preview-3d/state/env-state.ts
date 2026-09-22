// ===== 统一场景状态单例 + setEnvState（ADR-196 刀 0）=====
// 可变单例 envState + 中央写入入口 + lastWriteSource 守卫决策。
// 仿 MikuMikuAR setEnvState 模式。

import { dispatchEnvChange } from "./env-dispatcher.ts";
import {
  clampFieldValue,
  deriveDefaultEnvState,
  type EnvState,
  type EnvStateKey,
} from "./env-state-schema.ts";

// 可变单例（仿 MikuMikuAR envState）
export const envState: EnvState = deriveDefaultEnvState() as EnvState;

// 写入来源标记（类型出口见上方 WriteSource）

// 各字段最后一次写入来源
const _writeSource: Record<string, WriteSource> = {};

/**
 * ADR-254：envState 写入中间件。
 * 拿到**本次 patch**，可返回一个补充 patch（合并回本次写入）；返回 undefined 表示不改。
 * 只在真正写入前执行，不持有实例、不落盘。
 * meta.source（锐评修复 2026-09-21）：中间件必须能区分「用户手改」与程序化写入——
 * 「手改即脱离预设」类标记只许消费 manual；auto-model / auto-atmosphere（氛围预设快照、
 * 模型默认值等程序化派发）携带同一批字段时不得误触发。这是豁免通道的**来源维度**，
 * 与 opts.skipMiddleware（存档恢复显式豁免）互补：前者防全局漏网，后者供逐调用点声明。
 */
export type WriteSource = "auto-model" | "auto-atmosphere" | "manual";

export type EnvStateMiddleware = (
  patch: Partial<EnvState>,
  meta: { source: WriteSource },
) => Partial<EnvState> | undefined;

const _writeMiddlewares: EnvStateMiddleware[] = [];

/** 注册写入中间件（顺序执行）。测试间需 `clearEnvStateMiddlewares()` 防泄漏。 */
export function registerEnvStateMiddleware(mw: EnvStateMiddleware): void {
  _writeMiddlewares.push(mw);
}

/** 清空中间件（测试用）。 */
export function clearEnvStateMiddlewares(): void {
  _writeMiddlewares.length = 0;
}

/**
 * 守卫决策：当前写入是否应覆盖已有值。
 * 优先级：manual > auto-atmosphere > auto-model
 */
function shouldOverwrite(key: string, source: WriteSource): boolean {
  const prev = _writeSource[key] ?? "auto-model";
  if (source === "manual") return true;
  if (source === "auto-atmosphere" && prev !== "manual") return true;
  if (source === "auto-model" && prev === "auto-model") return true;
  return false;
}

// 防抖持久化：ADR-196 刀0 原规划 env-state-persist，现持久化仍由各 cap saveState/loadState
// 承担（旧键轨向后兼容），envState 层不做第二层持久化（避免双写双恢复冲突），此处不设空壳。

/**
 * 中央写入入口（仿 MikuMikuAR setEnvState）。
 * 写入带来源标记，按 lastWriteSource 优先级决策是否覆盖。
 * force=true：跳过 shouldOverwrite 守卫强制写入（code_review df84baefb #1/#14——仅供
 * 昼夜循环这类动画驱动器使用：autoRotate 持续推进 skyTimeOfDay 是动画自身行为，用户
 * 拖过一次时间滑杆（manual）不该把动画永久冻结；恢复 ADR-196 前 update(dt) 直接推进
 * params 的无条件语义。普通调用方不得用 force 覆盖用户 manual 值）。
 */
export function setEnvState(
  partial: Partial<EnvState>,
  opts?: { source?: WriteSource; force?: boolean; skipMiddleware?: boolean },
): void {
  const source = opts?.source ?? "auto-model";
  const force = opts?.force ?? false;

  // ADR-254：写入中间件（邻座 registerEnvStateMiddleware 的最小等价物）。
  // 范式：中间件拿到**本次 patch**，可返回补充 patch（合并回本次写入）。
  // 用途：地面材质的「手改即脱离预设」标记收口——只在此一处置位，
  // 不靠每个 setter 自觉（防漏、防前缀匹配误清）。
  // skipMiddleware：存档恢复/程序化同步等**非用户手改**写入豁免——恢复路径的
  // 配色还原不得被误判为「已手改」（ADR-254 审核修正：loadState 逐字段恢复
  // 曾把用户选的预设恒打成 custom）。
  let patch = partial;
  if (!opts?.skipMiddleware) {
    for (const mw of _writeMiddlewares) {
      const extra = mw(patch, { source });
      if (extra) patch = { ...patch, ...extra };
    }
  }

  const changedKeys = new Set<EnvStateKey>();
  for (const key of Object.keys(patch) as Array<keyof EnvState>) {
    if (force || shouldOverwrite(key as string, source)) {
      // ADR-283：值域钳制在**唯一写入口**执行——setter / 存档恢复 / 预设 / 中间件产物
      // 一律就范，各 cap 不再自备 clamp（防「一处参数六处接线各钳一套」）。
      // ⚠️ 故意不做「同值去重」（锐评修复 2026-09-20 实测回退）：同值重写派发是
      // 多 cap 的既有契约——shadow setMapSize(2048) 重写触发 structural 重应用、
      // skyForceEnv 等「本次 patch 携带即要求响应」的脉冲键粘滞后再写仍是新请求。
      // 中央去重会静默吞掉这些重触发（三套回归用例实证）。省白刷的责任下沉到
      // 各 cap 的离散 setter 早退守卫；但注意带意图的写入（如地面「手改即 custom」
      // 中间件所消费的 mat 系键）同值写仍是新请求，不得局部早退。
      (envState as unknown as Record<string, unknown>)[key as string] = clampFieldValue(
        key,
        patch[key],
      );
      _writeSource[key as string] = source;
      changedKeys.add(key);
    }
  }

  if (changedKeys.size > 0) {
    dispatchEnvChange(changedKeys, envState);
  }
}

/**
 * StatePath 读（菜单控件用）。
 */
export function getStateValue(path: string): unknown {
  return (envState as unknown as Record<string, unknown>)[path];
}

/**
 * StatePath 写（菜单控件用）。
 */
export function setStateValue(path: string, value: unknown): void {
  setEnvState({ [path]: value } as Partial<EnvState>, { source: "manual" });
}

/**
 * [锐评 F-1] SSR 活跃判定的唯一事实源：后处理主开关开 ∧ 反射模式含 ssr。
 * 语义 = 「SSRPass 此刻真的在渲染」——R-1 血案修正：pp 关掉时 pass 已旁路，SSR 没在
 * 渲染，不得白禁地面镜面 / 白跳水面镜像。判别式曾被两处各手抄一份（pp 侧还随血案
 * 演化过一次）——手抄即分叉隐患，收编纯函数单源：
 *   - postprocessing-capability|applyReflectorSync（压制地面单平面镜）
 *   - water-capability|reflectionActive（抑制水面模型倒影，ADR-297）
 * water 侧仍守「逐帧现读不另订阅」纪律（pp 键属 postprocessing 组，water 回调收不到
 * 派发）——现读的是**本判定**，不是手抄公式。
 */
export function isSsrRenderActive(): boolean {
  return envState.ppEnabled && envState.ppReflectionMode !== "envmap-only";
}

/**
 * 重置单例（测试用）。
 */
export function resetEnvState(): void {
  const defaults = deriveDefaultEnvState();
  for (const key of Object.keys(defaults) as Array<keyof EnvState>) {
    (envState as unknown as Record<string, unknown>)[key as string] = defaults[key];
  }
  for (const key of Object.keys(_writeSource)) {
    delete _writeSource[key];
  }
}
