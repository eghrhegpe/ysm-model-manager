// ===== @wailsio/runtime 统一桥（ADR-049 Phase 1 收尾：value import 全量迁移）=====
// 业务模块禁止再直 import "@wailsio/runtime"；统一经此桥，桌面走真 runtime、
// 网页版（无 Wails 壳）走 no-op 桩——MikuMikuAR ADR-176 教训：Events/Window
// 在纯浏览器无原生后端，须 no-op 兜底，否则 OpenDevTools 等会抛 / 行为漂移。
import { Events as WailsEvents, Window as WailsWindow } from "@wailsio/runtime";
import { resolveWebMode } from "./platform.ts";
import { dbg } from "../utils/debug/debug.ts";

const isWeb = resolveWebMode();

// Web 桩接口：只暴露实际用到的 4 个方法，返回值与真值对齐（Emit 返回 Promise<void>
// 而非 undefined），satisfies 编译期逐项对账——桌面模式仍直接透传 WailsEvents，
// 不受桩接口影响。
interface RuntimeEvents {
  On: (event: string, cb: (...args: unknown[]) => void) => () => void;
  OnMultiple: (event: string, cb: (...args: unknown[]) => void, n: number) => () => void;
  Off: (event: string) => void;
  /** Web 模式：不真的 emit 事件，但返回 Promise 保持调用方 await 语义与桌面一致 */
  Emit: (event: string, ...args: unknown[]) => Promise<void>;
}

const webEvents: RuntimeEvents = {
  On: () => () => {},
  OnMultiple: () => () => {},
  Off: () => {},
  Emit: async () => {
    dbg("runtime-bridge", "web no-op Emit");
  },
};

// Web 模式 Window 方法：用 Proxy 动态捕获任意方法名，全部返回 Promise.resolve()。
// Proxy 无法用 satisfies 对账（handler 返回的是动态函数，非静态形状），保留
// as unknown as 兜底——但 dbg 留痕让 Web 模式下的假操作可观测。
const webWindow: typeof WailsWindow = new Proxy({}, {
  get: () => async () => {
    dbg("runtime-bridge", "web no-op Window method");
  },
}) as unknown as typeof WailsWindow;

export const Events: typeof WailsEvents = isWeb
  ? (webEvents as typeof WailsEvents)
  : WailsEvents;

export const Window: typeof WailsWindow = isWeb
  ? webWindow
  : WailsWindow;
