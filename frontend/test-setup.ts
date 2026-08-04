// ===== vitest 全局测试基建（setupFiles）=====
// 环境修复，新测试文件免重复处理：
// 1. DragEvent polyfill —— jsdom 29 未实现（handler-dnd 等 DnD 测试需要）
// 2. @wailsio/runtime 全局阻断 —— 其 drag.js 在模块加载时访问 window，
//    jsdom teardown 后延迟回调报 "window is not defined" 环境噪声
import { vi } from "vitest";

// 1. DragEvent polyfill（jsdom 缺失；守卫层测试不依赖 dataTransfer 细节）
if (typeof (globalThis as { DragEvent?: unknown }).DragEvent === "undefined") {
  (globalThis as Record<string, unknown>).DragEvent = class DragEvent extends Event {
    constructor(type: string, init?: EventInit) {
      super(type, init);
    }
  };
}

// 2. Wails runtime 全局阻断（测试环境无需真实 runtime；组件测试可省去各自 vi.mock）
vi.mock("@wailsio/runtime", () => ({
  Events: {
    On: () => () => {},
  },
}));
