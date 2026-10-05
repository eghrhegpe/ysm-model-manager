// ===== 诊断页：日志通道健康常驻条（ADR-322 D2）=====
//
// 立因（§1 缺口 1/2/6）：元失败——「报告失败的通道自身失效」——此前的唯一证据
// 落在**打不开的日志页自己**里：sink 失败写 console（GUI 生产态无 DevTools → 永不可见），
// dbg 落点受调试门控，而「加载日志失败」本身又走 logError（即经由那条可能已失效的通道）。
// 页面此时一路通畅、没有任何降级表现，用户只能靠「日志莫名清空」反推。
// 故把通道健康升为一等公民：Go 侧锁存位/网页版 IDB 探针 → 本条常驻渲染。
//
// 与诊断页其余面板的分工：本条**不做事**（不重试、不写日志、不弹 toast），只陈述一个
// 可查询的事实。写侧修复是 outbox/保留位的事（ADR-322 §2 子决策 2/3），此处若顺手重试
// 就等于把「观测面」与「修复面」缝在一起，日志通道再坏时会自己刷自己。

import { can } from "@/backend/capabilities.ts";
import { tOf } from "@/core/i18n/t.ts";
import { escUnknown } from "@/utils/html/html.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { backendGetApp } from "@/views/backend-deps.ts";

/** reason 机器码 → i18n 键（Go `types.ChannelReason*` + web-store `WEB_REASON_IDB`）。
 *  机器码而非散文：具体错误（含内部路径）已由 go/logs 写进 runtime 环，此处只做键映射，
 *  避免红条把内部路径复述到 UI（ADR-051 精神）。未知码回落「原因未分类」。 */
const REASON_KEYS: Record<string, string> = {
  "memory-state": "diagnostics.channelHealthReasonMemoryState",
  "idb-unavailable": "diagnostics.channelHealthReasonIdbUnavailable",
  "marshal-failed": "diagnostics.channelHealthReasonMarshalFailed",
  "mkdir-failed": "diagnostics.channelHealthReasonMkdirFailed",
  "write-failed": "diagnostics.channelHealthReasonWriteFailed",
};

/** 模块级 memo：健康位**锁存不反弹**，故一次读取即长期有效（ADR-322 §2 子决策 1
 *  「一次失败后健康位不再回弹，避免闪断让 UI 红条闪烁掩盖真实状态」）。与 dgLsLogCaps
 *  同款准静态语义：进程内不必重问，重启后 Go 侧重新锁存。测试用 __reset 重置。 */
let healthPromise: Promise<{ persistOK: boolean; reason?: string }> | null = null;

function fetchHealth(): Promise<{ persistOK: boolean; reason?: string }> {
  healthPromise ??= backendGetApp()
    .then((app) => app.GetLogChannelHealth())
    .then(
      (h) => ({ persistOK: Boolean(h?.persistOK), reason: h?.reason || "" }),
      // 读健康位本身失败 = 通道状态**未知**，不是「健康」：按 ADR-322 §1 缺口 6 的
      // 「宁可误报不可漏报」口径，落到红条而不是静默留白。禁 logError：logError 即经由
      // 那条可能已失效的通道（诊断页自证循环，ADR-322 §1 缺口 6）。
      () => ({ persistOK: false, reason: "unknown" }),
    );
  return healthPromise;
}

/** reason 码 → 可读文案（tOf 动态 key；未知码兜底，缺失键不抛只回落裸 key） */
function reasonText(reason: string | undefined): string {
  if (!reason) return tOf("diagnostics.channelHealthReasonUnknown");
  return tOf(REASON_KEYS[reason] ?? "diagnostics.channelHealthReasonUnknown");
}

/**
 * 渲染日志通道健康条（页面挂载时一次，进 logs 组即可见）。
 *
 * 健康 / 能力不可用 → 保持模板里的 `display:none` 静默留白，不写 DOM；
 * 不健康 → 渲染红条（主行 + 原因行）。
 *
 * ⚠️ 失败分支刻意不 logError：这是本仓唯一「明知通道可能已死还要往里写」的位置，
 * 写失败只会再加一条被同样吞掉的证据（ADR-322 §1 缺口 6）。
 */
export function renderChannelHealth(root: ShadowRoot): void {
  const bar = root.getElementById("diag-log-channel-health");
  if (!bar) return;
  // 能力门控：web/桌面有实现，android 黑名单。不可用时静默不渲染（保持 display:none），
  // 不报错——报错同样要过通道，且 android 端此刻无任何日志通道可用。
  if (!can("GetLogChannelHealth")) {
    bar.style.display = "none";
    bar.innerHTML = "";
    return;
  }
  void fetchHealth().then((h) => {
    // 二次门控：Promise 回来前用户可能已离开本页/清空（app-content 按页缓存面板，
    // 元素仍在），元素被移除时 getElementById 返回 null，静默退出即可。
    const el = root.getElementById("diag-log-channel-health");
    if (!el) return;
    if (h.persistOK) {
      el.style.display = "none";
      el.innerHTML = "";
      return;
    }
    el.style.display = "";
    el.innerHTML =
      `<div class="stat-row diag-msg diag-msg-error">${UI_ICONS.warning} ${tOf("diagnostics.channelHealthUnhealthy")}</div>` +
      `<div class="diag-channel-health-hint">${escUnknown(reasonText(h.reason))}</div>`;
  });
}

/** 测试专用：清空健康位 memo（健康位在进程内只读一次，测试间需复位） */
export function __resetChannelHealthForTest(): void {
  healthPromise = null;
}
