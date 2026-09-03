// ===== MMD 内容适配器（ADR-066 P2：富格式前端直引 @moeru/three-mmd）=====
// 本文件只负责 MMD 专属逻辑：经 Go 绑定 ReadFileBytes 取 PMX/PMD 字节 →
// MMDLoader（@moeru/three-mmd，parser 自带，无 babylon 依赖）解析 →
// LoadingManager.setURLModifier 把模型同目录纹理映射为 blob URL（Wails 环境
// 浏览器读不了本地磁盘路径）→ 挂入核心场景 + 灯光 + 包围盒定相机。
// 通用外壳（overlay/renderer/循环/释放）由 mount-preview-core.ts 拥有。

import { dbg } from "../../utils/debug/debug.ts";
import { safeErrorMessage } from "../../utils/safe-error-msg.ts";
import type { PreviewAdapter, PreviewBuildCtx, PreviewScene } from "./mount-preview-core.ts";
import { mdMmDetectFormat, mdMmStage1Input, mdMmStage2LoadingManager } from "./mmd-build-load.ts";
import { mdMmStage3SceneMesh } from "./mmd-build-scene.ts";
import { mdMmParsePmdStage, mdMmParsePmxStage } from "./mmd-build-parse.ts";
import { mdMmStage6Result } from "./mmd-build-result.ts";
import { disposeMmdMesh, mmdDiag } from "./mmd-shared.ts";
import { mdMmStage4Anim } from "./mmd-build-anim.ts";
import { mdMmStage5Menu } from "./mmd-build-menu.ts";
import type { MdMmBuildCtx, MmdAdapterDeps, MmdDataPort, MmdPanelHooks } from "./mmd-types.ts";
// —— 公共面 re-export（ADR-167：消费者零改动：mmd-3d/scene-3d/test 均经此壳）——
export type { MmdDataPort, MmdPanelHooks, MmdMenuItemsOpts, MmdAdapterDeps } from "./mmd-types.ts";
export { mmdMenuItems } from "./mmd-build-menu.ts";
export async function buildMmdScene(
  ctx: PreviewBuildCtx,
  path: string,
  port: MmdDataPort,
  panels?: MmdPanelHooks,
): Promise<PreviewScene> {
  const c = {} as MdMmBuildCtx;
  c.ctx = ctx;
  c.path = path;
  c.port = port;
  c.panels = panels;
  c.stopLongTaskWatch = () => {};
  c.blobUrls = [];
  c.buildSucceeded = false;
  // tStart 下沉：读取阶段计时起点（原 c.tStart 字段），经 stage6Result 传至 stage6bTrace
  const tStart = performance.now();
  try {
    await mdMmStage1Input(c);
    await mdMmStage2LoadingManager(c);
    const fmt = mdMmDetectFormat(c);
    if (fmt === "pmx") await mdMmParsePmxStage(c);
    await mdMmParsePmdStage(c);
    await mdMmStage3SceneMesh(c);
    await mdMmStage4Anim(c);
    const s5 = mdMmStage5Menu(c);
    const result = mdMmStage6Result(c, s5, tStart);
    return result;
  } finally {
    if (!c.buildSucceeded) {
      // 失败路径 = 成功路径的 dispose 逆向（P1 修复，兄弟会话审核发现）
      // stage3 之后抛错时 mesh/geometry/texture 已分配，不 dispose 会泄漏 GPU 资源
      // 每个 dispose 独立 try/catch——单个 dispose 抛错不跳过其余（code review #1 修复）
      try { if (c.mesh) await disposeMmdMesh(c.mesh, mmdDiag, c.port, "dispose-fail"); }
      catch (e) { dbg("mmd", { op: "dispose-fail-path", err: safeErrorMessage(e) }); }
      try { c.mmd?.dispose(); }
      catch (e) { dbg("mmd", { op: "dispose-fail-path", err: safeErrorMessage(e) }); }
      try { c.pmxParser?.dispose?.(); }
      catch (e) { dbg("mmd", { op: "dispose-fail-path", err: safeErrorMessage(e) }); }
      try { c.ktx2Loader?.dispose(); }
      catch (e) { dbg("mmd", { op: "dispose-fail-path", err: safeErrorMessage(e) }); }
      try { c.ktx2CacheLoader?.dispose(); }
      catch (e) { dbg("mmd", { op: "dispose-fail-path", err: safeErrorMessage(e) }); }
      c.stopLongTaskWatch();
      for (const url of c.blobUrls) URL.revokeObjectURL(url);
    }
  }
}
export function makeMmdAdapter(deps: MmdAdapterDeps): PreviewAdapter {
  return {
    id: deps.id ?? "mmd",
    build: async (ctx, path) => buildMmdScene(ctx, path, await deps.dataPort(), deps.panels),
  };
}
