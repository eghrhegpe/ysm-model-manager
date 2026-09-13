// ===== 测试工具：log / console spy 工厂（mock 复印机收敛，对齐 stubBlobUrls 范式）=====
// 原分散在 16+ 测试文件里的同构 spy 骨架：
//   const spy  = vi.spyOn(log, "logWarn");
//   const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
//   const err  = vi.spyOn(console, "error").mockImplementation(() => {});
// 收敛为单一工厂。返回 spy 供 toHaveBeenCalled* 断言；静默实现屏蔽噪声输出。
// 清理：调用方 afterEach 的 vi.restoreAllMocks() / vi.unstubAllGlobals() 统一承担（工厂不接管 restore）。
import { vi } from "vitest";
import * as log from "@/utils/base/primitives/log.ts";

/** 监听项目统一告警通道 logWarn 的调用（断言用）。返回 spy。 */
export function stubLogWarn(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(log, "logWarn");
}

/**
 * 屏蔽 console.warn 噪声，返回 spy（可断言调用）。
 * @param impl 自定义实现（缺省静默 no-op）。
 */
export function stubConsoleWarn(impl?: (...args: unknown[]) => void): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(console, "warn").mockImplementation(impl ?? (() => {}));
}

/**
 * 屏蔽 console.error 噪声，返回 spy（可断言调用）。
 * @param impl 自定义实现（缺省静默 no-op）。
 */
export function stubConsoleError(impl?: (...args: unknown[]) => void): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(console, "error").mockImplementation(impl ?? (() => {}));
}
