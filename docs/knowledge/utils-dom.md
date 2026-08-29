---
kind: utils-dom
name: DOM 工具 dom
tier: leaf
category: utils
source_files:
  - frontend/src/utils/dom/
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

HTML 转义、搜索高亮、全局 toast 时长语义常量、焦点记忆 / 恢复（a11y）。`esc()` 是全前端 HTML 转义的统一入口，也是治理红线指定的转义函数；`toast-ms.ts` 是全应用 toast 时长的单一事实源（8 档语义常量，新增 `persist=10000` / `sticky=60000` 长期通知档；消费方禁止内联魔法数字；`scripts/check-toast-duration.mjs` 门禁守护 R7 红线）；`focus-restore.ts` 提供模态/浮层/全屏预览的「记触发元素 + 还焦点 + 跨 Shadow DOM Tab 循环」三件套，避免各组件重复实现焦点管理。

## 核心职责

- HTML 特殊字符转义（innerHTML 拼接防注入）
- 搜索关键词高亮（转义后返回 `<mark>` 包裹的安全 HTML）
- toast 时长语义化：`TOAST_MS` 8 档常量（quick=1500 / success=2000 / info=2500 / normal=3000 / verbose=4000 / long=5000 / persist=10000 / sticky=60000），全仓 toast 裸 `duration` 已收敛至该单一事实源（commit `b1508ac5`）；契约测试 `toast-ms.test.ts` 断言语档值与单调性；门禁 `scripts/check-toast-duration.mjs` 扫描非测试 src 捕捉裸时长（非阻断 [WARN] 观察期），防回流

## 对外 API / 入口

- `esc(s: string): string` — **治理红线函数**：转义 `&` `<` `>` `"` `'` 五种字符为 HTML 实体（`&` 最先替换防二次转义）；null/undefined 按空串处理不抛错
- `hl(text: string, query?: string): string` — 先在**原始 text** 上大小写不敏感定位 query 的**首个**命中，再按原始索引切 before/match/after 三段、各自 `esc()` 后拼 `<mark>`（非「先整体转义再查找」——该路径会因 `&lt;` 错位，html.ts esc 注释显式否决）；无 query 或未命中时返回纯转义文本
- **焦点记忆 / 恢复 + 跨 Shadow DOM 焦点陷阱**（`utils/dom/focus-restore.ts`，2026-08-29）：
  - `rememberTrigger()` 记下当前 `document.activeElement`（同步，开模态/浮层前调）
  - `returnFocus()` 关闭时把焦点还给记住的元素；元素已离文档/不可聚焦时静默跳过（不抛错）；`clearTrigger()` 显式清除
  - `trapFocusAcrossShadow(overlay): () => void` 跨 Shadow DOM 边界找可聚焦元素 + 拦截 Tab 越界（document 级单例监听）。与 `dialog-modal.ts trapFocus` 互补：弹窗用轻量 overlay 级；3D 全屏/带 Shadow 子树的浮层用跨 Shadow 版本
  - **2026-08-29 修复**：① `hasAriaHiddenAncestor` 固定 `el.getRootNode()` 会在 shadow 内元素上死循环（parentElement=null 后反复跳回同一 host，探针实证 200ms 320 万步）——改 `node.getRootNode()` 跟随当前节点逐层跳出；② trap 收拢从 `!inside`（只防 overlay 外）改为 `tabbable.includes(active)`（overlay 背景点击后 Tab 也能拉回，防逃逸）
  - **使用约束**：单例 trap，多个浮层叠加时只一个生效；duck-typing 容错 node 测试环境（无 `HTMLElement` 全局）

## 与其他子系统关系

- 全项目消费最广的工具函数之一：`app-preview`（index / tpl / preview-detail / preview-skeleton / preview-litematic-3d / preview-litematic-meta）、`app-content/index.ts`、`app-tree/render.ts`（hl 高亮）、`dialogs/tag-editor.ts` 等
- `utils/display.ts` / `utils/mc-format.ts` / `utils/summarize.ts` **均已 import 本模块的 `esc`**（无局部副本——早期声明「各有同行为局部副本」已过时）

## 不变量

- 治理红线：**所有 innerHTML 拼接中用户可控的数据必须经 esc() 转义**（AGENTS.md §3.3 的 UI 安全红线——注：当前 AGENTS.md §3.3 为「注册表优先」，innerHTML 转义红线实际位于 `docs/governance-rules.md` R8，知识卡引用已修正）
- `&` 必须最先替换，避免二次转义后续生成的实体
- hl 只高亮首个命中（全量高亮请用 display.ts 的 renderModelNameWithHighlight）
- **hl 在原始 text 上定位**（非先整体转义——`&lt;` 错位陷阱有判别性测试锁定：`hl("&lt;","lt")` → `&amp;<mark>lt</mark>;`，P3 补测）；**Unicode 大小写折叠长度变化（如土耳其 İ）时降级纯转义**（P3 修复：折叠后 idx 用于切片原始 text 会静默错切空 mark）
- toast 时长：消费方一律引用 `TOAST_MS` 语义档，禁止内联魔法数字或另起同名命名（防止语义漂移）；`scripts/check-toast-duration.mjs` 门禁守护（R7 红线，非阻断观察期，待 rollout 稳定翻硬闸）

## 相关

- [utils_display](./utils-display.md) — 文件名显示（同源红线）
- `frontend/src/utils/dom/html.test.ts` — 单元测试（验证入口）
- `frontend/src/utils/dom/virtual-scroll.test.ts` — 虚拟滚动原语测试
- `frontend/src/features/community/virtual-list.test.ts` — 定高虚拟列表组件测试
- AGENTS.md §3.3 UI 安全红线
