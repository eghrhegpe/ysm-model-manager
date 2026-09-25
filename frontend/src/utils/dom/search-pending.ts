// ===== 仓库树搜索词一次性 pending（focus-pending 同族，2026-09 收债）=====
// 解决 repo:search-creator → nav:changed → tree:set-search 的冷启动竞态：
// app-tree chunk 走动态 import（app-modules.ts），元素未升级时 connectedCallback
// 未跑、bus 监听不存在，emit 落空搜索词静默丢失（焦点侧已有 focus-pending 先例，
// 搜索词缺对称通道）。
// 写侧（app-content）：**先 setPending 再 emit**——bus 同步派发，已挂载场景
// listener 命中即 take 清残（无残留），未挂载场景 emit 落空由 app-tree 挂载段
// take 消费；take 即清，防跨挂载迟到误填旧词。

let pendingTreeSearch: string | null = null;

/** 写侧：落 pending 词（null = 清残） */
export function setPendingTreeSearch(word: string | null): void {
  pendingTreeSearch = word;
}

/** 读侧：取走并清零（一次性）。bus listener 命中路径与挂载段消费均经此入口，互斥防双触发 */
export function takePendingTreeSearch(): string | null {
  const v = pendingTreeSearch;
  pendingTreeSearch = null;
  return v;
}
