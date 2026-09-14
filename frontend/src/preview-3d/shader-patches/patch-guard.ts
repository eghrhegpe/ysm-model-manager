// ===== shader patch 版本守卫（2026-09-14 锐评 P1-3 落地：three 升级时锚点失配静默降级 → 显式化）=====
// 背景：sky/water/reflector 三处对 three 官方 shader 做字符串锚点替换（injectSkySunScalePatch /
// onBeforeCompile / injectOpacityIntoShader）。锚点失配时原实现 ringLog 留痕——但生产环境
// 无 __ysmRingLog 挂载点且未传 consoleFallback → 告警实际全部落空，升级后功能静默失效。
//
// 本模块提供两件套：
//  1. assertRevisionRange —— three REVISION 范围断言：升级到未审计版本时显式 throw（调用方
//     registry 工厂 try/catch 兜底，只使该 cap 缺失、不崩 mount），替代「锚点失配静默降级」；
//  2. reportPatchIssue —— ringLog + console 兜底包装：生产无挂载点时告警落到 console 而非落空。
//
// 版本审计节奏：升级 three 后跑全量测试——若 shader 相关用例红，按报错定位锚点/REVISION
// 更新对应 allowed 列表（sky/reflector 锁精确版本、water 可给宽松范围，见各调用处）。
import * as THREE from "three";
import { ringLog } from "@/preview-3d/caps/scene-capability.ts";

/** REVISION 校验纯函数（可脱离 three 直测）：rev 不在 allowed 内返回失配说明，否则 null */
export function checkRevision(rev: string, allowed: readonly string[]): string | null {
  if (allowed.includes(rev)) return null;
  return `three REVISION "${rev}" 未在已审计列表 [${allowed.join("/")}] 内，shader 锚点可能已变更——拒绝静默降级`;
}

/** 版本断言：范围外 throw（文案含允许列表，便于升级审计时定位） */
export function assertRevisionRange(opts: {
  /** 模块名（告警/报错前缀，如 "sky-patch"） */
  module: string;
  /** 已审计 REVISION 列表（如 ["185"]）——升级后按测试红报错更新 */
  allowed: readonly string[];
}): void {
  const rev = (THREE as { REVISION?: string }).REVISION ?? "unknown";
  const mismatch = checkRevision(rev, opts.allowed);
  if (mismatch) {
    const msg = `[shader-patch] ${opts.module}：${mismatch}`;
    reportPatchIssue(opts.module, msg, "error");
    throw new Error(msg);
  }
}

/** ringLog + console 兜底（生产无 __ysmRingLog 挂载点时告警落 console，不再完全静默） */
export function reportPatchIssue(mod: string, msg: string, lvl: "info" | "warn" | "error"): void {
  ringLog(mod, msg, lvl, () => {
    if (lvl === "error") console.error(`[${mod}] ${msg}`);
    else if (lvl === "warn") console.warn(`[${mod}] ${msg}`);
    else console.info(`[${mod}] ${msg}`);
  });
}
