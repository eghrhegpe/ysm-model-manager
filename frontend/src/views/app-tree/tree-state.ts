// ===== 树状态容器（TreeState）— 封装 AppTree 可变状态 =====
// 子模块读状态用 snapshot.xxx，写状态用 vm.setXxx() 或回调。
// 选择状态复用 data.ts 的 SelectState 类型，不重复定义。

import type { SelectState } from "./data.ts";
import type { TreeEntry } from "./loader.ts";
import type { RenderMode } from "./render.ts";

/** 只读快照：子模块消费 */
export interface TreeSnapshot {
  readonly entries: TreeEntry[];
  readonly search: string;
  readonly sort: string;
  readonly dirOpen: Record<string, boolean>;
  readonly filterPaths: Set<string> | null;
  readonly renderMode: RenderMode;
  readonly rootAttr: string;
  readonly subdirAttr: string;
  readonly filesRoot: string;
}

/** 可变状态容器 */
export class TreeState {
  entries: TreeEntry[] = [];
  search = "";
  sort = "name";
  dirOpen: Record<string, boolean> = {};
  filterPaths: Set<string> | null = null;
  renderMode: RenderMode = "grid";
  rootAttr = "";
  subdirAttr = "";
  filesRoot = "";
  selectState: SelectState = { keys: new Set(), lastKey: null };

  /** 返回只读快照给子模块 */
  getSnapshot(): TreeSnapshot {
    return {
      entries: this.entries,
      search: this.search,
      sort: this.sort,
      dirOpen: this.dirOpen,
      filterPaths: this.filterPaths,
      renderMode: this.renderMode,
      rootAttr: this.rootAttr,
      subdirAttr: this.subdirAttr,
      filesRoot: this.filesRoot,
    };
  }
}
