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

/** 返回 canvas 形态的 FakeWebGLRenderer 类（每次调用新建，避免跨文件类态泄漏）。 */
export function makeCanvasFakeRenderer() {
  return class FakeWebGLRenderer {
    domElement: HTMLCanvasElement & { getBoundingClientRect?: () => unknown };
    setSize = vi.fn();
    setPixelRatio = vi.fn();
    render = vi.fn();
    dispose = vi.fn();
    getSize = (v: { set: (x: number, y: number) => unknown }): unknown => v.set(800, 600);
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
