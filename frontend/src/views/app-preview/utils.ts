// ===== 预览模块共享工具函数 =====
// 从 index.ts 拆分：模块级函数和状态
// ADR-137 第五刀拆分：纯领域部分（DecodedYsm / stripYsgpTextHeader / devLog）
// 已归位 features/preview-3d/decoder/utils.ts——本文件只留视图接口与状态。

/** 预览上下文（index.ts AppPreview 类实现的接口，子模块以最小面引用） */
/** 渲染容器 + 生命周期（detail/litematic-meta/skeleton 消费 root，skeleton 消费 unsubs） */
export interface PreviewRoot {
  root: ShadowRoot;
  /** 组件销毁清理收集（可选：子模块可挂 window/document 监听清理函数） */
  unsubs?: Array<() => void>;
}

/** WASM 解码能力（loader/skeleton 消费） */
export interface YsmDecoder {
  decodeYsmViaWasm(path: string): Promise<import("../../features/preview-3d/decoder/utils.ts").DecodedYsm | null>;
}

/** 调试输出能力（loader/skeleton 消费） */
export interface PreviewDebugger {
  appendDebug(container: HTMLElement | null, msg: string): void;
}

/** 预览图加载能力（detail 消费） */
export interface PreviewImageLoader {
  loadPreviewImage(path: string): Promise<string | null>;
}

/** 组合接口：实现方（AppPreview）与兼容旧调用方的完整视图。
 * 消费方按需收窄参数到小接口（见 detail/litematic-meta/loader/skeleton），
 * 测试 mock 只需提供被测字段，消除「mock 全套」压力。 */
export interface PreviewCtx extends PreviewRoot, YsmDecoder, PreviewDebugger, PreviewImageLoader {}

/** 3D 偏好状态（跨模型切换保留） */
let _prefer3D = false;
export function getPrefer3D(): boolean {
  return _prefer3D;
}
export function setPrefer3D(v: boolean): void {
  _prefer3D = v;
}
