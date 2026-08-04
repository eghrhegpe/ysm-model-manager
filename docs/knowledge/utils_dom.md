---
kind: utils_dom
name: DOM 工具 dom
tier: leaf
category: utils
source_files:
  - frontend/js/utils/dom/html.ts
use_when:
  - esc
  - HTML 转义
  - innerHTML
  - 搜索高亮
  - mark
  - XSS
---

# DOM 工具 dom

## 概览

HTML 转义与搜索高亮工具。`esc()` 是全前端 HTML 转义的统一入口，也是治理红线指定的转义函数。

## 核心职责

- HTML 特殊字符转义（innerHTML 拼接防注入）
- 搜索关键词高亮（转义后返回 `<mark>` 包裹的安全 HTML）

## 对外 API / 入口

- `esc(s: string): string` — **治理红线函数**：转义 `&` `<` `>` `"` `'` 五种字符为 HTML 实体；null/undefined 按空串处理不抛错
- `hl(text: string, query?: string): string` — 先整体转义，再大小写不敏感查找 query 的**首个**命中并用 `<mark>` 包裹；无 query 或未命中时返回纯转义文本

## 与其他子系统关系

- 全项目消费最广的工具函数之一：`app-preview`（index / tpl / preview-detail / preview-skeleton / preview-litematic-3d / preview-litematic-meta）、`app-content/index.ts`、`app-tree/render.ts`（hl 高亮）、`dialogs/tag-editor.ts` 等
- `utils/display.ts` / `utils/mc-format.ts` / `utils/summarize.ts` 内部各有同行为的局部 esc 副本；新代码统一 import 本模块

## 不变量

- 治理红线：**所有 innerHTML 拼接中用户可控的数据必须经 esc() 转义**（AGENTS.md §3.3）
- `&` 必须最先替换，避免二次转义后续生成的实体
- hl 只高亮首个命中（全量高亮请用 display.ts 的 renderModelNameWithHighlight）

## 相关

- [utils_display](./utils_display.md) — 文件名显示（同源红线）
- `frontend/js/utils/dom/html.test.ts` — 单元测试（验证入口）
- AGENTS.md §3.3 UI 安全红线
