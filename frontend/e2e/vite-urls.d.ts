// ===== e2e 编译期：浏览器运行时 URL 环境模块声明（纯全局 .d.ts，勿加顶层 import/export）=====
// menu-visual.spec.ts 等 page.evaluate 内按 vite dev 的 /src/... 路径动态 import 应用源码
// （视觉巡检消费运行时行为，不校验类型）——该 URL 只可浏览器运行时解析，tsc 报 TS2307。
// 通配 any 兜底：新增同类 /src/ 动态 import 自动覆盖，勿逐个补。
//
// ⚠️ 通配 ambient 声明必须放**纯全局** .d.ts（无顶层 import/export）：放进模块文件
// （如 e2e/global.d.ts，其顶部有 import type）会被 TS 当模块增强静默忽略（实测 2026-10-04：
// 放 global.d.ts 不生效、移出后 tsc 转绿）——勿移回。
//
// ⚠️ 潜伏绊线（2026-10 锐评 P2-4）：`/...` 开头的模块名在关闭 skipLibCheck 时会触发
// TS2436（Ambient module declaration cannot specify relative module name）——当前绿态
// 依赖 tsconfig.json 继承的 skipLibCheck: true。谁若为 e2e 单独关掉 skipLibCheck，本文件
// 与 e2e-web/global.d.ts 即红——改开关前先改声明（如按具体 URL 逐条 shorthand declare module）。
declare module "/src/*" {
  const value: any;
  export = value;
}
