// ===== 统一场景状态派发器（ADR-196 刀 0）=====
// 状态变更回调注册表 + dispatchEnvChange 派发。
// 仿 MikuMikuAR dispatchEnvChange 模式。

import type { EnvState } from "./env-state-schema.ts";

export type EnvCallback = (changed: Set<string>, state: EnvState) => void;

// 回调注册表（cap 在构造时注册，析构时取消）
const _callbacks = new Map<unknown, EnvCallback>();

/**
 * 注册状态变更回调（cap 用）。
 * 返回取消订阅函数。
 */
export function registerEnvCallback(cap: unknown, cb: EnvCallback): () => void {
  _callbacks.set(cap, cb);
  return () => {
    _callbacks.delete(cap);
  };
}

/**
 * 派发状态变更到所有已注册 cap。
 * 由 setEnvState 调用。
 */
export function dispatchEnvChange(changed: Set<string>, state: EnvState): void {
  for (const cb of _callbacks.values()) {
    try {
      cb(changed, state);
    } catch (e) {
      // ringLog 兜底
      console.warn("[env-dispatcher] 回调异常:", e);
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
