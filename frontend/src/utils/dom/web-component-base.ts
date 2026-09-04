// ===== Web Component 基类（node 测试安全）=====
// 2026-08-17 神桶拆分的配套：9 处视图顶层 `class X extends HTMLElement` 是 node
// 环境毒点（node 无 HTMLElement 全局，测试 import 即 ReferenceError）。统一走本基类：
// - 浏览器：就是 HTMLElement（语义不变，customElements.define 正常）
// - node 测试：空类（import 不炸；注册守卫 typeof customElements 已跳过 define）
// 类型上恒为 typeof HTMLElement（保留 attachShadow/classList 等成员提示）。
export const WebComponentBase: typeof HTMLElement =
  typeof HTMLElement !== "undefined" ? HTMLElement : (class {} as unknown as typeof HTMLElement);
