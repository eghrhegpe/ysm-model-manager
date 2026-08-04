// ===== 测试公共辅助（组件编排测试复用）=====
// 从 4 个组件测试（app-tree/sidebar/content/preview.component.test.ts）
// 抽取重复的 sleep / mount / unmount——消除显著重复（≥2 文件反模式）
// 注意：vi.mock 工厂是 hoisted 的，无法从本模块导出复用——bindings 等
// mock 仍在各测试文件内联（可复制自样板）

/** 等待异步完成（组件 connectedCallback / bus 事件 / 防抖的真实时序） */
export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** 挂载自定义元素到 body（触发 connectedCallback） */
export function mountCustomElement(tag: string): HTMLElement {
  const el = document.createElement(tag);
  document.body.appendChild(el);
  return el;
}

/** 卸载元素（触发 disconnectedCallback） */
export function unmountElement(el: HTMLElement): void {
  document.body.removeChild(el);
}
