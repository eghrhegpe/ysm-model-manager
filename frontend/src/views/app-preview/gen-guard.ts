/**
 * GenGuard：统一代际守卫（bug-chronicle #18 治理）。
 *
 * 背景：app-preview 域内 _detailGen / _previewGen / litematicGen / model3dGen
 * 各文件手抄同一模式（模块级 let + ++ 比较），同功能多实现时易漏防护
 * （oldest-models 案例）。收敛为单一实现，语义三件套：
 *
 * - `next()`：进入函数时推进并捕获 gen；
 * - `stale(gen)`：每个 await 续体后的检查点，true 即丢弃本次渲染/回写；
 * - `invalidate()`：无捕获推进——无 await 也要作废在途的慢请求回写。
 */

export class GenGuard {
  #gen = 0;

  /** 推进代数并返回新值，调用方捕获后在 await 续体中用 stale() 校验。 */
  next(): number {
    return ++this.#gen;
  }

  /** 只推进不捕获：作废所有在途请求（如切换预览类型时的跨域作废）。 */
  invalidate(): void {
    ++this.#gen;
  }

  /** 最新代数；等价于 stale(g.current) 的反义。 */
  get current(): number {
    return this.#gen;
  }

  /** 检查点：gen 落后于最新代数即过期，应立即 return。 */
  stale(gen: number): boolean {
    return gen !== this.#gen;
  }
}
