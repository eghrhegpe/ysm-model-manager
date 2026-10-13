---
kind: utils-display
name: 文件名展示与着色链 display
tier: leaf
category: utils
source_files:
  - frontend/src/utils/model-name/display.ts
  - frontend/src/utils/icon/icon.ts
  - frontend/src/utils/html/mc-format.ts
  - frontend/src/utils/format/pack-format.ts
auto_fields:
  symbols_with_lines:
    - describeVersionRange
    - fileIcon
    - LATEST_VERSION_SENTINEL
    - PackMeta
    - ParsedModelName
    - parseModelName
    - renderDisplayName
    - renderFormattedText
    - stripDisableSuffix
quick_groups:
  - 跨组件通信与页面
quick_intents:
  - 文件名显示、美化文件名、renderDisplayName
  - MC 格式、§ 颜色、MC 颜色码
  - pack_format、MC 版本、资源包版本
  - 图标、emoji、文件图标、fileIcon
quick_risk_lines:
  - 文件名展示必须走 display.ts 的 renderDisplayName，禁止手写文件名解析
  - MC 文本格式化必须走 mc-format.ts 的 renderFormattedText，禁止手写 § 颜色解析
  - 文件图标必须走 icon.ts 的 fileIcon，禁止手写文件名→图标映射
pitfalls:
  - 手写文件名解析 → 与 parseModelName 判定不一致、作者 / 作品提取错位；必须经 renderDisplayName
  - 手写 § 颜色解析 → 与 renderFormattedText 不一致、特殊字符未处理；必须经 renderFormattedText
  - pack_format 未走 describeVersionRange → 版本显示不友好；必须经 describeVersionRange
  - 手写文件名→图标映射 → 与 fileIcon 不一致、新类型缺图标；必须经 fileIcon

use_when:
  - 文件名显示、作者标签、作品标签、文件名着色
  - 搜索高亮、mark
  - § 颜色、MC 颜色码、renderFormattedText
  - pack_format、MC 版本、describeVersionRange
  - 文件图标、fileIcon
invariant_anchors:
  - frontend/src/utils/model-name/display.ts|renderDisplayName
  - frontend/src/utils/html/mc-format.ts|renderFormattedText
  - frontend/src/utils/format/pack-format.ts|describeVersionRange
  - frontend/src/utils/icon/icon.ts|fileIcon
status: active
---

# 文件名展示与着色链 display

## 概览

模型文件名「解析 → 着色 → 图标」展示链的三个纯工具模块（原 utils-display / utils-mc-format / utils-icon 三卡合并，2026-10-13 文档减负试点，见 ADR-338）。三者是一条渲染流水线：`parseModelName` 解析 YSM 社区命名约定 `[作者]【作品】角色 日期.ext` 为结构化字段 → `renderDisplayName` 原位着色（内部经 `renderFormattedText` 做 § 分节符渲染）→ `fileIcon` 按扩展名给文件类型图标。

## 核心职责

- **解析**：文件名 → `{ raw, isBanned, author, work, chara, date, ext }` 结构化字段（`[作者]`/`[[作者]]`、`【作品】`/`《作品》` 三组括号经 `BRACKET_STYLES` 注册表统一，parse 与 render 共用 `bracketRe`）
- **着色**：保留原文件名字符顺序的原位着色（作者/作品/日期各自 `.tag-*` 样式）；封禁文件（.ban）不着色只显转义原文
- **§ 渲染**：分节符文本 → 带颜色/格式的 HTML（颜色码 §0-§f、格式码 §l/§o/§n/§m、§r 重置、§k 忽略）
- **版本描述**：pack_format 数值 → MC 版本范围文本（资源包/光影包卡片的版本兼容展示）
- **图标**：文件名 → emoji 图标（树行/列表的类型图标）

## 对外 API / 入口

`model-name/display.ts`：
- `parseModelName(raw: string): ParsedModelName` — 结构化解析；`YYYY[-_.]MM` 日期；`.ban` 后缀标记封禁
- `renderDisplayName(raw: string, opts?: unknown): string` — **治理红线函数**，所有 UI 文件名展示必经：括号段 → `.tag-work` span，日期 → `.tag-date` span，其余走 `renderFormattedText` 做 § 着色；封禁文件直接返回转义原文
- `renderModelName` / `renderModelNameWithHighlight` — ⚠️ **均已失效（2026-10 实证）**：全仓不存在这些标识符；关键词高亮现行实现 = `utils/html/html.ts` 的 `hl`（转义 + `<mark>` 包裹全部命中段）

`html/mc-format.ts`：
- `renderFormattedText(text: string): string`（**仅具名导出，无 default**）— 逐行解析 § 码：颜色码重置此前格式并新开颜色 span；格式码叠加；§r 全重置；§k 忽略仅输出正文；无效码与行尾孤立 § 原样保留（P3 修复）；换行转 `<br>`；正文内部转义（& < >），输出可直接拼 innerHTML

`format/pack-format.ts`：
- `PackMeta` 接口 — `{ supported_formats?, min_format?, max_format?, pack_format? }`（对应 Go ReadPackMeta 返回 JSON）
- `describeVersionRange(meta: PackMeta): { format, version }` — 解析优先级：supported_formats[min,max] → min/max_format（int 或 [n,…]）→ 单体 pack_format；max ≥ 9999 显示「≥ min」；格式号 > 88 走 `MAX_KNOWN_FORMAT` 兜底「最新版本」（三分支口径一致，P3 修复）；全缺返回 `{ "?", "" }`；内部 FORMAT_VERSION_MAP（1→"1.6.1 ~ 1.8.9" … 88→"26.2"，**仅整数键**——旧文「含 '65.0' 类小数键」为漂移）为模块私有

`icon/icon.ts`：
- `fileIcon(name: string): string` — **注册表驱动**：`REGISTRY_EXT_ICONS` 由 `RESOURCE_EXTS`（资源类型扩展名注册表）遍历 + `typeIconOf(rt)` 派生，新增类型只需在资源类型注册表声明图标；兜底 `🧊`；禁用后缀（`.disabled`/`.ban`）剥离后取原扩展名判定（2026-08-24 注册表化，原硬编码表已删）

## 与其他子系统关系

- **消费方（文件名展示点全覆盖）**：`app-tree`（row-tpl / row-tpl-list / render）、`features/import-queue`、`features/recycle-bin`、`features/oldest-models`、`features/community`（render / download-queue / diagnostics）
- renderFormattedText 消费方：本卡 display.ts（文件名 § 着色）、`app-sync-manager/tpl.ts`、`app-preview/preview-detail.ts` + `preview-litematic-meta.ts`、`features/import-queue.ts`
- describeVersionRange 消费方：`app-preview/detail.ts`（资源包/光影包详情）
- fileIcon 消费方：`app-tree/render.ts`（行图标）、`app-content/diagnostics/dedup-render.ts`
- fileIcon 依赖 `utils/resource/types.ts` 的 `RESOURCE_TYPES` 常量（不硬编码字符串）；`RESOURCE_EXTS` 注册表见 [utils_resource_types](./utils-resource-types.md)
- PackMeta 上游为 Go 端包元数据读取 binding（见 [go_packs](./go-packs.md)）
- esc() 转义红线见 [utils_dom](./utils-dom.md)

## 不变量

- 治理红线：**所有 UI 文件名展示必须走 renderDisplayName**（AGENTS.md §3.3），禁止把原始文件名直接拼进 innerHTML。**例外已记录**（P3 观察）：app-tree 搜索态走 `hl()` 而非 renderDisplayName——搜索时丢失 tag-work/tag-date 着色、§ 着色与 `.ban` 原文语义（hl 会 esc，XSS 安全）
- 着色是「原位着色」：保留原文件名字符顺序，绝不重排字段；返回的 HTML 已内部逐段转义，调用方不得再注入未转义内容
- **日期命中与括号段区间重叠时剔除日期**（P3 修复：`【2023】角色.ysm` 中 date(2023) 与 work(【2023】) 重叠，原反向替换使内部 token 泄漏到 UI）
- renderFormattedText 输出已 HTML 转义，可直接嵌入 innerHTML（消费方无需二次转义）；MC_COLORS 是 Minecraft 标准色板常量（算法口径），属少数允许的内联颜色，其余 UI 颜色走 CSS 变量
- pack_format 映射表手工维护：MC 新版本发布时人工更新
- fileIcon：扩展名取 `name.split(".").pop()` 小写不带前导点；YSM/litematic 判断必须经 `RESOURCE_TYPES` 常量禁止硬编码（注册表优先，AGENTS.md §4.4）

## 相关

- [utils_dom](./utils-dom.md) — esc() HTML 转义红线
- [utils_resource_types](./utils-resource-types.md) — 资源类型常量与扩展名注册表
- [go_packs](./go-packs.md) — PackMeta 数据源
- 测试入口：`frontend/src/utils/model-name/display.test.ts`、`frontend/src/utils/html/mc-format.test.ts`、`frontend/src/utils/icon/icon.test.ts`、`frontend/src/utils/format/pack-format.test.ts`
