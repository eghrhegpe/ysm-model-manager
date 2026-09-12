// ===== 渲染代数守卫（oldest-models / recycle-bin 共用，消除「同模式」人肉同步）=====
// 模式语义：rtype 快速切换/组件清理时丢弃过期渲染结果——
//  - next()：每次加载开头自增取号
//  - stale(gen)：await 返回后代数已过期则直接 return（不写 DOM、不绑监听）
//  - invalidate()：cleanup 时调用，使所有在途请求的代数失效（防幽灵写入/监听泄漏）

export interface LoadGuard {
  /** 开始一轮新加载：自增计数并返回本轮代数 */
  next(): number;
  /** 本轮代数是否已过期（期间发生过 next/invalidate） */
  stale(gen: number): boolean;
  /** 使全部在途代数失效（cleanup 场景） */
  invalidate(): void;
  /** 最新代数（不推进；纯捕获当前代，供「删除/读取期间捕获」式检查点使用） */
  readonly current: number;
}

export function createLoadGuard(): LoadGuard {
  let gen = 0;
  return {
    next: () => ++gen,
    stale: (g) => g !== gen,
    invalidate: () => {
      gen++;
    },
    get current() {
      return gen;
    },
  };
}
