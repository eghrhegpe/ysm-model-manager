// ===== empty-3d.ts — 空场景 3D 全屏入口 =====
// ADR-066 P3：复用 mount-preview-core 统一外壳（renderer/scene/camera/controls/rAF）。
// 无 path → 无内容层适配器（不进 build）；core 仍完整初始化 overlay + renderer + rAF，
// 用户进 3D 后可通过 ⚙️ 根菜单资源库选模型加载（openModel3DFullscreen 路径）。
//
// 用途：nav-viewer-fab 在「无上次选中模型」时降级为开空场景，而非弹 toast 让用户
// 去文件树找模型——降低首次使用门槛。
import { mount3D, cleanupPreview, invalidatePreview, type PreviewAdapter } from "../../features/preview-3d/adapters/mount-preview-core.ts";
import { withPreviewExtras } from "./preview-library.ts";

/** 空适配器：build 直接 resolve 空 scene，core 渲染空白场景 + 环境光/天空/地面 */
const emptyAdapter: PreviewAdapter = {
  id: "empty",
  build: async (ctx) => {
    // 不向 scene 添加任何对象——core 已有 skyCap/groundCap/lightCap，直接呈现环境
    ctx.loadingEl.remove();
    return {
      dispose: () => {},
      resetCamera: () => {
        if (ctx.camera && ctx.controls) {
          ctx.camera.position.set(0, 5, 10);
          ctx.camera.lookAt(0, 0, 0);
          ctx.controls.target.set(0, 0, 0);
          ctx.controls.update();
        }
      },
    };
  },
};

/**
 * 打开空场景 3D 全屏预览（无需 path）。
 * 渲染空白场景（天空+地面+灯光），用户可通过 3D 内资源库选模型加载内容。
 */
export async function openEmpty3DFullscreen(): Promise<void> {
  await mount3D(emptyAdapter, "", withPreviewExtras({}));
}

/** 清理空场景 3D（WebGL renderer + rAF 循环） */
export function cleanupEmpty3D(): void {
  cleanupPreview();
}

/** 作废在途空场景加载 */
export function invalidateEmptyPreview(): void {
  invalidatePreview();
}
