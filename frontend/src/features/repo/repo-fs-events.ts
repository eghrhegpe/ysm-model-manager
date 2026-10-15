// ===== 仓库文件系统变更事件桥（止血 2026-10-15 A3：watcher 不驱动 UI 根治）=====
// Go go/watcher 的 onChange（syncAll 执行段前触发，800ms 防抖）→
// Wails Event("repo:fs-changed")（internal/app emitRepoFsChanged，nil 守卫）→
// 本模块 app 级单例 EventsOn（download-queue-store 同款形态：注册一次，切页不丢）
// → 二级 800ms 防抖（合并 Go 侧 pending 续跑的多轮触发）→ bus.emit("repo:fs-changed")
// → app-tree 订阅走 _load() 链重载（Go 已清缓存，重扫必走盘；止血 P0-1 起为无哈希快路径）。
// 网页版 runtime.ts 的 Events.On 是 no-op 桩 → 本注册在 web 恒静默，
// 手动刷新（tree:reload）保持现状——不假装 web 有 watcher。

import { Events } from "@/backend/runtime.ts";
import { bus } from "@/bus";
import { dbg } from "@/utils/debug/debug.ts";

// 二级防抖：与 Go watcher 的 debounceDelay（800ms）同源口径——Go 侧防抖合并常规事件，
// 本侧合并「syncAll pending 续跑」产生的多轮触发（用户连续拖文件场景）。
// 双段最坏 1.6s 才上屏，可接受（刷新是低频后台动作，非交互路径）。
const REPO_FS_RELOAD_DEBOUNCE_MS = 800;

let registered = false;
let reloadTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * app 级一次性注册（app-content connectedCallback 调用，与 registerSync 等
 * 五组全局 handler 并列；幂等——二次 init 不重复 EventsOn）。
 * @returns cleanup 解订阅 + 清在途防抖（收进 globalUnsubs，组件卸载语义完整）
 */
export function registerRepoFsEvents(): () => void {
  if (registered) {
    dbg("repo-fs-events", "already registered, skip");
    return () => {};
  }
  registered = true;
  const unsub = Events.On("repo:fs-changed", () => {
    dbg("repo-fs-events", "repo:fs-changed → 防抖重载");
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      bus.emit("repo:fs-changed");
    }, REPO_FS_RELOAD_DEBOUNCE_MS);
  });
  return () => {
    unsub();
    if (reloadTimer) {
      clearTimeout(reloadTimer);
      reloadTimer = null;
    }
    registered = false;
  };
}
