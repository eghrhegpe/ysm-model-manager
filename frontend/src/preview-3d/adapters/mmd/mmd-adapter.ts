// ===== MMD 内容适配器（ADR-066 P2：富格式前端直引 @moeru/three-mmd）=====
// 本文件只负责 MMD 专属逻辑：经 Go 绑定 ReadFileBytes 取 PMX/PMD 字节 →
// MMDLoader（@moeru/three-mmd，parser 自带，无 babylon 依赖）解析 →
// LoadingManager.setURLModifier 把模型同目录纹理映射为 blob URL（Wails 环境
// 浏览器读不了本地磁盘路径）→ 挂入核心场景 + 灯光 + 包围盒定相机。
// 通用外壳（overlay/renderer/循环/释放）由 mount-preview-core.ts 拥有。

import type {
  PreviewAdapter,
  PreviewBuildCtx,
  PreviewScene,
} from "@/preview-3d/adapters/mount-preview-core.ts";
import { safeErrorMessage } from "@/utils/base/pure/safe-error-msg.ts";
import { dbg } from "@/utils/debug/debug.ts";
import { Stage4Anim } from "./mmd-build-anim.ts";
import { DetectFormat, Stage1Input, Stage2LoadingManager } from "./mmd-build-load.ts";
import { Stage5Menu } from "./mmd-build-menu.ts";
import { ParsePmdStage, ParsePmxStage } from "./mmd-build-parse.ts";
import { Stage6Result } from "./mmd-build-result.ts";
import { Stage3SceneMesh } from "./mmd-build-scene.ts";
import type { BuildCtx, MmdAdapterDeps, MmdDataPort, MmdPanelHooks } from "./mmd-types.ts";

export { mmdMenuItems } from "./mmd-build-menu.ts";
// —— 公共面 re-export（ADR-167：消费者零改动：mmd-3d/scene-3d/test 均经此壳）——
export type { MmdAdapterDeps, MmdDataPort, MmdMenuItemsOpts, MmdPanelHooks } from "./mmd-types.ts";
export async function buildMmdScene(
  ctx: PreviewBuildCtx,
  path: string,
  port: MmdDataPort,
  panels?: MmdPanelHooks,
): Promise<PreviewScene> {
  const c = {} as BuildCtx;
  c.ctx = ctx;
  c.path = path;
  c.port = port;
  c.panels = panels;
  c.stopLongTaskWatch = () => {};
  c.blobUrls = [];
  c.alloc = []; // 失败释放注册表（stage 分配点 TrackAlloc 登记；finally 统一遍历）
  c.buildSucceeded = false;
  // tStart 下沉：读取阶段计时起点（原 c.tStart 字段），经 stage6Result 传至 stage6bTrace
  const tStart = performance.now();
  try {
    await Stage1Input(c);
    await Stage2LoadingManager(c);
    const fmt = DetectFormat(c);
    if (fmt === "pmx") await ParsePmxStage(c);
    await ParsePmdStage(c);
    await Stage3SceneMesh(c);
    await Stage4Anim(c);
    const s5 = Stage5Menu(c);
    const result = Stage6Result(c, s5, tStart);
    return result;
  } finally {
    if (!c.buildSucceeded) {
      // 失败路径 = 已分配资源注册表统一释放（2026-09-03 取代手工枚举 mesh/mmd/parser/loader
      // 逐个 try/catch——新增 stage 资源字段必忘加一行 → 静默泄漏。各分配点已登记 c.alloc，
      // 此处顺序遍历；单条 free 抛错不跳过其余（code review #1 语义保留）。
      for (const a of c.alloc) {
        try {
          await a.free();
        } catch (e) {
          dbg("mmd", { op: "dispose-fail-path", name: a.name, err: safeErrorMessage(e) });
        }
      }
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
