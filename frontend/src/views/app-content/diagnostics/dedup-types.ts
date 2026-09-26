// ===== 去重扫描：类型与默认值（2026-09 锐评 P1 自 dedup.ts 拆出）=====
// 默认值冻结为唯一权威源；会话 config 为可编辑副本；reset 从默认值展开。
// 注意：显式标宽 strategy/keepPolicy/priorityPath 为 string，避免 Object.freeze
// 泛型保留字面量类型（"deep_hash"）导致 select.value(string) 赋值失败。

import type { ResourceType } from "@/utils/resource/schema.ts";
import type { DedupGroup } from "@/utils/types-re-export.ts";

export interface DedupConfigShape {
  strategy: string;
  keepPolicy: string;
  priorityPath: string;
}

export const DEDUP_DEFAULTS: Readonly<DedupConfigShape> = Object.freeze({
  // strategy 默认 deep_hash：Go 侧 strategy.go NewHashAlgorithm 对 "deep_hash" 有**显式 case**
  // （非 default 兜底），契约锁见 go/dedup/strategy_test.go TestNewHashAlgorithm_FrontendTokens。
  // keepPolicy/priorityPath 仅前端消费（dedup-policy.ts 决定保留哪个），Go 不应用它们。
  strategy: "deep_hash",
  keepPolicy: "oldest",
  priorityPath: "",
});

// ===== 扫描中间结构 =====
export interface ScanTarget {
  id: string;
  icon: string;
  label: string;
  dir: string;
}

export interface ScanFile {
  path: string;
  name: string;
  size: number;
  modTime?: string;
}

export interface ScanGroup {
  files: ScanFile[];
}

export interface ScanGroupResult {
  icon: string;
  label: string;
  groups: ScanGroup[];
}

// ===== 绑定注入类型 =====
export type GetRepoRootFn = (rtype: string) => Promise<string>;

/** 可取消 Promise 形态（ADR-314）：对齐 @wailsio/runtime CancellablePromise.cancel 的
 * 真实签名（返回 void | PromiseLike<void>）——注入类型不 import runtime 包，
 * 诊断页保持可 mock；生产侧绑定返回的 $CancellablePromise 结构性满足本形态。 */
export type Cancellable<T> = Promise<T> & { cancel: (cause?: unknown) => void | PromiseLike<void> };

// 锐评①（2026-09 对接收口）：FindDuplicateFiles 已从 (dir, configStr JSON 文本协议)
// 收口为 (dir, strategy token) 直传——keepPolicy/priorityPath 是纯前端保留决策
// （dedup-policy.ts），只存在于会话 config，不再随扫描请求搭车穿 Go。
// ADR-314：返回值可取消（Go 侧 ctx 贯穿，用户可中止全量哈希）。
export type FindDuplicateFilesFn = (
  dir: string,
  strategy: string,
) => Cancellable<DedupGroup[] | null>;
export type MoveToRecycleFn = (path: string) => Promise<void>;
export type DedupRegType = Record<string, ResourceType>;
