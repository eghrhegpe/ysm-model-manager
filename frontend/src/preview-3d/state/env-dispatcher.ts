// ===== 统一场景状态派发器（ADR-196 刀 0）=====
// 状态变更回调注册表 + dispatchEnvChange 派发。
// 仿 MikuMikuAR dispatchEnvChange 模式。

import { ringLog } from "@/preview-3d/caps/scene-capability.ts";
import type { EnvState } from "./env-state-schema.ts";
import { type EnvStateKey, getPresetKeys } from "./env-state-schema.ts";

export type EnvCallback = (changed: Set<EnvStateKey>, state: EnvState) => void;

interface Registration {
  cb: EnvCallback;
  /** 非空时只派发 group 匹配的键（前置过滤，cap 回调不再需要自行过滤） */
  group?: string | readonly string[];
  /** group 键集，注册时算一次缓存（getPresetKeys 是静态查表；昼夜循环每帧派发，
   *  若每次 dispatch 重建 Set 会在热路径重复分配——锐评 §四） */
  groupKeys?: Set<EnvStateKey>;
}

// 回调注册表（cap 在构造时注册，析构时取消）
const _callbacks = new Map<unknown, Registration>();

/**
 * 注册状态变更回调（cap 用）。
 * @param cap  注册主体（能力实例，用于取消订阅）
 * @param cb   回调函数
 * @param group 可选：只接收该 group 的键变更（如 "sky"/"fog"/"ground" 等）；
 *              省略则接收全量（兼容未分组场景）。
 *              **[ADR-250] 可为数组**——cap 跨组关注时使用（如 sky 拥有曝光属主，
 *              需同时消费自己组的 `skyExposure` 与 postprocessing 组的 `ppExposure`）。
 *              单组仍传字符串（既有调用点零改动）。
 * 返回取消订阅函数。
 */
export function registerEnvCallback(
  cap: unknown,
  cb: EnvCallback,
  group?: string | readonly string[],
): () => void {
  if (!group) {
    _callbacks.set(cap, { cb });
  } else {
    const groups = typeof group === "string" ? [group] : group;
    const keys = new Set<EnvStateKey>();
    for (const g of groups) {
      for (const k of getPresetKeys(g)) keys.add(k);
    }
    _callbacks.set(cap, { cb, group, groupKeys: keys });
  }
  return () => {
    _callbacks.delete(cap);
  };
}

/**
 * 派发状态变更到所有已注册 cap。
 * 由 setEnvState 调用。
 * 带 group 注册的 cap 只收到 group 匹配的键（前置过滤）。
 */
export function dispatchEnvChange(changed: Set<EnvStateKey>, state: EnvState): void {
  for (const { cb, groupKeys } of _callbacks.values()) {
    try {
      if (groupKeys) {
        const filtered = new Set<EnvStateKey>();
        for (const k of changed) {
          if (groupKeys.has(k)) filtered.add(k);
        }
        if (filtered.size > 0) cb(filtered, state);
      } else {
        cb(changed, state);
      }
    } catch (e) {
      ringLog("env-dispatcher", "回调异常", "warn", () => {
        console.warn("[env-dispatcher] 回调异常:", e);
      });
    }
  }
}

/**
 * 获取当前注册数量（测试用）。
 */
export function getEnvCallbackCount(): number {
  return _callbacks.size;
}

/**
 * 清空所有回调（测试用，防止 cap 泄漏跨测试）。
 */
export function clearEnvCallbacks(): void {
  _callbacks.clear();
}
