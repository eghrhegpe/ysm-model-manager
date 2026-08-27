// @vitest-environment node
// ===== 平台判定 parity 契约测试（ADR-123 P3 审核补强）=====
// 钉死三个平台谓词的等价关系，锁死「双判定源静默漂移」回归面：
//   ① resolveWebMode() === (resolvePlatformMode() === "web")
//   ② isViewerMode() === (resolvePlatformMode() !== "desktop")
// 覆盖 Tier 0（入口声明）× Tier 1（构建模式）× Tier 2（wails 桥存在性）全组合。
//
// ⚠️ 不 mock 模块：直接驱动真实信号原语。platform.ts 的两个信号就是读全局量
// （readDeclaredBackend → __YSM_BACKEND__；isWebEntryMode → __YSM_WEB__ 或
// MODE=web），三谓词在真实信号上对拍，杜绝「mock 替换掩盖漂移」的假通过。
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { resolvePlatformMode } from "./platform-web.ts";
import { resolveWebMode } from "./platform.ts";
import { isViewerMode } from "../utils/dom/android-bridge.ts";

const g = globalThis as Record<string, unknown>;

/** [Tier0声明, Tier1构建标记, wails桥存在] 全组合 */
const COMBOS: Array<["go" | "browser" | undefined, boolean, boolean]> = [];
for (const declared of ["go", "browser", undefined] as const) {
  for (const entry of [false, true]) {
    for (const wails of [false, true]) {
      COMBOS.push([declared, entry, wails]);
    }
  }
}

function setState(declared: "go" | "browser" | undefined, entry: boolean, wails: boolean): void {
  if (declared === undefined) delete g.__YSM_BACKEND__;
  else g.__YSM_BACKEND__ = declared;
  if (entry) g.__YSM_WEB__ = true;
  else delete g.__YSM_WEB__;
  // @wailsio/runtime 原语探测认 window：有桥给最小形状（getAndroidBridge 校验方法存在）
  Object.assign(globalThis, {
    window: wails ? { wails: { requestStoragePermission: () => {} } } : {},
  });
}

const savedBackend = g.__YSM_BACKEND__;
const savedWeb = g.__YSM_WEB__;
beforeEach(() => {
  delete g.__YSM_BACKEND__;
  delete g.__YSM_WEB__;
});
afterEach(() => {
  if (savedBackend !== undefined) g.__YSM_BACKEND__ = savedBackend;
  if (savedWeb !== undefined) g.__YSM_WEB__ = savedWeb;
});

describe("平台谓词 parity（三源交叉对拍，12 组合全扫）", () => {
  it.each(COMBOS)(
    "declared=%s entry=%p wails=%p：webMode↔mode==='web' 且 viewerMode↔mode!=='desktop'",
    (declared, entry, wails) => {
      setState(declared, entry, wails);

      const mode = resolvePlatformMode();

      // 契约 ①：单态 web 谓词与三态判定的 web 态严格等价
      expect(resolveWebMode()).toBe(mode === "web");
      // 契约 ②：查看器谓词与「非桌面」严格等价（viewer = web ∪ android）
      expect(isViewerMode()).toBe(mode !== "desktop");
      // 三态自洽：取值域合法；且「wails 有桥 + 无任何声明/标记」必须判 android
      expect(["desktop", "web", "android"]).toContain(mode);
      if (wails && declared === undefined && !entry) expect(mode).toBe("android");
    },
  );
});
