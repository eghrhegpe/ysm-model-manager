---
kind: utils_display
name: 文件名显示 display
tier: leaf
category: utils
source_files:
  - frontend/js/utils/dom/display.ts
use_when:
  - 文件名
  - 文件名显示
  - 美化文件名
  - renderDisplayName
  - 作者标签
  - 作品标签
  - 文件名着色
  - 搜索高亮
  - ban 文件
---

# 文件名显示 display

## 概览

模型文件名解析 + 美化显示管线。YSM 社区文件名遵循 `[作者]【作品】角色 日期.ext` 命名约定，本模块把它解析为结构化字段，并在原文件名上原位着色（作者/作品/日期各自样式），是 UI 侧文件名展示的唯一入口。

## 核心职责

- 解析文件名为结构化字段（作者/作品/角色/日期/扩展名/是否封禁）
- 渲染美化显示的 HTML（保留原文件名顺序，不重排）
- 搜索关键词高亮包装

## 对外 API / 入口

- `parseModelName(raw: string): ParsedModelName` — 解析文件名为 `{ raw, isBanned, author, work, chara, character, date, ext }`；支持 `[作者]`/`[[作者]]`、`【作品】`/`《作品》`、`YYYY[-_.]MM` 日期；`.ban` 后缀标记封禁文件
- `renderDisplayName(raw: string, opts?: unknown): string` — **治理红线函数**，所有 UI 文件名展示必经：`[...]`/【...】/《...》→ `.tag-work` span，日期 → `.tag-date` span，其余部分走 `renderFormattedText` 做 § 分节符着色；封禁文件直接返回转义后的原文
- `renderModelName(raw, options?: { tpl?, showExt? })` — renderDisplayName 的别名包装，`showExt: true` 追加 `.tag-ext` 扩展名后缀
- `renderModelNameWithHighlight(raw, keyword?, options?)` — 在 renderDisplayName 结果上用 `<mark>` 全局包裹搜索命中段

## 与其他子系统关系

- 消费方（文件名展示点全覆盖）：`app-tree`（row-tpl / row-tpl-list / render）、`features/import-queue`、`features/recycle-bin`、`features/oldest-models`、`features/community`（render / download-queue / diagnostics）
- 依赖 `utils/mc-format.ts` 的 `renderFormattedText` 做 § 分节符着色
- `.tag-work` / `.tag-date` / `.tag-author` / `.tag-ext` 的样式在各组件 CSS 中定义，颜色走 CSS 变量（--meta-author / --meta-work / --meta-date）

## 不变量

- 治理红线：**所有 UI 文件名展示必须走 renderDisplayName**（AGENTS.md §3.3），禁止把原始文件名直接拼进 innerHTML
- 返回的 HTML 已在内部逐段转义（模块自带 esc），调用方不得再注入未转义内容
- 着色是「原位着色」：保留原文件名的字符顺序，绝不重排字段
- 封禁文件（.ban）不着色，只显示转义原文

## 相关

- [utils_dom](./utils_dom.md) — esc() HTML 转义红线
- [utils_mc_format](./utils_mc_format.md) — § 分节符着色
- `frontend/js/utils/dom/display.test.js` — 单元测试（验证入口）
- AGENTS.md §3.3 UI 安全红线
