---
kind: utils_mc_format
name: MC 格式判定 mc-format
tier: leaf
category: utils
source_files:
  - frontend/src/utils/format/mc-format.ts
  - frontend/src/utils/format/pack-format.ts
use_when:
  - 分节符
  - § 颜色
  - MC 颜色码
  - pack_format
  - MC 版本
  - 资源包版本
  - renderFormattedText
  - 版本兼容
---

# MC 格式判定 mc-format

## 概览

两个 Minecraft 相关的纯工具：`mc-format.ts` 把 § 分节符颜色/格式码渲染为 HTML；`pack-format.ts` 把 pack_format 数值映射为可读的 MC 版本描述。

## 核心职责

- § 分节符文本 → 带颜色/格式的 HTML（颜色码 §0-§f、格式码 §l/§o/§n/§m、§r 重置、§k 忽略）
- pack_format 数值 → MC 版本范围文本（资源包/光影包卡片的版本兼容展示）

## 对外 API / 入口

`mc-format.ts`：
- `renderFormattedText(text: string): string`（同时有 default 导出）— 逐行解析 § 码：颜色码重置此前所有格式并新开颜色 span；格式码叠加（b/i/下划线/删除线）；§r 重置全部；无效码与孤立 § 原样保留；换行转 `<br>`；正文内部转义（& < >），输出可直接拼 innerHTML

`pack-format.ts`：
- `PackMeta` 接口 — `{ supported_formats?, min_format?, max_format?, pack_format? }`（对应 Go ReadPackMeta 返回的 JSON）
- `describeVersionRange(meta: PackMeta): { format, version }` — 解析优先级：supported_formats[min,max] → min_format/max_format（int 或 [n,…] 数组）→ 单体 pack_format；max ≥ 9999 显示「≥ min」；格式号 > 88 兜底「最新版本」；全缺返回 `{ "?", "" }`；内部版本映射表 FORMAT_VERSION_MAP（1→"1.6.1 ~ 1.8.9" … 88→"26.2"，含 "65.0" 类小数键）为模块私有

## 与其他子系统关系

- renderFormattedText 消费方：`utils/display.ts`（文件名着色）、`utils/summarize.ts`（tips）、`app-resource-manager/tpl.ts`、`app-sync-manager/tpl.ts`、`app-preview/preview-detail.ts` + `preview-litematic-meta.ts`、`features/import-queue.ts`
- describeVersionRange 消费方：`app-resource-manager/tpl.ts`（资源包卡片）
- PackMeta 上游为 Go 端包元数据读取 binding（见 [go_packs](./go-packs.md)）

## 不变量

- renderFormattedText 输出已 HTML 转义，可直接嵌入 innerHTML（消费方无需二次转义）
- MC_COLORS 是 Minecraft 标准色板常量（算法口径），属少数允许的内联颜色；其余 UI 颜色一律走 CSS 变量
- pack_format 映射表手工维护：MC 新版本发布需同时补整数键与小数键（如 "70.1"）

## 相关

- [utils_display](./utils-display.md) — 文件名 § 着色消费方
- [go_packs](./go-packs.md) — 包元数据数据源
- `frontend/src/utils/format/mc-format.test.js` — 单元测试（验证入口）
