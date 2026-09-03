// ===== 调试日志工具（类型化版 — ADR-014 P2）=====
// 用法：import { dbg } from "../../utils/debug/debug.ts"; dbg("btn-click", { id, value });
// 行为：
//   - 默认 console.log 输出，附带 [DBG:tag] 前缀
//   - 可通过 URL ?nodebug=1 关闭（默认开启）
//   - 可通过 window._DBG_RING 取最近 200 条（用于复盘）
//   - 写完调试后请删除调用（调试日志用完即删，见 frontend/AGENTS.md）
import { safeGet } from "../dom/storage.ts";

interface RingEntry {
  t: string;
  tag: string;
  level?: "warn";
  args: string[];
}

declare global {
  interface Window {
    _DBG_RING: RingEntry[];
    debugGetSpec: (path?: string) => Promise<unknown>;
  }
}

// P3 修复（审核）：模块顶层裸调 localStorage 改 safeGet——隐私模式（存储禁用）下
// getItem 抛错会中断 debug 模块加载链（debug 被全库 import，牵连启动流程）；
// safeGet 静默降级返回 null（= 开启调试，等价于无 _debug 键）
// node 测试环境无 window.location（vitest @vitest-environment node）→ ENABLED=false
const ENABLED =
  typeof window !== "undefined" &&
  !new URLSearchParams(window.location.search).has("nodebug") &&
  safeGet("_debug") !== "0";

const RING_MAX = 200;
if (typeof window !== "undefined") window._DBG_RING = window._DBG_RING || [];

/** 输出调试日志（保留 tag 用于过滤） */
export function dbg(tag: string, ...args: unknown[]): void {
  if (!ENABLED) return;
  const line = "[DBG:" + tag + "]";
  // eslint-disable-next-line no-console
  console.log(line, ...args);
  try {
    const ring = window._DBG_RING;
    ring.push({
      t: new Date().toISOString().slice(11, 23),
      tag,
      args: args.map((a) => safeStr(a)),
    });
    // P3 修复：一次性截断到上限——原 `if (len > RING_MAX) shift()` 在
    // window._DBG_RING 被外部预置 >200 条时每次只删 1 条，长时间无法收敛
    if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
  } catch (e) {
    console.error("[DBG] ring 写入失败:", e);
  }
}



/** 任意值 → 可读字符串（200 字符截断；供单测导出的纯函数） */
export function safeStr(v: unknown): string {
  try {
    if (v == null) return String(v);
    if (typeof v === "string") return v.length > 200 ? v.slice(0, 200) + "…" : v;
    // P3 修复：Error 分支也走 200 字符截断——原实现直接返回 v.message，
    // 超长 message 会让环形缓冲条目突破上限约束
    if (v instanceof Error)
      return v.message.length > 200 ? v.message.slice(0, 200) + "…" : v.message;
    if (v instanceof Set)
      return (
        "Set(" +
        v.size +
        ")[" +
        Array.from(v).slice(0, 3).join(", ") +
        (v.size > 3 ? "…" : "") +
        "]"
      );
    if (Array.isArray(v)) return "Array(" + v.length + ")";
    // P3 修复：JSON.stringify 对函数/symbol 返回 undefined——原直接 `s.length` 在
    // strict 下为 TS2532（运行时靠 catch 兜底不崩，类型层不过关）；先判空走 String 兜底
    const s = JSON.stringify(v);
    if (s === undefined) return String(v);
    return s.length > 200 ? s.slice(0, 200) + "…" : s;
  } catch (_) {
    return String(v);
  }
}

// 调试：控制台可调 window.debugGetSpec(path) 获取 Go spec 骨骼数据
// node 测试环境无 window，跳过挂载
// 断环（架构锐评 P0-2）：模块顶层不再静态依赖 backend/app.ts——本文件为叶子工具，
// 控制台钩子仅在调用时动态 import 桥（浏览器运行时按需加载，无静态环）。
if (typeof window !== "undefined") {
  window.debugGetSpec = async (path?: string): Promise<unknown> => {
    try {
      const { getApp } = await import("../../backend/app.ts");
      const { GetModel3DSpec } = await getApp();
      const spec = await GetModel3DSpec(path || "");
      dbg("model3d", "spec:", spec);
      return spec;
    } catch (e) {
      console.error("[DEBUG]", e);
      return null;
    }
  };
}
