// ===== 统一场景状态单例 + setEnvState（ADR-196 刀 0）=====
// 可变单例 envState + 中央写入入口 + lastWriteSource 守卫决策。
// 仿 MikuMikuAR setEnvState 模式。

import { dispatchEnvChange } from "./env-dispatcher.ts";
import { deriveDefaultEnvState, type EnvState } from "./env-state-schema.ts";

// 可变单例（仿 MikuMikuAR envState）
export const envState: EnvState = deriveDefaultEnvState() as EnvState;

// 写入来源标记
type WriteSource = "auto-model" | "auto-atmosphere" | "manual";

// 各字段最后一次写入来源
const _writeSource: Record<string, WriteSource> = {};

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

// 迁移（预留，当前无迁移逻辑）
function migrateEnvState(partial: Partial<EnvState>): Partial<EnvState> {
  return partial;
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
  opts?: { source?: WriteSource; force?: boolean },
): void {
  const source = opts?.source ?? "auto-model";
  const force = opts?.force ?? false;
  const migrated = migrateEnvState(partial);

  const changedKeys = new Set<string>();
  for (const key of Object.keys(migrated) as Array<keyof EnvState>) {
    if (force || shouldOverwrite(key as string, source)) {
      (envState as any)[key] = migrated[key];
      _writeSource[key as string] = source;
      changedKeys.add(key as string);
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
  return (envState as any)[path];
}

/**
 * StatePath 写（菜单控件用）。
 */
export function setStateValue(path: string, value: unknown): void {
  setEnvState({ [path]: value } as Partial<EnvState>, { source: "manual" });
}

/**
 * 重置单例（测试用）。
 */
export function resetEnvState(): void {
  const defaults = deriveDefaultEnvState();
  for (const key of Object.keys(defaults) as Array<keyof EnvState>) {
    (envState as any)[key] = defaults[key];
  }
  for (const key of Object.keys(_writeSource)) {
    delete _writeSource[key];
  }
}
