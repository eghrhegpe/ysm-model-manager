// ===== MMD 3D 预览（ADR-066 P2：富格式前端直引 @moeru/three-mmd）=====
// 内容层在 mmd-adapter.ts；本文件仅作兼容薄包装，保留 createMmd3D / cleanupMmd3D /
// invalidateMmdPreview 公开符号，index.ts 分发对齐 vrm-3d.ts 模式。

import { mount3D, cleanupPreview, invalidatePreview, type PreviewAdapter, type Mount3DOptions } from "../../preview-3d/adapters/mount-preview-core.ts";
import { buildMmdScene, type MmdPanelHooks } from "../../preview-3d/adapters/mmd-adapter.ts";
import { makeMmdDataPort } from "./mmd-data-port.ts";
import { fillMmdModelPanel, fillMmdShotPanel, mmdModelInfoNodes, mmdShotNodes, playNodes } from "./mmd-controls.ts";
import { registerReRoute, withPreviewExtras, openModel3DFullscreen } from "./preview-library.ts";

// 注册跨类型换角色路由（ADR-111：按 variants preview key 路由，.pmx/.pmd→"mmd"）
registerReRoute("mmd", (path) => createMmd3D(path));

const mmdPanelHooks: MmdPanelHooks = {
  fillModelPanel: fillMmdModelPanel,
  fillShotPanel: fillMmdShotPanel,
  modelInfoNodes: mmdModelInfoNodes,
  shotNodes: mmdShotNodes,
  playNodes,
};

const mmdAdapter: PreviewAdapter = {
  id: "mmd",
  build: async (ctx, path) => buildMmdScene(ctx, path, await makeMmdDataPort("mmd-preview"), mmdPanelHooks),
};

/** 打开 MMD 3D 预览（.pmx/.pmd 直引 @moeru/three-mmd）；siblings 提供同类型候选以渲染 topBar 切换下拉（ADR-066 §5.6） */
export async function createMmd3D(path: string, opts?: Mount3DOptions): Promise<void> {
  await mount3D(mmdAdapter, path, withPreviewExtras(opts ?? {}));
}

/** 清理 MMD 3D（WebGL renderer + rAF 循环）：组件销毁/再次创建前调用，防 GPU 资源残留 */
export function cleanupMmd3D(): void {
  cleanupPreview();
}

/** 同台追加 MMD 模型：经统一路由主门收口（cooperate → keepInScene 追加，ADR-093 T4） */
export async function appendMmdPreview(path: string): Promise<void> {
  await openModel3DFullscreen(path, { cooperate: true });
}

/** 任意新预览派发时调用，作废在途 MMD 加载 */
export function invalidateMmdPreview(): void {
  invalidatePreview();
}
