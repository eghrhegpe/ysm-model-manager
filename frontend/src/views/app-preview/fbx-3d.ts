// ===== FBX 3D 预览（ADR-112：独立 FBX 预览地基）====
// 内容层在 fbx-adapter.ts；本文件仅作兼容薄包装，导出 createFbx3D。
// 清理/作废不设独立派发：mount-preview-core 的共享 cleanupPreview/invalidatePreview
// 由 index.ts 经 vrm/mmd 等 cleanup 派发全量覆盖 _handles，FBX 复用同一单例即可。

import { mount3D, type PreviewAdapter, type Mount3DOptions } from "../../features/preview-3d/adapters/mount-preview-core.ts";
import { buildFbxScene, type FbxDataPort } from "../../features/preview-3d/adapters/fbx-adapter.ts";
import { withPreviewExtras, registerReRoute } from "./preview-library.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { readFileBytes, addOpLog } from "./view-shell.ts";

// 注册跨类型换角色路由（资源库面板/导航 FAB 选中 FBX 时派发到此）
registerReRoute(RESOURCE_TYPES.FBX, (path) => createFbx3D(path));

const fbxPort: FbxDataPort = {
  readFileBytes,
  addOpLog: (op, msg, status, err) => addOpLog("fbx-preview", op, msg, status, err),
};

const fbxAdapter: PreviewAdapter = {
  id: "fbx",
  build: (ctx, path) => buildFbxScene(ctx, path, fbxPort),
};

/** 打开 FBX 3D 预览（独立资产：模型 + 内嵌动画）；siblings 透传同类型候选（ADR-066 §5.6） */
export async function createFbx3D(path: string, opts?: Mount3DOptions): Promise<void> {
  await mount3D(fbxAdapter, path, withPreviewExtras(opts ?? {}));
}
