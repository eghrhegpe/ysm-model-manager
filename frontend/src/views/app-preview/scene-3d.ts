// ===== 场景 MMD 3D 预览（独立入口，与角色 MMD 完全隔离）=====
// 与 mmd-3d.ts 的区别：
// - adapter.id = "mmd-scene"（独立预设：场景模型的天空/光照/阴影预设）
// - siblings 由 scene-siblings.ts 提供（只扫 SceneModel 目录）
// - 注册独立路由 "mmd-scene"，不与 "EntityPlayer" 混用
//
// 内容层复用 buildMmdScene（mmd-adapter.ts），确保 PMX 解析/纹理绑定逻辑一致。

import { mount3D, cleanupPreview, invalidatePreview, type PreviewAdapter, type Mount3DOptions } from "../../preview-3d/adapters/mount-preview-core.ts";
import { buildMmdScene, type MmdPanelHooks } from "../../preview-3d/adapters/mmd-adapter.ts";
import { makeMmdDataPort } from "./mmd-data-port.ts";
import { fillMmdModelPanel, fillMmdShotPanel, mmdModelInfoNodes, mmdShotNodes, playNodes } from "./mmd-controls.ts";
import { registerReRoute, withPreviewExtras } from "./preview-library.ts";

// 注册跨类型换角色路由（ADR-111：按 variants preview key 路由，SceneModel .pmx/.pmd→"mmd-scene"）
registerReRoute("mmd-scene", (path) => createScene3D(path));

const scenePanelHooks: MmdPanelHooks = {
  fillModelPanel: fillMmdModelPanel,
  fillShotPanel: fillMmdShotPanel,
  modelInfoNodes: mmdModelInfoNodes,
  shotNodes: mmdShotNodes,
  playNodes,
};

/** 场景适配器：id = "mmd-scene"，驱动场景专属预设（天空/光照/阴影） */
const sceneAdapter: PreviewAdapter = {
  id: "mmd-scene",
  build: async (ctx, path) => buildMmdScene(ctx, path, await makeMmdDataPort("mmd-scene-preview"), scenePanelHooks),
};

/** 打开场景 MMD 3D 预览（独立入口，只加载 SceneModel 目录下的 PMX/PMD） */
export async function createScene3D(path: string, opts?: Mount3DOptions): Promise<void> {
  await mount3D(sceneAdapter, path, withPreviewExtras({ ...(opts ?? {}), rtype: "mmd-scene" }));
}

/** 清理场景 3D（WebGL renderer + rAF 循环） */
export function cleanupScene3D(): void {
  cleanupPreview();
}

/** 任意新预览派发时调用，作废在途场景加载 */
export function invalidateScenePreview(): void {
  invalidatePreview();
}
