---
kind: utils-mc-format
name: MC 格式判定 mc-format
tier: leaf
category: utils
source_files:
  - frontend/src/utils/format/mc-format.ts
  - frontend/src/utils/format/pack-format.ts
auto_fields:
  symbols_with_lines:
    - describeVersionRange
    - PackMeta
    - renderFormattedText
  quick_groups:
    - 跨组件通信与页面
  quick_intents:
    - MC 格式、§ 颜色、MC 颜色码
    - pack_format、MC 版本、资源包版本
    - renderFormattedText / describeVersionRange
  quick_risk_lines:
    - MC 文本格式化必须走 mc-format.ts 的 renderFormattedText，禁止手写 § 颜色解析
  pitfalls:
    - 手写 § 颜色解析 → 与 renderFormattedText 不一致、特殊字符未处理；必须经 renderFormattedText
    - pack_format 未走 describeVersionRange → 版本显示不友好；必须经 describeVersionRange
  use_when:
    - 分节符
    - § 颜色
    - MC 颜色码
    - pack_format
    - MC 版本
    - 资源包版本
    - renderFormattedText
    - 版本兼容
  invariant_anchors:
    - frontend/src/utils/format/mc-format.ts|renderFormattedText
    - frontend/src/utils/format/pack-format.ts|describeVersionRange
quick_groups:
  - 跨组件通信与页面
quick_intents:
  - MC 格式、§ 颜色、MC 颜色码
  - pack_format、MC 版本、资源包版本
  - renderFormattedText / describeVersionRange
quick_risk_lines:
  - MC 文本格式化必须走 mc-format.ts 的 renderFormattedText，禁止手写 § 颜色解析
pitfalls:
  - 手写 § 颜色解析 → 与 renderFormattedText 不一致、特殊字符未处理；必须经 renderFormattedText
  - pack_format 未走 describeVersionRange → 版本显示不友好；必须经 describeVersionRange

use_when:
  - 分节符
  - § 颜色
  - MC 颜色码
  - pack_format
  - MC 版本
  - 资源包版本
  - renderFormattedText
  - 版本兼容
invariant_anchors:
  - frontend/src/utils/format/mc-format.ts|renderFormattedText
  - frontend/src/utils/format/pack-format.ts|describeVersionRange
status: active
---

# MC 格式判定 mc-format

## 概览

两个 Minecraft 相关的纯工具：`mc-format.ts` 把 § 分节符颜色/格式码渲染为 HTML；`pack-format.ts` 把 pack_format 数值映射为可读的 MC 版本描述。

## 核心职责

- § 分节符文本 → 带颜色/格式的 HTML（颜色码 §0-§f、格式码 §l/§o/§n/§m、§r 重置、§k 忽略）
- pack_format 数值 → MC 版本范围文本（资源包/光影包卡片的版本兼容展示）

## 对外 API / 入口

`mc-format.ts`：
- `renderFormattedText(text: string): string`（**仅具名导出，无 default 导出**）— 逐行解析 § 码：颜色码重置此前所有格式并新开颜色 span；格式码叠加（b/i/下划线/删除线）；§r 重置全部；§k 忽略仅输出正文；无效码原样保留、**行尾孤立 § 原样保留**（P3 修复：原实现 `if (!part) continue` 丢弃，与「无效码与孤立 § 原样保留」契约不符；连续 `§§code` 中间的空 part 仍跳过——走第二条码，测试锁定）；换行转 `<br>`；正文内部转义（& < >），输出可直接拼 innerHTML

`pack-format.ts`：
- `PackMeta` 接口 — `{ supported_formats?, min_format?, max_format?, pack_format? }`（对应 Go ReadPackMeta 返回的 JSON）
- `describeVersionRange(meta: PackMeta): { format, version }` — 解析优先级：supported_formats[min,max] → min_format/max_format（int 或 [n,…] 数组）→ 单体 pack_format；max ≥ 9999 显示「≥ min」；格式号 > 88 走 `MAX_KNOWN_FORMAT` 常量兜底「最新版本」（**三分支口径一致，P3 修复：单体 pack_format 分支原 FORMAT_VERSION_MAP 直接索引对 >88 返回空串，现改用 fmtVer 统一**）；全缺返回 `{ "?", "" }`；内部版本映射表 FORMAT_VERSION_MAP（1→"1.6.1 ~ 1.8.9" … 88→"26.2"，**仅整数键**——知识卡旧文「含 '65.0' 类小数键」为漂移，archive 文档已自证「JS 端仅用整数 key」）为模块私有

## 与其他子系统关系

- renderFormattedText 消费方：`utils/display.ts`（文件名着色）、`utils/summarize.ts`（tips）、`app-sync-manager/tpl.ts`、`app-preview/preview-detail.ts` + `preview-litematic-meta.ts`、`features/import-queue.ts`（`app-resource-manager` 已删除，2026-08-24）
- describeVersionRange 消费方：`app-preview/detail.ts`（资源包/光影包详情，原 app-resource-manager 资源包卡片已随组件删除）
- PackMeta 上游为 Go 端包元数据读取 binding（见 [go_packs](./go-packs.md)）

## 不变量

- renderFormattedText 输出已 HTML 转义，可直接嵌入 innerHTML（消费方无需二次转义）
- MC_COLORS 是 Minecraft 标准色板常量（算法口径），属少数允许的内联颜色；其余 UI 颜色一律走 CSS 变量
- pack_format 映射表手工维护：MC 新版本发布

## 相关

- [utils_display](./utils-display.md) — 文件名 § 着色消费方
- [go_packs](./go-packs.md) — 包元数据数据源
- `frontend/src/utils/format/mc-format.test.ts` — 单元测试（验证入口）
