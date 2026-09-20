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

// 挂起计数器：loadState 等恢复路径期间 suspend，避免 setEnvState 同步派发导致重入双跑（ADR-281 已知遗留收口）。
let _suspended = 0;

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
  // 挂起态（loadState 期间）：跳过派发，恢复路径只写 envState，末尾统一应用一次。
  if (_suspended > 0) return;
  for (const { cb, groupKeys } of _callbacks.values()) {
    try {
      if (groupKeys) {
        // 热路径（昼夜循环每帧派发 × 全 cap）：先**探测**是否有本组键，有才构造 filtered。
        // 原实现在此处无条件 `new Set` —— 即便一个键都不匹配（sky 帧对 water/fog/ground 回调
        // 即典型场景），也为每个带 group 的 cap 各分配一个空 Set。
        // 先探测后分配：不匹配时零分配、零回调，语义与原先完全一致。
        let hit = false;
        for (const k of changed) {
          if (groupKeys.has(k)) {
            hit = true;
            break;
          }
        }
        if (!hit) continue;
        const filtered = new Set<EnvStateKey>();
        for (const k of changed) {
          if (groupKeys.has(k)) filtered.add(k);
        }
        cb(filtered, state);
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
  // 挂起计数一并复位：clear 是「全清」语义，兼作测试隔离兜底——否则任一 suspend 逃逸（抛出/
  // 提前 return）会让 _suspended 跨测试存活，后续全仓 envState 派发静默假死（envState 有值、
  // Three 不更新、无任何报错）。
  _suspended = 0;
}

/**
 * 挂起全部 env 回调派发（loadState 期间使用）。
 * 恢复路径会**同步** setEnvState → 同步触发 onEnvChanged，此时 Three 灯对象仍是旧类型，
 * callback 里 syncLight 会先拿新 envState 重建一次，回到显式同步入口又跑一遍（重入双跑）。
 * 挂起后恢复路径只写 envState，末尾统一应用一次，消除双跑窗口。
 * 计数器语义：多次挂起只需一次 resume 即恢复，resume 与 suspend 不配对也安全。
 *  ⚠️ **粒度是全局的，不是「只挡 light」**：挂起期间所有 cap 的派发都停。当前唯一调用点
 *  是 LightCapability.loadState（自身同步块内闭合，registry.loadAll 顺序串行，跨 cap 无重叠窗），
 *  故无受害方——但本机制**只保证单 cap 自身重入收敛，不是跨 cap 事务边界**，
 *  勿用于「先改 A 再改 B，中间别派发」这类场景（其它 cap 会错过派发）。
 *  另：clearEnvCallbacks 会一并复位计数（测试隔离兜底）。 */
export function suspendEnvCallbacks(): void {
  _suspended++;
}

/** 恢复 env 回调派发（与 suspendEnvCallbacks 配对）。 */
export function resumeEnvCallbacks(): void {
  _suspended = Math.max(0, _suspended - 1);
}

/** 是否处于挂起态（测试用）。 */
export function isEnvCallbacksSuspended(): boolean {
  return _suspended > 0;
}
