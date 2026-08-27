// ===== bindings 类型 re-export 垫层（深路径收口）=====
// 背景：site 侧 4 个文件（drag/edit/render/types）原直接 import
// "../../../../bindings/ysm-model-manager/go/types/models.ts"（4 层深路径），
// 且 bindings 是 wails3 生成物（路径由生成配置固定，不随架构大改移动）。
// 本垫层把 bindings 路径收口为单一事实来源：生成路径变化只需改此处，
// 消费方一律 `import type { ... } from "../../../utils/types-re-export.ts"`。
export type {
  WorkshopSite,
  WorkshopPresetSearch,
  AppConfig,
  VersionInstance,
  ModelEntry,
} from "../../bindings/ysm-model-manager/go/types/models.ts";
