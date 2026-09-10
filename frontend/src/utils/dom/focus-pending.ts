// ===== 仓库搜索框焦点一次性 pending 标志（ADR-223 §2.2）=====
// 解决 nav→app-tree 跨挂载时序竞态：nav 点 repository 项时置 true + 发 repo:focus-search；
// app-tree 已挂（ADR-163 常驻面板）→ bus listener 取走并 focus；
// 未挂（首访/动态 import 竞态）→ connectedCallback 末尾 take 走并 focus。
// take 即清，防跨测试/跨挂载泄漏。替代原 app-nav 25ms×20 shadow-root 轮询（DOM 穿透违约）。

let pendingRepoSearchFocus = false;

/** nav 侧：repository 激活置 true（并发 bus 事件）；非 repository 激活置 false 清残 */
export function setRepoSearchFocusPending(v: boolean): void {
  pendingRepoSearchFocus = v;
}

/** app-tree 侧：取走并清零（一次性）。挂载时 + bus listener 均经此入口，互斥清零防双触发 */
export function takeRepoSearchFocusPending(): boolean {
  const v = pendingRepoSearchFocus;
  pendingRepoSearchFocus = false;
  return v;
}
