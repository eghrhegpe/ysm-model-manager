---
kind: test-utils
name: 测试工具 test-utils（G-1 抗脆弱测试基础设施）
tier: architecture
category: ui
source_files:
  - frontend/src/test-utils/index.ts
  - frontend/src/test-utils/events.ts
  - frontend/src/test-utils/query-by-testid.ts
  - frontend/src/test-utils/render.ts
tests:
  - frontend/src/views/app-nav/index.test.ts
  - frontend/src/views/app-resource-manager/index.test.ts
  - frontend/src/views/app-sync-manager/index.test.ts
  - frontend/src/views/app-toast/index.test.ts
  - frontend/src/views/app-tree/render.test.ts
  - frontend/src/views/context-menu/index.test.ts
use_when:
  - 测试工具
  - testid
  - getByTestId
  - waitFor
  - 组件测试
  - mock
  - G-1
---

# 测试工具 test-utils（G-1 抗脆弱测试基础设施）

## 概览

`frontend/src/test-utils/` 是组件测试统一工具层（ADR-035 G-1 / Design.md §19.1）。查询走 `data-testid` 稳定钩子（不绑定 CSS 类/文案），等待走轮询（替代固定 sleep）。UI 结构变化只改本层一处，测试不直接写选择器/定时器。

## 对外 API / 入口

- `getByTestId(root, testid)` — 按 `data-testid` **精确**查询（root 可为 document / ShadowRoot / 元素）
- `getAllByTestId(root, prefix)` — 按 testid **前缀**查询全部（P2 修复：前缀限定「精确 testid 或 `X-<纯数字序号>`」——CSS `^=` 无法表达「- 后跟数字」，查询后 JS 过滤后缀段为纯数字的编号实例；`tree-dir` 查询不会命中 `tree-dir-toggle`（后缀非数字），`tree-file-1/2` 编号实例可取全；原实现精确匹配导致带序号 testid 返回 0 抛错）
- `waitFor(fn, timeout?)` — 轮询等待条件成立（默认 5s 超时抛错，替代固定 sleep；**超时/异常 reject 携带原始错误**——P2 修复：原 catch 静默吞错，真实根因被通用消息掩盖；知识卡旧文「timeout?, interval?」的 interval 参数不存在，已修正签名）
- `sleep(ms)` / `mountCustomElement(tag)` / `unmountElement(el)` — 组件编排测试公共辅助
- `events.ts` / `query-by-testid.ts` / `render.ts` — 事件派发 / testid 查询 / 组件渲染辅助（拆分自 index.ts）

## 与其他子系统关系

- `tests/test_testid_contract.mjs`：关键 testid 契约守护（被删即契约红）
- 各组件 `*.test.ts`：统一走本层 helper（app-nav/resource-manager/sync-manager/toast/tree/context-menu）
- Design.md §19.1：testid 命名规范（`<域>-<角色>` kebab-case 前缀命名空间）

## 不变量

- 查询只认 `data-testid`，不绑定 CSS 类 / 文案 / DOM 结构（抗脆弱核心）
- 等待用轮询不用固定 sleep（防竞态误报）
- testid 值禁止含空格或大小写混排（Design.md §19.1；本层未做入口校验，P3 观察）

## 相关

- ADR-035（G-1 抗脆弱测试基础设施）、Design.md §19.1（testid 规范）、ADR-037（E2E 引入，共享 testid 钩子）
