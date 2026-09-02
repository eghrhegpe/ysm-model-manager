// ===== @wailsio/runtime 统一桥（ADR-049 Phase 1 收尾：value import 全量迁移）=====
// 业务模块禁止再直 import "@wailsio/runtime"；统一经此桥，桌面走真 runtime、
// 网页版（无 Wails 壳）走 no-op 桩——MikuMikuAR ADR-176 教训：Events/Window
// 在纯浏览器无原生后端，须 no-op 兜底，否则 OpenDevTools 等会抛 / 行为漂移。
import { Events as WailsEvents, Window as WailsWindow } from "@wailsio/runtime";
import { isWebPlatform } from "./platform-web.ts";
import { dbg } from "../utils/debug/debug.ts";

const isWeb = isWebPlatform();

// Web 桩接口：只暴露 Events 模块实际用到的 6 个方法，返回值与真值对齐——
// Emit 真值返回 Promise<boolean>，桩返回 Promise<false>（诚实报告未发送）；
// Types/WailsEvent 是复杂类/常量对象（monkey-patch 事件表），业务侧不直接消费，
// 故不纳入桩接口——Events 出口的 as unknown as 仅桥接该省略，见下。
interface RuntimeEvents {
  On: (event: string, cb: (...args: unknown[]) => void) => () => void;
  OnMultiple: (event: string, cb: (...args: unknown[]) => void, n: number) => () => void;
  Once: (event: string, cb: (...args: unknown[]) => void) => () => void;
  Off: (event: string) => void;
  OffAll: () => void;
  Emit: (event: string, ...args: unknown[]) => Promise<boolean>;
}

const webEvents: RuntimeEvents = {
  On: () => () => {},
  OnMultiple: () => () => {},
  Once: () => () => {},
  Off: () => {},
  OffAll: () => {},
  Emit: async () => {
    dbg("runtime-bridge", "web no-op Emit");
    return false;
  },
};

// Web 模式 Window 方法：用 Proxy 动态捕获任意方法名，全部返回 Promise.resolve()。
// Proxy 无法用 satisfies 对账（handler 返回的是动态函数，非静态形状），保留
// as unknown as 兜底——但 dbg 留痕让 Web 模式下的假操作可观测。
// thenable 探测陷阱：await Window 会访问 .then——若返回 async 函数会被误判为
// thenable，await 调它后 onFulfilled 永不被调 → 永久挂起。返回 undefined 让
// Window 不是 thenable（与 browser-adapter.ts:75 对称）。
const webWindow: typeof WailsWindow = new Proxy({}, {
  get(_target, prop) {
    // thenable 探测陷阱（见上）——返回 undefined 让 await Window 不挂起
    if (prop === "then") return undefined;
    // symbol（如 Symbol.toStringTag）不拦截，返回 undefined 走默认行为
    if (typeof prop === "symbol") return undefined;
    return async () => {
      dbg("runtime-bridge", "web no-op Window method");
    };
  },
}) as unknown as typeof WailsWindow;

// Events 出口：webEvents 只实现 RuntimeEvents（6 方法），真值还有 Types/WailsEvent
// 复杂导出；经 unknown 桥接避免把桩接口充成完整模块命名空间的类型造假。
export const Events: typeof WailsEvents = isWeb
  ? (webEvents as unknown as typeof WailsEvents)
  : WailsEvents;

export const Window: typeof WailsWindow = isWeb
  ? webWindow
  : WailsWindow;
