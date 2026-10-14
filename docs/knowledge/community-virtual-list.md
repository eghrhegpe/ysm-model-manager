---
kind: community-virtual-list
name: 社区虚拟滚动 community-virtual-list
tier: leaf
category: feature
source_files:
  - frontend/src/features/community/virtual-list.ts
  - frontend/src/utils/dom/virtual-scroll.ts
auto_fields:
  symbols_with_lines:
    - calcVisibleRange
    - createVirtualList
    - installScrollSync
    - VirtualList
    - VirtualListOpts
quick_groups:
  - 下载与社区
quick_intents:
  - 定高虚拟列表
  - 2000 级索引窗口化
  - paddingTop/Bottom 占位
  - 零高度降级全量渲染
pitfalls:
  - 前提：定高行；不等高布局（如创作者卡片网格）不适用
  - 零高度（jsdom / 首帧 clientHeight=0）→ 自动降级全量渲染
  - 全量渲染阈值：低于 `FULL_RENDER_THRESHOLD` 不值得虚拟化
  - listEl 上方有 header/队列状态等区块时，listTopOffset 自动补偿
  - destroy 必调：移除滚动监听 + 清空容器，防内存泄漏
use_when:
  - 社区模型列表
  - 虚拟滚动
  - 定高列表窗口化
  - 大索引列表性能优化
perf:
  - cpu-bound
  - io-bound
status: active
---

# 社区虚拟滚动 community-virtual-list

## 概览

定高虚拟列表（工坊模型列表窗口化）。社区上线后仓库模型索引可能顶到 2000 级，全量渲染 DOM 会爆炸。策略：占位式——列表容器 `paddingTop`/`paddingBottom` 撑出总高，DOM 常驻仅可见切片 ± 缓冲行。兼容零高度（jsdom / 首帧 `clientHeight=0`）→ 自动降级全量渲染。前提：定高行；不等高布局不适用。

## 核心职责

- **`createVirtualList<T>(opts: VirtualListOpts<T>): VirtualList<T>`** — 工厂：接收滚动容器 / 列表容器 / 定高 / 行构建器 / 空列表构建器；返回 `{ refresh, destroy }` 句柄。
- **`renderSlice()`** — 核心渲染：经 `calcVisibleRange` 计算可见范围 → 仅渲染可见切片 → `paddingTop`/`paddingBottom` 占位撑出总高。
- **`refresh(items: T[])`** — 数据更新入口：零高度或数据量 ≤ `FULL_RENDER_THRESHOLD` → 全量渲染；否则切虚拟化（装滚动监听 + renderSlice）。
- **`destroy()`** — 卸载：移除滚动监听 + 清空容器。
- **性能关键**：社区 2000 级索引列表唯一性能保障；每次数据更新 / 滚动事件触发 renderSlice。

## 对外 API / 入口

- `createVirtualList<T>(opts: VirtualListOpts<T>): VirtualList<T>` — 创建虚拟列表
- `VirtualList<T>` — `{ refresh(items: T[]): void; destroy(): void }`
- `VirtualListOpts<T>` — `{ scrollEl, listEl, rowH, renderItem, renderEmpty? }`

## 与其他子系统关系

- **`features/community/events.ts`** — 消费方：`createVirtualList<WorkshopModel>(...)` 渲染工坊模型列表。
- **`utils/dom/virtual-scroll.ts`** — 底层工具：`calcVisibleRange`（计算可见范围）+ `installScrollSync`（装滚动监听 + 回调）。

## 不变量

- **定高前提**：`rowH` 固定（含 padding / margin）；不等高布局不适用。
- **零高度降级 + rAF 重试**（锐评修复，2026-10-14）：`scrollEl.clientHeight === 0`（jsdom / 首帧 / 面板在隐藏态创建）→ 全量渲染跳过虚拟化，**并排一次 `requestAnimationFrame` 重试**——下一帧布局就绪即自动切回虚拟化。⚠️ **历史缺陷**：原实现只降级不重试，零高度时全量渲染**且不装滚动同步**，此后该视图虚拟化**永久失效**（直到下一次 `refresh` 才可能恢复）——2000 级列表整体进 DOM，抹掉本模块存在的意义。**与 `views/app-tree/render.ts` 对齐**：那一侧早有 `if (container.clientHeight === 0) requestAnimationFrame(redraw)`，同一「定高虚拟列表」前提下的两个消费方不该一边有一边无。重试有 `retryPending` 在途守卫（至多一次，jsdom 恒 0 高度下不空转），`destroy()` 必 `cancelPendingRetry()`（防销毁后 rAF 迟到回调重填 DOM = 幽灵渲染）。回归锁：`virtual-list.test.ts`「零高度 → 下一帧高度就绪后自动切回虚拟化」+「destroy 取消在途 rAF 重试」，均变异验证；测试夹具 `clientHeight` 须 `configurable: true` 才能改写（模拟首帧 0 → 次帧 560 的真实时序）
- **小数据集阈值**：`FULL_RENDER_THRESHOLD`（定值）；低于此值不值得虚拟化，直接全量渲染。
- **占位式窗口化**：`paddingTop = startIdx * rowH`，`paddingBottom = (total - endIdx) * rowH`；DOM 常驻仅可见切片。
- **listTopOffset 补偿**：列表上方有 header / 队列状态等区块时自动补偿偏移（`getBoundingClientRect` 差值 + scrollTop）。
- **destroy 必调**：组件销毁时调 `destroy()` 移除滚动监听 + 清空容器，防内存泄漏。

## 相关

- `docs/knowledge/download-queue-store.md`（下载队列 UI 状态）
- `docs/knowledge/download-tasks.md`（任务构建层）
