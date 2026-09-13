// ===== 去重扫描：类型与默认值（2026-09 锐评 P1 自 dedup.ts 拆出）=====
// 默认值冻结为唯一权威源；会话 config 为可编辑副本；reset 从默认值展开。
// 注意：显式标宽 strategy/keepPolicy/priorityPath 为 string，避免 Object.freeze
// 泛型保留字面量类型（"deep_hash"）导致 select.value(string) 赋值失败。

import type { loadResourceRegistry } from "@/services/resource-registry.ts";
import type { DedupGroup } from "@/utils/types-re-export.ts";

export interface DedupConfigShape {
  strategy: string;
  keepPolicy: string;
  priorityPath: string;
}

export const DEDUP_DEFAULTS: Readonly<DedupConfigShape> = Object.freeze({
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
export type FindDuplicateFilesFn = (dir: string, configStr: string) => Promise<DedupGroup[] | null>;
export type MoveToRecycleFn = (path: string) => Promise<void>;
export type DedupRegType = Awaited<ReturnType<typeof loadResourceRegistry>>;
