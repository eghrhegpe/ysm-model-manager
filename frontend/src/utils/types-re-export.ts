// ===== bindings 类型 re-export 垫层（bindings 路径收口）=====
// bindings 是 wails3 生成物（路径由生成配置固定，不随架构大改移动）。
// 本垫层经 @/bindings 别名（tsconfig paths）直连生成目录，把 bindings 路径收口
// 为单一事实来源：生成路径变化只需改 tsconfig 映射，本文件与消费方零改动。
// 消费方一律 `import type { ... } from "@/utils/types-re-export.ts"`（ADR-146 别名，勿手算 ../）。
// 收口纪律：生产代码中 @/bindings 直连引用仅允许出现在本文件；
// 新增 bindings 类型 → 先在此处 re-export，再让消费方从本垫层导入（2026-09 锐评 P2 全量收口）。
// 注意：本文件只允许 export type（编译期抹除）。bindings 的**运行时值**（如 Go 枚举对象）
// 不得经此再导出——@/bindings 别名仅活在 tsconfig/vite 构建解析中，vitest 运行时对值导入
// 会解析失败；需要与枚举比较时按"成员值=Go 常量字面量"用 String() 归一后比字面量（见 logs.ts）。

export type { Group as DedupGroup } from "@/bindings/ysm-model-manager/go/dedup/models.ts";
export type { HealthReport } from "@/bindings/ysm-model-manager/go/repoaudit/models.ts";
export type { FileConflict } from "@/bindings/ysm-model-manager/go/sync/models.ts";
// 诊断页日志契约（2026-09 对接锐评①）：此前 diagnostics/logs.ts 手写 ImportLogLike /
// RuntimeLogLike 镜像 Go 结构体，字段漂移（新增 Code/Suggestion 无从感知）无人校验。
// 改由绑定生成类型直连，手写镜像删除。LogLevel/ErrorCode 一并 type-only 导出：
// string enum 的成员值即 Go 常量字面量（"error"/"IO_ERROR"），运行时比较用 String() 归一。
export type {
  AppConfig,
  ErrorCode,
  ImportLog,
  LogLevel,
  RuntimeLog,
  VersionInstance,
  WorkshopCreator,
  WorkshopPresetSearch,
  WorkshopSite,
} from "@/bindings/ysm-model-manager/go/types/models.ts";
