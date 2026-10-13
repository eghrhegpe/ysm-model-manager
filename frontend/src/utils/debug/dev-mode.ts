// ===== 开发态判据（唯一开关，默认关）=====
//
// 为什么单列一个叶子：`?dev=1 / localStorage._devtools=1` 这套判定原先只写在 `app-modules.ts`
// 模块顶层的 `_devMode` 常量里。当第二处需要「这段代码只该在开发态跑」时（创作者头像的
// 调试提取探针），直接在视图层再写一遍 URL/localStorage 就是**第二个真值源**——两处口径
// 迟早漂移（一处认 `?dev`、一处认 `?dev=1` 之类）。`app-modules.ts` 自身注释已立此规矩：
// 「复用 _devMode 判定（?dev=1 / _devtools），不发明第二个 debug 开关」。
//
// ⚠️ 与 `debug.ts|isDebugEnabled()` 是**两个不同的开关**，别混用：
//   - `isDebugEnabled()` 默认**开**（`?nodebug=1` / `_debug=0` 才关）——管 dbg 日志要不要输出；
//   - `isDevMode()` 默认**关**（须显式 `?dev` / `_devtools=1` 才开）——管昂贵/侵入性的调试
//     动作要不要执行。
// 拿 isDebugEnabled 当调试动作的门是错的：它默认就是 true，门等于没关。
import { safeGet } from "@/utils/base/primitives/storage.ts";

/**
 * 开发态是否开启：URL 含 `dev` 参数（`?dev` / `?dev=1` 均算）或 localStorage `_devtools === "1"`。
 *
 * 运行时求值（非模块加载期常量）——隐私模式下 `safeGet` 静默返回 null（等价未开启），
 * 不会像裸调 localStorage 那样抛错中断求值链。node 测试环境无 window → false。
 */
export function isDevMode(): boolean {
  if (typeof window === "undefined") return false;
  const hasDevParam = new URLSearchParams(window.location.search).has("dev");
  return hasDevParam || safeGet("_devtools") === "1";
}
