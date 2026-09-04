// ===== 3D 全屏 overlay 激活查询（唯一权威 API）=====
// ADR-175 M1：3D overlay 由 mount-preview-core 挂到 document.body（host 带 shadowRoot，
// id/class/aria 保留在 host 上），单例创建、会话关闭时从 DOM 摘除。
// 「host 是否在 document」=「3D 模态会话是否正在屏上」的最高保真事实源：
//   - 比 preview-3d 内部 hasActivePreview() 时序更精确（overlay 挂载早于 handle push，
//     移除早于 finishSession 摘 handle，见 mount-preview-core）
//   - 零状态漂移：无需订阅/emit 维护布尔，天然跟随 DOM 生命周期
// 消费方（app-tree 键盘门禁等）统一经本函数查询，禁止各自裸 getElementById——
// 隐式契约收编为显式 API，模式可被后续组件安全复用而不扩散。
import { PREVIEW_OVERLAY_ID } from "./ui-constants.ts";

/** 3D 全屏模态会话是否激活（overlay 容器是否存在于 document） */
export function isPreviewOverlayActive(): boolean {
  return typeof document !== "undefined" && !!document.getElementById(PREVIEW_OVERLAY_ID);
}
