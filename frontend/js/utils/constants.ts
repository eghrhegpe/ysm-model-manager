// ===== 全局常量（类型化版 — ADR-014 P2）=====

/** 骨骼预览 Canvas 尺寸 */
export const PREVIEW_CANVAS_SIZE: number = 180;
export const FULL_PREVIEW_CANVAS_SIZE: number = 600;

/** 纹理尺寸默认值 */
export const DEFAULT_TEX_SIZE: number = 64;

/** 骨骼名标注最大文本宽度阈值 */
export const LABEL_MAX_WIDTH: number = 80;

/** 缩放范围 */
export const ZOOM_MIN: number = 0.2;
export const ZOOM_MAX: number = 10;
export const ZOOM_STEP: number = 0.2;
export const ZOOM_STEP_WHEEL: number = 0.3;

/** 旋转增量（度/像素拖拽） */
export const ROTATION_PER_PX: number = 0.5;

/** 预览缩略图尺寸 */
export const MINI_MAP_SIZE: number = 60;

/** 日志最大显示条数 */
export const MAX_LOG_ITEMS: number = 500;

/** 下载队列 */
export const STUCK_GUARD_DELAY: number = 2000;
export const COMPLETE_TIMEOUT: number = 3000;

/** 数字跳动动画 */
export const ANIMATE_MAX_STEPS: number = 20;
export const ANIMATE_INTERVAL_MS: number = 30;
