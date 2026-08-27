---
kind: test-utils
name: 测试工具 test-utils（G-1 抗脆弱测试基础设施）
tier: architecture
category: ui
source_files:
  - frontend/src/test-utils/
tests:
  - frontend/src/views/app-nav/index.test.ts
  - frontend/src/views/app-sync-manager/index.test.ts
  - frontend/src/views/app-toast/index.test.ts
  - frontend/src/views/app-tree/render.test.ts
  - frontend/src/views/app-content/app-content.methods.test.ts
  - frontend/src/views/app-sidebar/app-sidebar.component.test.ts
  - frontend/src/views/context-menu/index.test.ts
use_when:
  - 测试工具
  - testid
  - getByTestId
  - waitFor
  - sleep
  - flaky
  - 异步等待
  - 组件测试
  - mock
  - G-1
invariant_anchors:
  - frontend/src/test-utils/events.ts|fireEvent
  - frontend/src/test-utils/events.ts|fireClick
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
- E2E（ADR-037）：`frontend/e2e/` 14 spec / 51 用例共享本层 testid 钩子与 mock 契约（覆盖现状见 ADR-037 §2.5）

## 异步等待三分法（审计替换 sleep 的决策树，b2a0d079）

固定 sleep 是墙钟等待：慢机（CI/低配）上「不够 50ms 完成渲染」即假红。审计发现全仓
98 处 sleep / 192 处 waitFor，热点集中在少数文件（P1 案例：单文件 37 处）。替换按
**等待性质**三分类：

| 等待性质 | 判据 | 解法 | 样板 |
|----------|------|------|------|
| 正等结果 | 断言某事**终将发生**（mock 被调到 / DOM 内容出现） | `waitFor(条件)` 轮询到目标状态即返回 | `app-sync-manager/index.test.ts` |
| 等 init 落定 | 挂载后等初始化链结束，但**无业务可观察条件**（mock 全部微任务级 resolve） | 排空调度轮次：`setTimeout(0)`+rAF 各 2 轮循环（确定性 drain，非概率性墙钟）；各测试文件内定义局部 `flushAsyncTurns()` 即可，不必进公共层 | `app-content.methods.test.ts` |
| 负向定时器窗口 | 断言**不再发生**（防抖合并恰好 1 次 / disconnect 后订阅已清理） | **保留真实 sleep** 走满定时器窗口——「不会到来的调用」waitFor 永远轮询不到，语义必需；注释标明原因 | `app-sidebar.component.test.ts` |

错误姿势：
- 正等结果用 sleep → 真 flaky（2026-08 审计 P1 案例：`app-content.methods.test.ts` 37 处集中单文件）
- init 落定硬凑 waitFor 条件 → 与组件内部实现耦合，条件易碎
- 负向窗口换成短 sleep → 窗口没走满就断言「没被调」，防抖真坏了也可能漏报

动手前先核查该等待到底在等什么（点击 handler 是否同步、延迟是 setTimeout 还是微任务链），
grep 生产代码确认，勿凭 sleep 时长猜。

## 不变量

- 查询只认 `data-testid`，不绑定 CSS 类 / 文案 / DOM 结构（抗脆弱核心）
- 等待按「异步等待三分法」选型（正等结果→waitFor / init 落定→排空轮次 / 负向定时器窗口→保留 sleep 并注释）——不是无脑全换 waitFor
- testid 值禁止含空格或大小写混排（Design.md §19.1；本层未做入口校验，P3 观察）

## 相关

- ADR-035（G-1 抗脆弱测试基础设施）、Design.md §19.1（testid 规范）、ADR-037（E2E 引入，共享 testid 钩子）
