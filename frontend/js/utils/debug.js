// ===== 调试日志工具 =====
// 用法：import { dbg } from "../../utils/debug.js"; dbg("btn-click", { id, value });
// 行为：
//   - 默认 console.log 输出，附带 [DBG:tag] 前缀
//   - 可通过 URL ?nodebug=1 关闭（默认开启）
//   - 可通过 window._DBG_RING 取最近 200 条（用于复盘）
//   - 写完调试后请删除调用（按 .github/copilot-instructions.md 规则 18 须请示用户）
const ENABLED =
  !new URLSearchParams(window.location.search).has("nodebug") &&
  localStorage.getItem("_debug") !== "0";

const RING_MAX = 200;
window._DBG_RING = window._DBG_RING || [];

/** 输出调试日志（保留 tag 用于过滤） */
export function dbg(tag, ...args) {
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
export function dbgWarn(tag, ...args) {
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

function safeStr(v) {
  try {
    if (v == null) return String(v);
    if (typeof v === "string") return v.length > 200 ? v.slice(0, 200) + "…" : v;
    if (v instanceof Error) return v.message;
    if (v instanceof Set) return "Set(" + v.size + ")[" + Array.from(v).slice(0, 3).join(", ") + (v.size > 3 ? "…" : "") + "]";
    if (Array.isArray(v)) return "Array(" + v.length + ")";
    const s = JSON.stringify(v);
    return s.length > 200 ? s.slice(0, 200) + "…" : s;
  } catch (_) {
    return String(v);
  }
}