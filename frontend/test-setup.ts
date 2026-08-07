// ===== vitest 全局测试基建（setupFiles）=====
// 环境修复，新测试文件免重复处理：
// 1. @wailsio/runtime 全局阻断 —— 其 drag.js 在模块加载时访问 window，
//    happy-dom teardown 后延迟回调报 "window is not defined" 环境噪声
import { vi } from "vitest";

// 1. Wails runtime 全局阻断（测试环境无需真实 runtime；组件测试可省去各自 vi.mock）
vi.mock("@wailsio/runtime", () => ({
  Events: {
    On: () => () => {},
  },
}));
