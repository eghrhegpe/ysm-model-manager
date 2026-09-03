// ===== 3D 截图纯函数（ADR-052 P3 通用化）=====
// 从活跃的 Three.js renderer/scene/camera 截图（PNG base64，无 data: 前缀）。
// 纯函数：不依赖模块级状态、不依赖 render-session；任何有 renderer+scene+camera
// 的地方均可调用（共享外壳 / 适配器自建 / renderMultiAngle 自建 renderer）。
//
// 关键约束：
//   - render(scene, camera) 后须在同一同步任务内 toDataURL——canvas 缓冲在
//     下一帧/await 后被清空，preserveDrawingBuffer 在 r185 已不可运行时切换
//     （P0 修复：getPreserveDrawingBuffer/setPreserveDrawingBuffer 是幽灵 API）
//   - 调用前后 renderer 尺寸可能变化 → 用 render(target, camera) 后再 toDataURL
//   - 空场景（未渲染过、canvas 未就绪）→ 返回 null，不抛
import * as THREE from "three";

/** 截图选项 */
export interface ScreenshotOpts {
  /** 宽高（默认取 renderer 当前 size） */
  width?: number;
  height?: number;
  /** 输出格式（默认 "image/png"） */
  format?: "image/png" | "image/jpeg";
  /** JPEG 质量 [0, 1]，仅 format=image/jpeg 生效 */
  quality?: number;
}

/**
 * 从活跃的 renderer/scene/camera 截图，返回 PNG/JPEG base64（无 data: 前缀）。
 * 无 renderer / 未就绪 / 空 canvas → 返回 null。
 *
 * 调用方须保证：本函数返回前不让出事件循环（无 await / no setTimeout）——
 * renderer.render() 写入 canvas 后，toDataURL 须在同一帧同步读取。
 */
export function screenshotFromRenderer(
  renderer: THREE.WebGLRenderer | null | undefined,
  scene: THREE.Scene | null | undefined,
  camera: THREE.PerspectiveCamera | null | undefined,
  opts: ScreenshotOpts = {},
): string | null {
  if (!renderer || !scene || !camera) return null;
  const domEl = renderer.domElement;
  if (!domEl) return null;
  if (domEl.width <= 0 || domEl.height <= 0) return null;

  // render → toDataURL 须同步连续调用，canvas 缓冲在下一帧被清空。
  // preserveDrawingBuffer 在 r185 已不可运行时切换（幽灵 API，P0 修复）。
  try {
    // 按需覆盖尺寸（仅当调用方显式传入，且与当前不同才需 setSize 以避免刷新 GL 状态）
    const currentSize = renderer.getSize(new THREE.Vector2());
    const w = opts.width;
    if (w !== undefined && Math.abs(w - currentSize.width) > 0.5) {
      renderer.setSize(w, opts.height ?? w, false);
    }

    renderer.render(scene, camera);
    const fmt = opts.format ?? "image/png";
    const dataUrl = domEl.toDataURL(fmt, opts.quality ?? 0.92);
    return dataUrl.split(",")[1] ?? null;
  } catch {
    // 异常（上下文丢失、GPU 出错、canvas 不可访问）→ 静默返回 null
    return null;
  }
}