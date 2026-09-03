// ===== MMD 菜单面板填充（ADR-076 v2 Phase 2：底部导航收编进声明式根菜单）=====
// 旧 buildMmdBottomNav / mkNavBtn / slide-menu 弹窗已删除——mmd 专属面板（模型信息+
// 表情 / 材质 / 播放）由 mmd-adapter 经 ctx.menu.setAdapterItems 注入 ⚙️ 根菜单。
// 切换模型归 core 根菜单 roles 项（角色面板内嵌加载入口）；相机归 core camera 项
// （self 模式由 visibleWhen: s["ui.mode"]!=="self" 谓词隐藏，[doc:adr-126-p4-d]）。
// 材质面板 buildMaterialControls 保留复用（纯渲染层，状态经 bridge 下沉 mmd-materials.ts，ADR-072）。

import type { PreviewMenuNode } from "../../preview-3d/menu/node-types.ts";
import { multiModelSelectNode } from "../../preview-3d/menu/multi-model.ts";
import { shotButtonNodes } from "./shot-panel-shared.ts";
import type { CameraControlBridge } from "../../preview-3d/adapters/camera-controls.ts";
export type { CameraControlBridge };
// [S4 层级倒置收敛] 内容层桥契约已下沉 preview-3d/adapters/content-bridges.ts——
// import 供本文件函数签名本地绑定；export type 原位转发保公共面（views 域测试零改动）
import type {
  MmdBottomNavCtx,
  MmdPlayBridge,
  MaterialControlBridge,
} from "../../preview-3d/adapters/content-bridges.ts";
export type { MmdBottomNavCtx, MmdPlayBridge, MaterialControlBridge };

/**
 * [doc:adr-126-p4-b-1] MMD 模型信息面板——声明式节点版（通道验证）。
 * 纯数据：2 行 field（名称 + 骨骼/材质/表情计数），零 DOM。
 * adapter 的 model 面板节点带 `children: mmdModelInfoNodes(ctx)` → 渲染走 renderMenu（preview-menu/render.ts）。
 * （fillMmdModelPanel 命令式旧轨已于 2026-09-03 随 G3 收口删除——生产装配零调用点）
 */
export function mmdModelInfoNodes(ctx: MmdBottomNavCtx): PreviewMenuNode[] {
  const pmx = ctx.mmd.pmx;
  const nodes: PreviewMenuNode[] = [];
  // [doc:adr-132] zip 多 pmx：模型选择 select（统一原语 multiModelSelectNode，ADR-132）。
  // 候选 = zipModelCandidates（虚拟路径，mmd-adapter.ts:392 暴露）；get 保持 basename 匹配
  // 语义（modelName = 虚拟路径 basename）；set → switchTo(虚拟路径) 重建内容层。
  const candidates = (ctx.zipModelCandidates ?? []).map((p) => ({
    id: p,
    label: p.split(/[/\\]/).pop() || p,
  }));
  const select = multiModelSelectNode({
    entries: candidates,
    nodeId: "mmd-model-select",
    activeId: (): string =>
      candidates.find((c) => c.label === ctx.modelName)?.id ?? candidates[0]?.id ?? "",
    onSelect: (id: string): void => {
      if (ctx.switchTo && id) void ctx.switchTo(id);
    },
  });
  if (select) nodes.push(select);
  nodes.push(
    { id: "mmd-model-name", kind: "field", labelKey: "preview.nameLabel", fallback: "名称", value: ctx.modelName },
    {
      id: "mmd-model-overview",
      kind: "field",
      labelKey: "preview.modelOverview",
      fallback: "模型",
      value: `${pmx.bones.length} 骨骼 · ${pmx.materials.length} 材质 · ${pmx.morphs.length} 表情`,
    },
  );
  return nodes;
}

/**
 * [doc:adr-126-p5-收尾] MMD 播放/动作面板——声明式节点版。
 * 播放/暂停 = toggle（get 读 isPlaying，set 调 toggle，rmAppendToggle 点击即时反馈）；
 * 动作切换 = select（闭包 get/set 读写 bridge，非状态层路径）；空态 = field 提示 + button 重新扫描；
 * animDir = field 路径提示。fillMmdPlayPanel（命令式）已删除。
 */
export function playNodes(bridge: MmdPlayBridge): PreviewMenuNode[] {
  // 空态：无动作文件 → 引导提示 + 重新扫描（requestReload）
  if (bridge.clips.length === 0) {
    const hint = bridge.animDir
      ? `动作库目录：${bridge.animDir}（暂无 VMD/VPD 文件，请将动作文件放入此目录）`
      : "当前模型无内置动作。请将 VMD/VPD 动作放入仓库的 CustomAnim 子目录。";
    const nodes: PreviewMenuNode[] = [
      // [doc:adr-126-p5] play-empty 提示文本必须进 value（rmAppendField 渲染 value，不读
      // fallback——9a65f796 review P2：此前塞 fallback 导致空态引导完全丢失）
      { id: "play-empty", kind: "field" as const, labelKey: "preview.playEmpty", fallback: hint, value: hint },
    ];
    if (bridge.requestReload) {
      nodes.push({
        id: "play-reload",
        kind: "button" as const,
        labelKey: "preview.playReload",
        fallback: "重新扫描",
        action: (): void => {
          bridge.requestReload?.();
        },
      });
    }
    return nodes;
  }
  // 正常态：播放/暂停 toggle + 动作 select（多动作时）+ animDir 提示
  const nodes: PreviewMenuNode[] = [
    {
      id: "play-toggle",
      kind: "toggle" as const,
      labelKey: "preview.mmdPlay",
      fallback: "播放",
      control: {
        get: (): boolean => bridge.isPlaying(),
        set: (): void => {
          bridge.toggle();
        },
      },
    },
  ];
  if (bridge.clips.length > 1) {
    nodes.push({
      id: "play-select",
      kind: "select" as const,
      labelKey: "preview.mmdMotion",
      fallback: "动作",
      control: {
        options: bridge.clips.map((c, i) => ({ value: String(i), label: c.label })),
        get: (): string => String(bridge.currentIndex()),
        set: (v: unknown): void => {
          bridge.select(Number(v) || 0);
        },
      },
    });
  }
  if (bridge.animDir) {
    nodes.push({
      id: "play-dir",
      kind: "field" as const,
      fallback: `动作库: ${bridge.animDir}`,
      value: `动作库: ${bridge.animDir}`, // [doc:adr-126-p5] rmAppendField 渲染 value 不读 fallback
    });
  }
  return nodes;
}

/**
 * [doc:adr-126-p4-b-2] MMD 截图面板——声明式节点版。
 * 共享逻辑在 shot-panel-shared.ts（SHOT_KEYS/SHOT_LABELS/makeShotAction/shotButtonNodes），
 * 此处只做 MMD 前缀 id 包装（`mmd-shot-*`）+ 能力缺失守卫（screenshotFn null → []）。
 * （fillMmdShotPanel 命令式旧轨已于 2026-09-03 随 G3 收口删除——生产装配零调用点）
 */
export function mmdShotNodes(
  ctx: MmdBottomNavCtx,
  screenshotFn: (() => Promise<string | null>) | null,
): PreviewMenuNode[] {
  if (!screenshotFn) return [];
  return shotButtonNodes(
    { boneCount: 0, cubeCount: 0, texWidth: 0, texHeight: 0, bones: [], texture: "", ...(ctx.modelPath !== undefined ? { _modelPath: ctx.modelPath } : {}) },
    screenshotFn,
  ).map((n) => ({ ...n, id: `mmd-${n.id}` }));
}
