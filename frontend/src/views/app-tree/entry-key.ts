// ===== 树行键空间契约的单一事实源（ADR-222）=====
//
// 文件行的权威键 = 磁盘完整路径，缺失时回落相对路径。三处必须同源：
//   ① `TreeRow.key`（render.flattenVisible 产出的行身份）
//   ② DOM `data-fullpath`（row-common 的 fp）
//   ③ `selectState.keys` / `lastKey`（选中态）
// 任一处漂移，`indexOf`/`has` 比对会静默失配——Shift 范围选择、右键批量、
// 全选、键盘 ↑↓ 导航、双击重命名定位全体失效且不报错。
//
// 为何独立成文件而非并入 loader.ts：渲染层（render / row-common）需要本函数，
// 但对 loader.ts 只能保持 type-only 依赖——多个组件测试 `vi.mock("./loader.ts")`
// 只为替换 loadEntries，若渲染层值依赖 loader 会在 mock 下取到 undefined 而崩渲染。
// 本模块仅 type import，零运行时依赖，不被任何 mock 波及。
import type { TreeEntry } from "./loader.ts";

export function entryKey(e: TreeEntry): string {
  return e.fullPath || e.path;
}
