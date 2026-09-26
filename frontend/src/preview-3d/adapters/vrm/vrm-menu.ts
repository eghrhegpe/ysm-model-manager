// ===== [ADR-076 v2 / ADR-315 D2③] VRM 声明式菜单节点工厂（自 vrm-adapter.ts 拆出真缝）=====
// 🦴 骨骼 + 🎨 材质 + 模型信息 + 截图 + 动作播放 + 感知层 + VMD 位移缩放校准。
// 提取为可导出表：适配器与测试共用同一份真实数组（对齐 MikuMikuAR），加菜单项只改这里。
// 根项白名单：只出 panel/action/divider（控件类节点挂对应面板 children）。

import { t } from "@/core/i18n/t.ts";
import type { AddOpLog } from "@/preview-3d/adapters/shared/data-port.ts";
import type { BoneTree } from "@/preview-3d/bone/bone-tools.ts";
import type { MmdPlayBridge } from "@/preview-3d/infra/content-bridges.ts";
import type {
  getVrmMaterialDetail,
  listVrmMaterials,
} from "@/preview-3d/materials/vrm-materials.ts";
import type { BonePanelCleanupRef } from "@/preview-3d/menu/panels/bones-panel-node.ts";
import { makeBonesPanelItem } from "@/preview-3d/menu/panels/bones-panel-node.ts"; // 通用骨骼菜单项工厂（4 adapter 共用，ADR-074 S2 之上）
import { materialNodes } from "@/preview-3d/menu/panels/material-controls.ts";
import {
  type PerceptionCapability,
  type PerceptionState,
  perceptionNodes,
} from "@/preview-3d/menu/panels/perception-controls.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/node-types.ts";

/** VRM 数据端口（视图壳注入，适配器 0 backend import——ADR-072 边界判据；
 *  addOpLog 签名引用共享 data-port 类型，2026-09-14 收敛逐字重复） */
export interface VrmDataPort {
  addOpLog: AddOpLog;
}

/** VRM 模型信息（model 面板声明式节点数据源；对齐 MMD MmdBottomNavCtx 注入链） */
export interface VrmModelInfoCtx {
  modelName: string;
  boneCount: number;
  materialCount: number;
  /** VRM meta 文本摘要（vrm.meta 归一化；缺失/无法解析时可缺省 → 面板不补 meta 行） */
  meta?:
    | {
        title?: string | undefined;
        author?: string | undefined;
        license?: string | undefined;
        version?: string | undefined;
      }
    | undefined;
}

/** 面板填充回调（视图层注入，解除 utils→views 运行时分层违规 R1；缺失时菜单 render 退化为 no-op） */
export interface VrmPanelHooks {
  /** 声明式节点工厂（[doc:adr-126-p4-b-1] 注入通道回归，P5 收尾 VRM 对齐 MMD）：
   *  vrmModelInfoNodes 必须经此处由视图层注入（缺失 → children 空、面板不渲染） */
  modelInfoNodes?: (ctx: VrmModelInfoCtx) => PreviewMenuNode[];
  /** 截图面板声明式节点工厂（[doc:adr-126-p4-b-1] 注入通道回归，P5 收尾：对齐 MMD/YSM
   *  shotNodes 模式，复用 shot-panel-shared；缺失 → children 空、面板不渲染） */
  shotNodes?: (
    screenshot: (() => Promise<string | null>) | null,
    modelPath: string,
  ) => PreviewMenuNode[];
  /** [doc:adr-126-p5-收尾] play 面板声明式节点（复用 MMD playNodes：toggle 播放/暂停 +
   *  select 动作 + 空态引导）；缺失 → children 空、面板不渲染 */
  playNodes?: (bridge: MmdPlayBridge) => PreviewMenuNode[];
}

/**
 * [ADR-242 后续 / ADR-243 §2.7] 播放面板空态引导文案。
 * VRMA 在现实生态里极稀少（MMD 圈产 VMD、动捕产 FBX，无人专门产 .vrma），故「扫不到动作」
 * 曾是常态；ADR-243 落地后 VMD 成为第二条来源，文案须同时交代两条路径——否则用户会以为
 * 这里只认 .vrma（bridge.emptyHint 与兜底空态节点共用同一份，防两处漂移）。
 */
const VRM_PLAY_EMPTY_HINT =
  "未找到动作文件。把 .vrma / .vmd 放到该模型所在目录即可（同目录自动发现）；MMD 动作库（CustomAnim）里的 .vmd 也会自动重定向到本模型。";

/**
 * [ADR-243 锐评对账 P1a] VMD 动作版权常驻提示：MMD 配布モーション条款常含「MMD 以外使用禁止」
 * 等限制，重定向播放属灰色地带——工具层不裁决合规性，但雷区立牌。走 i18n（`preview.playNotice`），
 * MmdPlayBridge.notice 缺省不渲染，MMD/YSM 桥零影响。
 */
const VRM_PLAY_NOTICE = t("preview.playNotice");

/**
 * [ADR-242 后续] 无动作时的空播放桥：clips 空 → playNodes 走空态引导分支。
 * 面板须显示引导而非消失（对齐 MMD 固定表项行为）。
 */
function emptyVrmPlayBridge(): MmdPlayBridge {
  return {
    clips: [],
    isPlaying: () => false,
    toggle: () => {},
    currentIndex: () => 0,
    select: () => {},
    animDir: null,
    emptyHint: VRM_PLAY_EMPTY_HINT,
    notice: VRM_PLAY_NOTICE,
  };
}

/** [ADR-242 后续] playNodes 未注入时的兜底空态节点：保证 play 面板恒有渲染通道
 *  （items.test 契约「panel 必有 renderCustom/children/schemaId 三选一」，空 children 即静默空面板）。 */
const VRM_PLAY_EMPTY_NODE: PreviewMenuNode = {
  id: "vrma-play-empty",
  kind: "field",
  labelKey: "preview.playEmpty",
  value: VRM_PLAY_EMPTY_HINT,
};

/** P3/P5 位移缩放校准控制面（Stage4 组装、vrmMenuItems 消费；测试可假实现遍历真实菜单表） */
export interface VrmPositionScaleControl {
  /** VMD 重定向动作条目数（>0 才渲染滑块） */
  vmdCount: number;
  /** 当前有效值：持久化覆写 ?? 创建期自动快照（P3，单一事实源） */
  current: () => number;
  /** 用户校准值：原地 rescale 位移轨道（同步，O(值总数)，P5 拖动实时） */
  set: (v: number) => void;
  /** 松手/点击轨道后的离散落盘（null = 清除回自动） */
  onCommit?: (v: number | null) => void;
  /** 清除持久化覆写，回创建期自动快照并 rescale */
  resetToAuto: () => void;
}

/**
 * vrmMenuItems 组装依赖：适配器 build 内组装；测试可构造假依赖遍历真实菜单表
 * （ADR-315 D2③ 拆出后类型名保持 VrmMenuItemsOpts，消费者 import 路径零改动）。
 */
export interface VrmMenuItemsOpts {
  /** 截图能力（ADR-052 P3：screenshotFromRenderer 共享 renderer）；null → 不注入 shot 项 */
  screenshot: (() => Promise<string | null>) | null;
  /** 模型信息数据源（adapter build 构造：文件名 + 骨骼/材质数；model 面板 children 的数据输入） */
  modelInfo: VrmModelInfoCtx;
  /** 模型完整路径（截图保存文件名 + 假对象 _modelPath） */
  modelPath: string;
  bonePanel: {
    /** 已构建骨骼树（buildVrmBoneTree 产物） */
    tree: BoneTree;
    viewContainer: HTMLElement | null;
    /** 兼容真实 ctx 可选字段（undefined）与测试假依赖（null） */
    camera: import("three").PerspectiveCamera | null | undefined;
    scene: import("three").Object3D | null | undefined;
    cleanupRef: BonePanelCleanupRef;
  };
  /** VRM 材质桥：vrm.scene 遍历的 Mesh.material 列表（与 MMD MaterialControlBridge 对齐）*/
  material: {
    list: () => ReturnType<typeof listVrmMaterials>;
    getDetail: (i: number) => ReturnType<typeof getVrmMaterialDetail>;
    setVisible: (i: number, v: boolean) => void;
    setOpacity: (i: number, o: number) => void;
  };
  /** VRM 动作桥（@pixiv/three-vrm-animation 播放）；null/缺省（无同目录 .vrma）→ 不注入 play 项 */
  play?: MmdPlayBridge | null;
  /** 面板填充回调（视图层注入；缺失则 render 退化为 no-op，解除 utils→views 分层违规 R1） */
  panels?: VrmPanelHooks | undefined;
  /** 感知层状态（adapter build 创建，面板 UI 双向绑定） */
  perception?: {
    state: PerceptionState;
    caps: PerceptionCapability[];
  };
  /** [ADR-243 锐评对账 P3/P5] 位移缩放校准控制：仅当有 VMD 重定向动作（vmdCount>0）时注入；
   *  拖动逐 tick 原地 rescale（P5），松手落盘（onCommit），复位回创建期自动快照（P3）。 */
  positionScale?: VrmPositionScaleControl | undefined;
}

/** [ADR-243 锐评对账 P5] 位移缩放校准叶子节点（滑块 + 复位）：仅当有 VMD 重定向动作时露出
 *  （.vrma 不受 positionScale 影响）。拖动逐 tick 实时 rescale（set），松手落盘（onCommit）——
 *  替换原先「拖动抑制 + 松手重建整库重读」的重路径。
 *  ⚠️ 必须挂面板 children（叶子层）：根项只允许 panel/action/divider（check-menu-health
 *  ROOT_KINDS），根项滑块既违规又不可达（motionDetailView 只列 kind==="panel" 的 motion 项）。 */
function vmdPositionScaleNodes(ps: VrmPositionScaleControl): PreviewMenuNode[] {
  return [
    {
      id: "vmd-position-scale",
      labelKey: "preview.vmdPositionScale",
      kind: "slider",
      control: {
        min: 0,
        max: 0.4,
        step: 0.005,
        get: () => ps.current(),
        set: (v: unknown) => {
          // 拖动实时：原地改写位移轨道（O(值总数)），下一帧渲染即见新缩放
          const n = Number(v);
          if (Number.isFinite(n)) ps.set(n);
        },
        onCommit: (v: number) => {
          // 松手/点击轨道/键盘步进后离散落盘（拖动期间的 rescale 已完成）
          ps.onCommit?.(v);
        },
        unit: "x",
      },
    },
    {
      id: "vmd-position-scale-reset",
      labelKey: "preview.vmdPositionScaleReset",
      kind: "button",
      action: (): void => {
        ps.resetToAuto();
      },
    },
  ];
}

/**
 * VRM 声明式根菜单专属项（ADR-076 v2 Phase 2）：🦴 骨骼 + 🎨 材质。
 * 提取为可导出表：适配器与测试共用同一份真实数组（对齐 MikuMikuAR），加菜单项只改这里。
 * 根项白名单：只出 panel/action/divider（控件类节点挂对应面板 children）。
 */
export function vrmMenuItems(o: VrmMenuItemsOpts): PreviewMenuNode[] {
  const items: PreviewMenuNode[] = [
    {
      id: "model",
      icon: "model",
      labelKey: "preview.modelInfo",
      kind: "panel",
      dockGroup: "model",
      // [doc:adr-126-p4-b-1] 面板内容声明式化（P5 收尾：VRM 迁 children 样板，对齐 MMD）：
      // children = vrmModelInfoNodes 纯数据节点（经 panels 注入，R1 禁 utils→views）。
      // 此前 renderCustom 委托 makeModelPanelRenderer——视图层从未注入（no-op 空面板），
      // 迁 children 顺带补上从未有过的模型信息内容。
      children: o.panels?.modelInfoNodes?.(o.modelInfo) ?? [],
    },
    {
      id: "shot",
      icon: "camera",
      labelKey: "preview.screenshot",
      kind: "panel",
      dockGroup: "model",
      // [doc:adr-126-p4-b-1] 截图面板声明式化（P5 收尾：对齐 MMD/YSM shotNodes 样板，
      // 复用 shot-panel-shared 六角度按钮）；此前委托 makeShotPanelRenderer——
      // 视图层从未注入（no-op 空面板），迁 children 顺带补上截图功能。
      children: o.panels?.shotNodes?.(o.screenshot, o.modelPath) ?? [],
    },
    {
      id: "material",
      icon: "appearance",
      labelKey: "preview.materialList",
      kind: "panel",
      dockGroup: "model",
      children: materialNodes(o.material),
    },
    makeBonesPanelItem({
      tree: o.bonePanel.tree,
      cleanupRef: o.bonePanel.cleanupRef,
      viewContainer: o.bonePanel.viewContainer,
      camera: o.bonePanel.camera,
      scene: o.bonePanel.scene,
    }),
  ];
  // [ADR-242 后续] play 面板无条件注入（对齐 MMD 的固定表项）：无 .vrma 时也显示面板 +
  // 空态引导，用户才知道「此处可放动作」——此前 if(o.play) 门控致面板凭空消失，
  // 用户误以为 VRM 不支持动作。空态文案由 bridge.emptyHint 自报（VRM 专有 .vrma 说明）。
  // playNodes 未注入时兜底空态 field：面板恒有渲染通道（items.test 契约：panel 必有
  // renderCustom/children/schemaId 三选一，空 children 会被判为静默空面板）。
  const playChildren = o.panels?.playNodes?.(o.play ?? emptyVrmPlayBridge());
  // [ADR-243 锐评对账 P3] 位移缩放校准挂动作面板 children（叶子层，见 vmdPositionScaleNodes）：
  // 仅当有 VMD 重定向动作时露出（.vrma 不受 positionScale 影响）。
  const posScaleNodes =
    o.positionScale && o.positionScale.vmdCount > 0 ? vmdPositionScaleNodes(o.positionScale) : [];
  const playPanelChildren = [...(playChildren ?? []), ...posScaleNodes];
  items.push({
    id: "vrma-play",
    icon: "play",
    labelKey: "preview.mmdPlay",
    kind: "panel",
    dockGroup: "motion", // 底栏 💃 动作组（对齐 MMD）
    // [doc:adr-126-p5-收尾] play 面板声明式化：children = playNodes（复用 MMD，经 panels 注入）
    // + P3 位移缩放校准叶子（两通道皆空时兜底空态 field，保证面板恒有渲染通道）
    children: playPanelChildren.length > 0 ? playPanelChildren : [VRM_PLAY_EMPTY_NODE],
  });
  if (o.perception) {
    items.push({
      id: "perception",
      icon: "visibility",
      labelKey: "preview.perception",
      kind: "panel",
      dockGroup: "motion",
      children: perceptionNodes(o.perception.state, o.perception.caps),
    });
  }
  return items;
}
