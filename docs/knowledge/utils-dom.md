---
kind: utils-dom
name: DOM 工具 dom
tier: leaf
category: utils
source_files:
  - frontend/src/utils/dom/html.ts
use_when:
  - esc
  - HTML 转义
  - innerHTML
  - 搜索高亮
  - mark
  - XSS
invariant_anchors:
  - frontend/src/utils/dom/html.ts|export function esc
---

# DOM 工具 dom

## 概览

HTML 转义与搜索高亮工具。`esc()` 是全前端 HTML 转义的统一入口，也是治理红线指定的转义函数。

## 核心职责

- HTML 特殊字符转义（innerHTML 拼接防注入）
- 搜索关键词高亮（转义后返回 `<mark>` 包裹的安全 HTML）

## 对外 API / 入口

- `esc(s: string): string` — **治理红线函数**：转义 `&` `<` `>` `"` `'` 五种字符为 HTML 实体（`&` 最先替换防二次转义）；null/undefined 按空串处理不抛错
- `hl(text: string, query?: string): string` — 先在**原始 text** 上大小写不敏感定位 query 的**首个**命中，再按原始索引切 before/match/after 三段、各自 `esc()` 后拼 `<mark>`（非「先整体转义再查找」——该路径会因 `&lt;` 错位，html.ts:21-22 注释显式否决）；无 query 或未命中时返回纯转义文本

## 与其他子系统关系

- 全项目消费最广的工具函数之一：`app-preview`（index / tpl / preview-detail / preview-skeleton / preview-litematic-3d / preview-litematic-meta）、`app-content/index.ts`、`app-tree/render.ts`（hl 高亮）、`dialogs/tag-editor.ts` 等
- `utils/display.ts` / `utils/mc-format.ts` / `utils/summarize.ts` **均已 import 本模块的 `esc`**（无局部副本——早期声明「各有同行为局部副本」已过时）

## 不变量

- 治理红线：**所有 innerHTML 拼接中用户可控的数据必须经 esc() 转义**（AGENTS.md §3.3 的 UI 安全红线——注：当前 AGENTS.md §3.3 为「注册表优先」，innerHTML 转义红线实际位于 `docs/governance-rules.md` R8，知识卡引用已修正）
- `&` 必须最先替换，避免二次转义后续生成的实体
- hl 只高亮首个命中（全量高亮请用 display.ts 的 renderModelNameWithHighlight）
- **hl 在原始 text 上定位**（非先整体转义——`&lt;` 错位陷阱有判别性测试锁定：`hl("&lt;","lt")` → `&amp;<mark>lt</mark>;`，P3 补测）；**Unicode 大小写折叠长度变化（如土耳其 İ）时降级纯转义**（P3 修复：折叠后 idx 用于切片原始 text 会静默错切空 mark）

## 相关

- [utils_display](./utils-display.md) — 文件名显示（同源红线）
- `frontend/src/utils/dom/html.test.ts` — 单元测试（验证入口）
- AGENTS.md §3.3 UI 安全红线
