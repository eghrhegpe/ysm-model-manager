// ===== pack-3d.ts — MC 资源包模型 3D 预览薄包装（ADR-080，ADR-084 L2）=====
// 内容层在 pack-model-adapter.ts；本文件负责 getApp 注入 Go 绑定 + 公开符号
// （createPack3D / cleanupPack3D / invalidatePackPreview），对齐 vrm-3d/litematic-3d 薄包装模式。
//
// ADR-084 L2：zip 当作虚拟文件夹——ListPackModels 返回的 entries 作为 siblings，
// 首个 entry 作为初始 path。适配器 build(ctx, entryPath) 走 switchTo 语义，
// 由 core switch 面板驱动，不再自建 ◀/▶ 按钮。

import { mount3D, cleanupPreview, invalidatePreview, type Mount3DOptions } from "../../preview-3d/adapters/mount-preview-core.ts";
import { makePackAdapter } from "../../preview-3d/adapters/pack-model-adapter.ts";
import { getApp } from "../../backend/app.ts";
import { withPreviewExtras, registerReRoute } from "./preview-library.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";

// 注册跨类型换角色路由（资源库面板/导航 FAB 选中资源包时派发到此）
registerReRoute(RESOURCE_TYPES.PACK, (path) => createPack3D(path));

/** 经 getApp 注入 Go 绑定（适配器 0 backend import，ADR-072 边界判据） */
function makePackDeps() {
  return {
    // ADR-143 P2：ReadPackEntry 统一 []byte（Wails 转 base64），失败返回 null
    readEntry: async (path: string, entry: string): Promise<string | null> => {
      const App = await getApp();
      // 类型化直调；仅「绑定缺失」回退空串（审查 P3：原 fn? 守卫只覆盖缺绑定，
      // 真实 Go 读取错误必须继续传播给调用方，不能 catch-all 吞掉）
      if (typeof App.ReadPackEntry !== "function") return "";
      return await App.ReadPackEntry(path, entry);
    },
  };
}

/** 打开资源包模型 3D 预览（ADR-084 L2：zip 当文件夹，entries 作 siblings） */
export async function createPack3D(path: string, opts?: Mount3DOptions & { startEntry?: string }): Promise<void> {
  let App: Awaited<ReturnType<typeof getApp>> | null = null;
  try {
    App = await getApp();
  } catch {
    App = null; // 桥不可用（browser 模式）→ 空清单
  }
  // 类型化直调；仅「绑定缺失」回退空数组（审查 P3：真实 ListPackModels 错误仍传播，
  // 调用方有 .catch("[preview] pack3D:") 记录；不能 catch-all 吞掉导致无预览无诊断）
  let arr: string[] | null = App && typeof App.ListPackModels === "function" ? await App.ListPackModels(path) : [];
  // 与 Go/web 的大小写不敏感清单（packModelEntryMatch / webPackModelEntryMatch）一致：
  // Block/Item 大写目录的包也能被筛中，否则详情页点模型行静默无响应
  const entries = (arr ?? []).filter((e) => e.toLowerCase().includes("/block/") || e.toLowerCase().includes("/item/"));
  if (entries.length === 0) return;

  // 指定初始 entry（详情页模型清单点击直达；ADR-131 P3），否则首个 entry
  const { startEntry, ...mountOpts } = opts ?? {};
  const initialEntry = startEntry && entries.includes(startEntry) ? startEntry : entries[0]!;
  // [ADR-159] 容器语义：包 = 实体（displayName = zip 名剥扩展名），包内模型 = 组件
  // （components = 全部 entry）。角色面板据 components 平铺组件区（点名切换 / ➕追加），
  // 不再需要 ADR-131/132 时代的 packModelsByType 候选源补丁（已退役）。
  const displayName = path.split(/[/\\]/).pop()?.replace(/\.zip$/i, "") || path;
  const extras = withPreviewExtras({ siblings: entries, displayName, components: entries, ...mountOpts });
  await mount3D(
    makePackAdapter(makePackDeps(), path, { modelEntries: entries }),
    initialEntry,
    extras,
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