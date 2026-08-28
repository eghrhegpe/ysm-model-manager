// ===== YSM 3D 薄包装（ADR-066 P3-E + §5.7 path 驱动）：skeleton.ts 经此接入统一外壳 =====
// 把"打开 YSM 3D"收敛为对 mount-preview-core 的一次调用；多纹理切换重建、
// Android 返回键注册/注销、关闭时状态复位由本层 + skeleton 编排层配合完成。
//
// §5.7 shared 化：YSM 适配器改 path 驱动（build(ctx, path) 内经 loadModelData
// 加载 model），与 vrm/litematic 同构——core 的 switchTo(path) 对 ysm 生效，
// 3D 内模型切换无需重建整个会话。
import { mount3D, cleanupPreview, invalidatePreview } from "../../utils/3d/adapters/mount-preview-core.ts";
import { makeYsmAdapter } from "../../utils/3d/adapters/ysm-adapter.ts";
import { getApp } from "../../backend/app.ts";
import type { BedrockGeometry } from "./geometry.ts";
import { preloadModel } from "./model3d-loader.ts";
import { loadModelData } from "./loader.ts";
import { decodeYsmViaWasm } from "./wasm.ts";
import { fillYsmShotPanel, ysmShotNodes, registerYsmModelSchema } from "./ysm-controls.ts";
import { fillMmdPlayPanel } from "./mmd-controls.ts";
import { registerReRoute, withPreviewExtras } from "./preview-library.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";

/** 数据读取注入（视图壳层保留 getApp；适配器 0 backend import，ADR-072 边界判据） */
async function readFileBytes(path: string): Promise<string | null> {
  const App = await getApp();
  return (App as unknown as Record<string, (p: string) => Promise<string | null>>)["ReadFileBytes"](path);
}

/** 同目录文件枚举（.animation.json 扫描用；对齐 VRM 同款 ListAllFilePaths 注入） */
async function listAllFilePaths(dir: string): Promise<string[] | null> {
  const App = await getApp();
  return (App as unknown as Record<string, (d: string) => Promise<string[] | null>>)["ListAllFilePaths"](dir);
}

/** 跨类型换角色路由用：注入轻量 loader ctx（decodeYsmViaWasm + 空 appendDebug） */
async function openYsmFullscreen(path: string): Promise<void> {
  await createYsm3D(path, 0, {
    loader: async (p) =>
      (await loadModelData(p, { decodeYsmViaWasm, appendDebug: () => {} } as never)).model,
  });
}
// 注册跨类型换角色路由（资源库面板/导航 FAB 选中 YSM 时派发到此；未知类型回退入口）
registerReRoute(RESOURCE_TYPES.YSM, openYsmFullscreen);

export interface YsmOpenOptions {
  /** path → model 加载器（skeleton 层注入：loadModelData(p, ctx)，含缓存/WASM/Go 兜底） */
  loader: (path: string) => Promise<BedrockGeometry | null>;
  /** core 关闭（ESC / 关闭按钮 / 切模型 cleanup）时回调：复位调用方状态 + 注销 android-back */
  onClose?: () => void;
  /** 同类型可切换的候选路径列表（≥2 时 core topBar 渲染切换下拉，ADR-066 §5.6） */
  siblings?: string[];
}

/**
 * 打开 YSM 3D 预览（统一外壳 shared 模式，path 驱动）。
 * texIdx 支持多纹理切换重建：适配器经 onTextureChange 回调本层，cleanup 旧会话后按新 texIdx 重挂。
 */
export async function createYsm3D(
  path: string,
  texIdx = 0,
  opts: YsmOpenOptions,
): Promise<void> {
  const rebuild = (idx: number): void => {
    cleanupPreview();
    void createYsm3D(path, idx, opts);
  };
  cleanupPreview();
  await mount3D(
    makeYsmAdapter(path, {
      texIdx,
      loader: opts.loader,
      preload: (model) => preloadModel(model as never),
      onTextureChange: rebuild,
      onClose: opts.onClose,
      listAllFilePaths,
      readTextFile: readFileBytes,
      // 面板填充回调由视图层注入，解除 utils→views 分层违规 R1（ADR 分层契约）
      // [doc:adr-126-p5-收口] YSM model 面板已走 schema-registry（registerModelSchema），
      // fillYsmModelPanel 旧路径删除（死代码）；shot 走 shotNodes 声明式节点
      panels: {
        fillShotPanel: fillYsmShotPanel,
        shotNodes: ysmShotNodes,
        // [doc:adr-126-p5-c] 受控 schema 注册：model 面板内容 = buildYsmModelSchema
        // （组件选择走 ui.activeComponent，切换副作用 = showModelGroup）
        registerModelSchema: registerYsmModelSchema,
      },
      fillPlayPanel: fillMmdPlayPanel,
    }),
    path,
    withPreviewExtras({ siblings: opts.siblings }),
  );
}

/** 关闭活跃 YSM 3D 预览（WebGL renderer + rAF + overlay 全清） */
export function cleanupYsm3D(): void {
  cleanupPreview();
}

/** 作废在途 YSM 3D 加载（切模型前调用，防旧会话迟到渲染覆盖新模型） */
export function invalidateYsmPreview(): void {
  invalidatePreview();
}
