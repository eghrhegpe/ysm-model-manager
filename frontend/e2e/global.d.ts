// ===== e2e 编译期类型环境 =====
// tsconfig.e2e.json 的 include 不含 src/**（e2e + e2e-web 用例域 + playwright 配置），
// src 的 declare global（src/bus.ts 的 window.bus）只有被 spec import 链拉入才生效——
// 2026-09 modal.ts 拆分断链后 toast.spec.ts 报 TS2339。此文件显式引入声明，
// 使 window.bus 类型对全部 e2e 文件可用，不依赖 src import 链的偶然性。
// （浏览器运行时 URL 的通配环境声明在纯全局文件 vite-urls.d.ts——本文件含顶层
// import，ambient 通配放这里会被 TS 当模块增强静默忽略，勿混淆。）
import type {} from "../src/bus.ts";
