// ===== 调试日志工具（类型化版 — ADR-014 P2）=====
// 用法：import { dbg } from "../../utils/debug.js"; dbg("btn-click", { id, value });
// 行为：
//   - 默认 console.log 输出，附带 [DBG:tag] 前缀
//   - 可通过 URL ?nodebug=1 关闭（默认开启）
//   - 可通过 window._DBG_RING 取最近 200 条（用于复盘）
//   - 写完调试后请删除调用（调试日志用完即删，见 frontend/AGENTS.md）

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

const ENABLED =
  !new URLSearchParams(window.location.search).has("nodebug") &&
  localStorage.getItem("_debug") !== "0";

const RING_MAX = 200;
window._DBG_RING = window._DBG_RING || [];

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
    if (ring.length > RING_MAX) ring.shift();
  } catch (_) {}
}

/** 输出警告（即使关闭调试也保留） */
export function dbgWarn(tag: string, ...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.warn("[DBG:" + tag + "]", ...args);
  try {
    const ring = window._DBG_RING;
    ring.push({
      t: new Date().toISOString().slice(11, 23),
      tag,
      level: "warn",
      args: args.map((a) => safeStr(a)),
    });
    if (ring.length > RING_MAX) ring.shift();
  } catch (_) {}
}

function safeStr(v: unknown): string {
  try {
    if (v == null) return String(v);
    if (typeof v === "string") return v.length > 200 ? v.slice(0, 200) + "…" : v;
    if (v instanceof Error) return v.message;
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
    const s = JSON.stringify(v);
    return s.length > 200 ? s.slice(0, 200) + "…" : s;
  } catch (_) {
    return String(v);
  }
}

// 调试：控制台可调 window.debugGetSpec(path) 获取 Go spec 骨骼数据
window.debugGetSpec = async (path?: string): Promise<unknown> => {
  try {
    const { GetModel3DSpec } = await import("../../bindings/ysm-model-manager/internal/app/app.js");
    const jsonStr = await GetModel3DSpec(path || "");
    const spec = JSON.parse(jsonStr);
    dbg("model3d", "spec:", spec);
    return spec;
  } catch (e) {
    console.error("[DEBUG]", e);
    return null;
  }
};
