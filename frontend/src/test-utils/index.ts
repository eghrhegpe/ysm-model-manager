// ===== 测试公共工具（test-utils/index）=====
// 入口导出：查询 / 渲染 / 等待 / 自愈
// 注：11 个核心测试文件已按 ADR-146 R6 改为引具体叶，本桶为存量兼容保留。

export {
  getAllByTestId,
  getByTestId,
  queryAllByTestId,
  queryByTestId,
} from "./query-by-testid.ts";

// fireEvent / fireClick 等不经 barrel：
// 消费方直接从 ./events.ts 导入，barrel re-export 无消费方。

export type { RenderOptions, RenderResult } from "./render.ts";
export {
  mountCustomElement,
  renderComponent,
  unmountElement,
} from "./render.ts";
/**
 * 测试自愈工具：菜单表单一事实来源场景下的自适应断言。
 * expectContainsAtLeast / expectNotContains / deriveTestIds / extractIds
 * 依赖 vitest expect，仅测试上下文使用。
 */
export {
  deriveTestIds,
  expectContainsAtLeast,
  expectNotContains,
  extractIds,
} from "./self-healing.ts";
export {
  flushPromises,
  sleep,
  waitFor,
  waitForElementToBeRemoved,
} from "./wait.ts";
