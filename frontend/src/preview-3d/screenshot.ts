// ===== 3D 截图纯函数（ADR-052 P3 通用化）=====
// 从活跃的 Three.js renderer/scene/camera 截图（PNG base64，无 data: 前缀）。
// 纯函数：不依赖模块级状态、不依赖 render-session；任何有 renderer+scene+camera
// 的地方均可调用（共享外壳 / 适配器自建 / renderMultiAngle 自建 renderer）。
//
// 关键约束：
//   - preserveDrawingBuffer: true（否则 canvas 在下一帧被清空，toDataURL 返回空）
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

  const width = opts.width ?? renderer.getSize(new THREE.Vector2()).width;
  const height = opts.height ?? renderer.getSize(new THREE.Vector2()).height;

  try {
    // 切换 preserveDrawingBuffer 确保渲染帧在 toDataURL 时可见
    const preserveBefore = (renderer as unknown as { getPreserveDrawingBuffer?: () => boolean })
      .getPreserveDrawingBuffer?.() ?? false;
    (renderer as unknown as { setPreserveDrawingBuffer: (v: boolean) => void })
      .setPreserveDrawingBuffer(true);

    // 按需覆盖尺寸（仅当调用方显式传入，且与当前不同才需 setSize 以避免刷新 GL 状态）
    const currentSize = renderer.getSize(new THREE.Vector2());
    if (opts.width !== undefined && (Math.abs(opts.width - currentSize.width) > 0.5)) {
      renderer.setSize(opts.width, opts.height ?? opts.width, false);
    }

    renderer.render(scene, camera);
    const fmt = opts.format ?? "image/png";
    const dataUrl = domEl.toDataURL(fmt, opts.quality ?? 0.92);
    // 还原 preserve 状态
    (renderer as unknown as { setPreserveDrawingBuffer: (v: boolean) => void })
      .setPreserveDrawingBuffer(preserveBefore);
    return dataUrl.split(",")[1] ?? null;
  } catch {
    // 异常（上下文丢失、GPU 出错、canvas 不可访问）→ 静默返回 null
    return null;
  }
}