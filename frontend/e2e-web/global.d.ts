// ===== e2e-web 编译期类型环境 =====
// postprocessing.spec.ts 的 page.evaluate 内动态 import 走 vite dev 的**浏览器运行时 URL**
// （three 走预打包 deps，addons 走 /@id/ pnpm 布局透传）——这些 URL 只在浏览器 dev server
// 下可解析，tsc 视为不存在模块报 TS2307 → 此文件做环境模块声明，any 类型（测试消费的是
// three 运行时对象，不声明精确类型）。
// 通配模式：后续同类新增的动态 import URL（deps 产物 / /@id/ 透传）自动覆盖，勿逐个补。
declare module "/node_modules/.vite/deps/*" {
  const value: any;
  export = value;
}
declare module "/@id/*" {
  const value: any;
  export = value;
}
