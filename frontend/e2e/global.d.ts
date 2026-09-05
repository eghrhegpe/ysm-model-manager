// ===== e2e 编译期类型环境 =====
// tsconfig.e2e.json 的 include 仅含 e2e/**/*.ts + playwright 配置（不包含 src/**），
// src 的 declare global（src/bus.ts 的 window.bus）只有被 spec import 链拉入才生效——
// 2026-09 modal.ts 拆分断链后 toast.spec.ts 报 TS2339。此文件显式引入声明，
// 使 window.bus 类型对全部 e2e 文件可用，不依赖 src import 链的偶然性。
import type {} from "../src/bus.ts";
