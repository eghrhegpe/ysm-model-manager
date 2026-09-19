// ===== 预览模块共享工具函数 =====
// 从 index.ts 拆分：模块级函数和状态
// ADR-137 第五刀拆分：纯领域部分（DecodedYsm / stripYsgpTextHeader / devLog）
// 已归位 preview-3d/decoder/utils.ts——本文件只留视图接口与状态。

import type { LoadGuard } from "@/utils/async/load-guard.ts";

/** 预览上下文（index.ts AppPreview 类实现的接口，子模块以最小面引用） */
/** 渲染容器 + 生命周期（detail/litematic-meta/skeleton 消费 root，skeleton 消费 unsubs） */
export interface PreviewRoot {
  root: ShadowRoot;
  /** 组件销毁清理收集（可选：子模块可挂 window/document 监听清理函数） */
  unsubs?: Array<() => void>;
  /** P3 修复：2D 拖拽的 AbortController，避免模块级单例在多实例场景下的竞态风险 */
  dragAbortCtrl: AbortController | null;
  /**
   * 当前活跃 3D overlay 的关闭钩子（原模块级 _active3DClose，P1 迁移至实例）。
   * 3D overlay 挂 document.body，不随预览面板 shadow DOM 重建消失——后台 model:select
   * 在 3D 打开期间触发时，切换模型前先经 closeActive3DOverlay 关掉旧全屏层，防双全屏叠加。
   * 关闭时保留 _prefer3D（切模型保持 3D 预览），仅清理 DOM 与 WebGL 资源。
   */
  active3DClose: (() => void) | null;
}

/** WASM 解码能力（loader/skeleton 消费） */
export interface YsmDecoder {
  decodeYsmViaWasm(
    path: string,
  ): Promise<import("@/preview-3d/decoder/utils.ts").DecodedYsm | null>;
}

/** 调试输出能力（loader/skeleton 消费） */
export interface PreviewDebugger {
  appendDebug(container: HTMLElement | null, msg: string): void;
}

/** 预览图加载能力（detail 消费） */
export interface PreviewImageLoader {
  loadPreviewImage(path: string): Promise<string | null>;
}

/** 3D 偏好状态（实例级，跨模型切换保留） */
export interface Prefer3DState {
  /** 读取 3D 偏好状态 */
  getPrefer3D(): boolean;
  /** 设置 3D 偏好状态 */
  setPrefer3D(v: boolean): void;
}

/** 详情代际守卫（实例级，多实例隔离防串扰） */
export interface DetailGenGuard {
  detailGen: LoadGuard;
}

/** 组合接口：实现方（AppPreview）与兼容旧调用方的完整视图。
 * 消费方按需收窄参数到小接口（见 detail/litematic-meta/loader/skeleton），
 * 测试 mock 只需提供被测字段，消除「mock 全套」压力。 */
export interface PreviewCtx
  extends PreviewRoot,
    YsmDecoder,
    PreviewDebugger,
    PreviewImageLoader,
    Prefer3DState,
    DetailGenGuard {}

/**
 * 路由层上下文：preview-router.ts 消费的最小面接口。
 * 包含渲染容器 + 预览守卫（代际校验）+ 类型元数据懒加载缓存，
 * 使路由纯函数脱离 AppPreview 类实例独立可测。
 * 注：PREVIEW_HANDLERS 的 show 函数签名要求 PreviewCtx（含 detailGen），
 * 调用方需将 ctx as unknown as PreviewCtx 转型（AppPreview 实例运行时满足）。
 */
export interface PreviewRouterCtx {
  root: ShadowRoot;
  /** 预览代际守卫：快速点 A→B 时丢弃过期加载的渲染，防并发覆盖 */
  previewGuard: LoadGuard;
}
