// ===== bindings 类型 re-export 垫层（bindings 路径收口）=====
// bindings 是 wails3 生成物（路径由生成配置固定，不随架构大改移动）。
// 本垫层经 @/bindings 别名（tsconfig paths）直连生成目录，把 bindings 路径收口
// 为单一事实来源：生成路径变化只需改 tsconfig 映射，本文件与消费方零改动。
// 消费方一律 `import type { ... } from "@/utils/types-re-export.ts"`（ADR-146 别名，勿手算 ../）。
// 收口纪律：生产代码中 @/bindings 直连引用仅允许出现在本文件；
// 新增 bindings 类型 → 先在此处 re-export，再让消费方从本垫层导入（2026-09 锐评 P2 全量收口）。

export type { Group as DedupGroup } from "@/bindings/ysm-model-manager/go/dedup/models.ts";
export type { HealthReport } from "@/bindings/ysm-model-manager/go/repoaudit/models.ts";
export type { FileConflict } from "@/bindings/ysm-model-manager/go/sync/models.ts";
export type {
  AppConfig,
  VersionInstance,
  WorkshopCreator,
  WorkshopPresetSearch,
  WorkshopSite,
} from "@/bindings/ysm-model-manager/go/types/models.ts";
