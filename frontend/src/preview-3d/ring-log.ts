// ring-log.ts — 环形日志面板注入点取用 helper（叶子模块，零依赖）。
// 原 scene-capability.ts 内定义；2026-10 下沉至此打破
// env-dispatcher → scene-capability → env-state → env-dispatcher 循环依赖
// （env-dispatcher 只消费本函数，不该依赖 caps 层）。scene-capability 保留 re-export 兼容旧引用。

/**
 * 环形日志面板注入点取用 helper（mount-preview-core 在 globalThis 挂载 __ysmRingLog）。
 * 此前三处构建/加载路径逐字复制同构的 globalThis cast 样板（锐评 P2），收敛于此；
 * 无注入点时可选 console 兜底（文案可与面板版不同，保持既有控制台口径）。
 */
export function ringLog(
  mod: string,
  msg: string,
  lvl: "info" | "warn" | "error",
  consoleFallback?: () => void,
): void {
  const logger = (
    globalThis as unknown as {
      __ysmRingLog?: (mod: string, msg: string, lvl?: "info" | "warn" | "error") => void;
    }
  ).__ysmRingLog;
  if (logger) logger(mod, msg, lvl);
  else consoleFallback?.();
}
