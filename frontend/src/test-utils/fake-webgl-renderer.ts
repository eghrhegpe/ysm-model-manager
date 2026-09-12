// ===== canvas 形态 FakeWebGLRenderer（mount-preview-core 系测试共享）=====
// 为何不复用 setup 层全局 Fake：test-setup.ts §5 的 Fake 用 div 且方法为空实现，
// 满足不了本系测试的两个硬需求——
//   ① 尺寸：射线取景/getSize 依赖 canvas 800×600（getBoundingClientRect 亦然）；
//   ② 断言：setSize/setPixelRatio/render/dispose 需为 vi.fn 供 toHaveBeenCalled 断言。
//
// 用法（vi.mock factory 内；因 factory 被 hoist，不能引用外部变量，故用 dynamic import）：
//   vi.mock("three", async (importOriginal) => {
//     const actual = await importOriginal<typeof import("three")>();
//     const { makeCanvasFakeRenderer } = await import("@/test-utils/fake-webgl-renderer.ts");
//     return { ...actual, WebGLRenderer: makeCanvasFakeRenderer() as unknown as typeof actual.WebGLRenderer };
//   });
import { vi } from "vitest";

/** 可注入的渲染统计（供基于 `renderer.info` 的 GPU 预算门 / 采样器测试驱动）。
 *
 *  背景：本 Fake 原本**没有 `info` 字段** → `sampleGpuLoad` 走 fail-open 读 0 →
 *  `guardGpuBudget` 恒放行 → mount 路径的预算门在测试里**一次都没被触发过**
 *  （刀⑪ 审查 P1-1：新门零覆盖，判反了测试也全绿）。补上 `info` 让门可被驱动。 */
export interface FakeRendererStats {
  /** 上一帧 draw calls */
  calls?: number;
  /** 上一帧三角面数 */
  triangles?: number;
  /** GPU 纹理数 */
  textures?: number;
}

let stats: FakeRendererStats = {};

/** 设置后续 FakeWebGLRenderer 实例的 `info` 统计（用例内 mount 前调）。
 *  默认全 0 —— 既有 mount 测试行为不变（fail-open 全放行）。 */
export function setFakeRendererStats(next: FakeRendererStats): void {
  stats = next;
}

/** 复位为全 0（`afterEach` 调，防跨用例串扰）。 */
export function resetFakeRendererStats(): void {
  stats = {};
}

/** 返回 canvas 形态的 FakeWebGLRenderer 类（每次调用新建，避免跨文件类态泄漏）。 */
export function makeCanvasFakeRenderer() {
  return class FakeWebGLRenderer {
    domElement: HTMLCanvasElement & { getBoundingClientRect?: () => unknown };
    setSize = vi.fn();
    setPixelRatio = vi.fn();
    render = vi.fn();
    dispose = vi.fn();
    getSize = (v: { set: (x: number, y: number) => unknown }): unknown => v.set(800, 600);
    /** 结构对齐 `three.WebGLRenderer.info`（`GpuLoadSample` 读 render.calls/triangles
     *  + memory.textures）。getter 形式：每次读都反映当前注入值。 */
    get info() {
      return {
        render: { calls: stats.calls ?? 0, triangles: stats.triangles ?? 0, frame: 0, points: 0 },
        memory: { geometries: 0, textures: stats.textures ?? 0 },
        programs: [] as unknown[],
        autoReset: true,
        reset: () => {},
      };
    }
    constructor() {
      const el = document.createElement("canvas") as HTMLCanvasElement & {
        getBoundingClientRect?: () => unknown;
      };
      el.width = 800;
      el.height = 600;
      el.getBoundingClientRect = (() => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        x: 0,
        y: 0,
        right: 800,
        bottom: 600,
        toJSON: () => ({}),
      })) as unknown as HTMLCanvasElement["getBoundingClientRect"];
      this.domElement = el;
    }
  };
}
