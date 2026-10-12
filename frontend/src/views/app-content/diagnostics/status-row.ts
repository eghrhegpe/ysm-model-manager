// ===== 诊断页状态行外壳：兼容性 re-export 层（ADR-332 D1）=====
//
// 2026-10-13：纯 builder 已提炼为 neutral `utils/dom/status-row.ts`（features→utils 合法，
// 不触发分层红线 R4；CSS 仍由诊断页既有的 `content-diag` 类族承载）。本文件改为 re-export 层，
// 使 conflicts / dedup / dedup-scan / dedup-render / health / logs 等 12+ 处 `./status-row.ts`
// 调用点零改动、视觉不变；新代码应直接 `@/utils/dom/status-row.ts`，本层留作迁移过渡。
//
// 立因与复刻口径见 `utils/dom/status-row.ts` 顶部注释（外壳单点、两族 CSS 并存、图标由调用
// 点给、转义由调用点决定）——本层仅为转发，不再承载实现。
export {
  type EscFn,
  msgRowHTML,
  type StatusRowKind,
  type StatusRowOpts,
  scanRowWithCancelHTML,
  statRowHTML,
} from "@/utils/dom/status-row.ts";
