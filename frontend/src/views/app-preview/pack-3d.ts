// ===== pack-3d.ts — MC 资源包模型 3D 预览薄包装（ADR-080，ADR-084 L2）=====
// 内容层在 pack-model-adapter.ts；本文件负责 getApp 注入 Go 绑定 + 公开符号
// （createPack3D / cleanupPack3D / invalidatePackPreview），对齐 vrm-3d/litematic-3d 薄包装模式。
//
// ADR-084 L2：zip 当作虚拟文件夹——ListPackModels 返回的 entries 作为 siblings，
// 首个 entry 作为初始 path。适配器 build(ctx, entryPath) 走 switchTo 语义，
// 由 core switch 面板驱动，不再自建 ◀/▶ 按钮。

import { mount3D, cleanupPreview, invalidatePreview, type Mount3DOptions } from "../../utils/3d/adapters/mount-preview-core.ts";
import { makePackAdapter } from "../../utils/3d/adapters/pack-model-adapter.ts";
import { getApp } from "../../backend/app.ts";
import { withPreviewExtras, registerReRoute } from "./preview-library.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";

// 注册跨类型换角色路由（资源库面板/导航 FAB 选中资源包时派发到此）
registerReRoute(RESOURCE_TYPES.PACK, (path) => createPack3D(path));

/** 经 getApp 注入 Go 绑定（适配器 0 backend import，ADR-072 边界判据） */
function makePackDeps() {
  return {
    readEntry: async (path: string, entry: string): Promise<string> => {
      const App = await getApp();
      const fn = (App as unknown as Record<string, (p: string, e: string) => Promise<string>>).ReadPackEntry;
      return fn ? await fn(path, entry) : "";
    },
  };
}

/** 打开资源包模型 3D 预览（ADR-084 L2：zip 当文件夹，entries 作 siblings） */
export async function createPack3D(path: string, opts?: Mount3DOptions & { startEntry?: string }): Promise<void> {
  const App = await getApp();
  const fn = (App as unknown as Record<string, (p: string) => Promise<string>>)["ListPackModels"];
  const raw = fn ? await fn(path) : "[]";
  let entries: string[] = [];
  try {
    const arr = JSON.parse(raw) as unknown;
    entries = Array.isArray(arr)
      // 与 Go/web 的大小写不敏感清单（packModelEntryMatch / webPackModelEntryMatch）一致：
      // Block/Item 大写目录的包也能被筛中，否则详情页点模型行静默无响应
      ? (arr as string[]).filter((e) => e.toLowerCase().includes("/block/") || e.toLowerCase().includes("/item/"))
      : [];
  } catch {}
  if (entries.length === 0) return;

  // 指定初始 entry（详情页模型清单点击直达；ADR-131 P3），否则首个 entry
  const { startEntry, ...mountOpts } = opts ?? {};
  const initialEntry = startEntry && entries.includes(startEntry) ? startEntry : entries[0]!;
  // 适配器持 zipPath（解析模型文件所需的容器路径）+ 多模型候选（ADR-132：根菜单 select）
  await mount3D(
    makePackAdapter(makePackDeps(), path, { modelEntries: entries }),
    initialEntry,
    withPreviewExtras({ siblings: entries, ...mountOpts }),
  );
}

/** 清理资源包 3D（WebGL renderer + rAF 循环）：组件销毁前调用，防 GPU 资源残留 */
export function cleanupPack3D(): void {
  cleanupPreview();
}

/** 任意新预览派发时调用，作废在途资源包加载 */
export function invalidatePackPreview(): void {
  invalidatePreview();
}