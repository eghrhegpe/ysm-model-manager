// ===== 树状态容器（TreeState）— 封装 AppTree 可变状态 =====
// 子模块读状态用 snapshot.xxx，写状态用 vm.setXxx() 或回调。
// 选择状态复用 data.ts 的 SelectState 类型，不重复定义。

import type { AppliedAdvFilter } from "@/features/dialogs/adv-filter-util.ts";
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
  readonly advFilter: AppliedAdvFilter;
}

/** 可变状态容器 */
export class TreeState {
  entries: TreeEntry[] = [];
  /** 最近一次 _load 是否失败（2026-10-13 P2）：空 entries + loadFailed=true →
   *  空态显示「加载失败」而非「暂无模型文件」，用户侧可区分真空目录与扫描出错。
   *  成功加载（含真返回空列表）即清位；搜索无匹配空态不受影响。 */
  loadFailed = false;
  search = "";
  sort = "name";
  dirOpen: Record<string, boolean> = {};
  filterPaths: Set<string> | null = null;
  renderMode: RenderMode = "grid";
  rootAttr = "";
  subdirAttr = "";
  filesRoot = "";
  /** 已应用的高级筛选条件（数值六范围 + 标签）；状态容器化 23d8868f9 的补票，
   *  取代原「#adv-filter 隐藏 input 当模态框跨次状态槽」的僵尸 DOM */
  advFilter: AppliedAdvFilter = {
    minBones: null,
    maxBones: null,
    minCubes: null,
    maxCubes: null,
    minTex: null,
    maxTex: null,
    tag: "",
  };
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
      advFilter: this.advFilter,
    };
  }
}
