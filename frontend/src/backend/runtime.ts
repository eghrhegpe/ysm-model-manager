// ===== @wailsio/runtime 统一桥（ADR-049 Phase 1 收尾：value import 全量迁移）=====
// 业务模块禁止再直 import "@wailsio/runtime"；统一经此桥，桌面走真 runtime、
// 网页版（无 Wails 壳）走 no-op 桩——MikuMikuAR ADR-176 教训：Events/Window
// 在纯浏览器无原生后端，须 no-op 兜底，否则 OpenDevTools 等会抛 / 行为漂移。
import { Events as WailsEvents, Window as WailsWindow } from "@wailsio/runtime";
import { resolveWebMode } from "./platform.ts";

const isWeb = resolveWebMode();

const webEvents = {
  On: () => () => {},
  OnMultiple: () => () => {},
  Off: () => {},
  Emit: () => Promise.resolve(),
};

const webWindow = new Proxy({} as Record<string, () => Promise<void>>, {
  get: () => () => Promise.resolve(),
});

export const Events: typeof WailsEvents = isWeb
  ? (webEvents as unknown as typeof WailsEvents)
  : WailsEvents;

export const Window: typeof WailsWindow = isWeb
  ? (webWindow as unknown as typeof WailsWindow)
  : WailsWindow;
