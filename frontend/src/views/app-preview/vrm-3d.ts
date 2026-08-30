// ===== VRM 3D 预览（ADR-066 P1：富格式前端直引 three-vrm）=====
// ADR-066 P3：脚手架已收缴进 mount-preview-core.ts，内容层抽到 vrm-adapter.ts。
// 本文件仅作兼容薄包装，保留 createVrm3D / cleanupVrm3D / invalidateVrmPreview
// 公开符号，index.ts 与既有测试无需改动。

import { mount3D, cleanupPreview, invalidatePreview, switchPreview, type PreviewAdapter, type Mount3DOptions } from "../../features/preview-3d/adapters/mount-preview-core.ts";
import { buildVrmScene, type VrmPanelHooks } from "../../features/preview-3d/adapters/vrm-adapter.ts";
import { getApp } from "../../backend/app.ts";
import { vrmModelInfoNodes, vrmShotNodes } from "./vrm-controls.ts";
import { playNodes } from "./mmd-controls.ts";
import { withPreviewExtras, registerReRoute, openModel3DFullscreen } from "./preview-library.ts";
import { readFileBytes } from "./view-shell.ts";

// 注册跨类型换角色路由（ADR-111：按 variants preview key 路由，.vrm→"vrm"）
registerReRoute("vrm", (path) => createVrm3D(path));

/** 同目录文件枚举（VRMA 动作扫描用；对齐 MMD 同款 ListAllFilePaths 注入） */
async function listAllFilePaths(dir: string): Promise<string[] | null> {
  const App = await getApp();
  return await App.ListAllFilePaths(dir);
}

/** ADR-072 诊断端口：环形日志面板写入（当前 no-op，后续通过 bus 或 port 注入） */
async function addOpLog(op: string, msg: string, status: "ok" | "fail" | "warn", err?: string): Promise<void> {
  // TODO: 接入真实环形日志面板
}

const vrmPanelHooks: VrmPanelHooks = {
  // [doc:adr-126-p4-b-1] model 面板走 children 声明式（对齐 MMD）；此前 makeModelPanelRenderer
  // 从未注入（no-op 空面板），迁 children 顺带补上模型信息内容
  modelInfoNodes: vrmModelInfoNodes,
  // shot 面板同（此前 makeShotPanelRenderer 从未注入）；复用 shot-panel-shared 六角度
  shotNodes: vrmShotNodes,
  // [doc:adr-126-p5-收尾] play 面板声明式化：复用 MMD playNodes（views→views 合法；R1 合规）
  playNodes,
};

const vrmAdapter: PreviewAdapter = {
  id: "vrm",
  build: (ctx, path) => buildVrmScene(ctx, path, { addOpLog }, readFileBytes, vrmPanelHooks, listAllFilePaths),
};

/** 打开 VRM 3D 预览（.vrm 直引 three-vrm）；siblings 提供同类型候选以渲染 topBar 切换下拉 */
export async function createVrm3D(path: string, opts?: Mount3DOptions): Promise<void> {
  await mount3D(vrmAdapter, path, withPreviewExtras(opts ?? {}));
}

/** 当前 VRM 会话内切换模型（复用外壳重建内容层，不重建 renderer；ADR-066 §5.6） */
async function switchVrmPreview(path: string): Promise<void> {
  await switchPreview(path);
}

/** 同台追加 VRM 模型：经统一路由主门收口（cooperate → keepInScene 追加，ADR-093 T4） */
async function appendVrmPreview(path: string): Promise<void> {
  await openModel3DFullscreen(path, { cooperate: true });
}

/** 清理 VRM 3D（WebGL renderer + rAF 循环）：组件销毁/再次创建前调用，防 GPU 资源残留 */
export function cleanupVrm3D(): void {
  cleanupPreview();
}

/** 任意新预览派发时调用，作废在途 VRM 加载 */
export function invalidateVrmPreview(): void {
  invalidatePreview();
}
