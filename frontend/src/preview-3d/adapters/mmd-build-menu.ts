// ===== mmd-build-menu.ts：mmd-adapter.ts stage 管线拆分产物（ADR-167，字节级搬移）=====

import type * as THREE from "three";
import { createAutoDanceController } from "@/preview-3d/adapters/shared/perception/autodance.ts";
import { createBlinkController } from "@/preview-3d/adapters/shared/perception/blink.ts";
import { createBreathController } from "@/preview-3d/adapters/shared/perception/breath.ts";
import {
  createPerceptionPauseRef,
  type PerceptionPauseRef,
} from "@/preview-3d/adapters/shared/perception/core.ts";
import { createGazeController } from "@/preview-3d/adapters/shared/perception/gaze.ts";
import {
  buildLipMorphIndices,
  createLipSyncController,
} from "@/preview-3d/adapters/shared/perception/lipsync.ts";
import { buildBoneTree } from "@/preview-3d/bone/bone-tools.ts";
import { mmdBonesToBoneNodes } from "@/preview-3d/bone/mmd-bones.ts";
import { createFootIKController } from "@/preview-3d/bone/mmd-foot-ik.ts";
import { mmdSemanticBoneMap } from "@/preview-3d/bone/semantic-bones.ts";
import { mmdSemanticMorphMap } from "@/preview-3d/infra/semantic-morphs.ts";
import {
  getMmdMaterialDetail,
  listMmdMaterials,
  setMmdMaterialOpacity,
  setMmdMaterialVisible,
} from "@/preview-3d/materials/mmd-materials.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/node-types.ts";
import { screenshotFromRenderer } from "@/preview-3d/screenshot/screenshot.ts";
import { makeBonesPanelItem } from "./bones-panel-node.ts";
import type { MmdBottomNavCtx } from "./content-bridges.ts";
import { materialNodes } from "./material-controls.ts";
import type { MmdMenuItemsOpts, Stage5Ctx } from "./mmd-types.ts";
import { morphNodes } from "./morph-controls.ts";
import { perceptionNodes, pickPerceptionCaps } from "./perception-controls.ts";

export function Stage5Menu(c: Stage5Ctx): {
  semanticBones: ReturnType<typeof mmdSemanticBoneMap> | undefined;
  semanticMorphs: ReturnType<typeof mmdSemanticMorphMap>;
  breath: ReturnType<typeof createBreathController>;
  perceptionPauseRef: PerceptionPauseRef;
  gaze: ReturnType<typeof createGazeController>;
  blink: ReturnType<typeof createBlinkController>;
  lipSync: ReturnType<typeof createLipSyncController>;
  lipSyncTime: number;
  lipIndices: ReturnType<typeof buildLipMorphIndices> | undefined;
  autoDance: ReturnType<typeof createAutoDanceController>;
  footIK: ReturnType<typeof createFootIKController>;
  items: PreviewMenuNode[];
} {
  const navCtx: MmdBottomNavCtx = {
    // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
    mmd: c.mmd!,
    mesh: c.mesh,
    modelName: c.origPath.split(/[/\\]/).pop() || "",
    modelPath: c.origPath,
    ...(c.ctx.cameraControls ? { cameraControls: c.ctx.cameraControls } : {}),
    ...(c.ctx.switchTo ? { switchTo: c.ctx.switchTo } : {}),
    // [doc:adr-132] zip 多 pmx 候选（模型面板切换 select 用）
    zipModelCandidates: c.zipModelCandidates,
  };
  const mats = c.mesh.material as unknown as THREE.Material[];
  c.bonePanelRef = { current: null };
  c.boneTree =
    c.mmd?.pmx?.bones && c.mesh.skeleton
      ? buildBoneTree(mmdBonesToBoneNodes(c.mmd?.pmx.bones, c.mesh.skeleton.bones))
      : null;
  c.perceptionState = { breath: true, gaze: true, blink: true, lipSync: true, autoDance: true };
  // 语义层提前解析（caps 派生 + 下方控制器构造共用同一份）；perceptionCaps 仅本函数
  // 使用（菜单注入）——局部 const，不占用 ctx。
  const semanticBones = c.boneTree ? mmdSemanticBoneMap(c.boneTree) : undefined;
  const semanticMorphs = mmdSemanticMorphMap(c.mmd?.pmx?.morphs ?? []);
  // 能力声明：caps 从真实构造派生（非硬编码清单）——骨骼驱动模块（呼吸/注视/律动）
  // 需语义骨骼、morph 驱动模块（眨眼/口型）需语义 morph，缺失时不显示死开关（菜单不谎报）。
  // code_review ADR-195 #8：按语义族分别门控——语义 morph 表按族分键，聚合布尔
  // `Object.keys().length > 0` 会在「仅 lip 系」模型上显示无驱动的死 blink 开关
  // （反之仅 blink 显示死 lipSync）；与 mmd-build-result.ts 应用分支口径一致
  // （blink 应用要求 semanticMorphs.blink、lipSync 应用要求 lipIndices 非空）
  const hasSemanticBones = !!semanticBones && Object.keys(semanticBones).length > 0;
  const morphs = semanticMorphs as Partial<Record<string, { index?: number } | undefined>>;
  const hasBlinkMorph = !!morphs.blink;
  const hasLipMorph =
    !!morphs.lipOpen || !!morphs.lipClose || !!morphs.lipPucker || !!morphs.lipSmile;
  const perceptionCaps = pickPerceptionCaps([
    ...(hasSemanticBones ? (["breath", "gaze", "autoDance"] as const) : []),
    ...(hasBlinkMorph ? (["blink"] as const) : []),
    ...(hasLipMorph ? (["lipSync"] as const) : []),
  ]);
  const items = mmdMenuItems({
    navCtx,
    panels: c.panels,
    screenshot: () =>
      // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
      Promise.resolve(screenshotFromRenderer(c.ctx.renderer!, c.ctx.scene, c.ctx.camera)),
    material: {
      list: () =>
        listMmdMaterials((c.mmd?.pmx.materials as unknown as readonly { name: string }[]) ?? []),
      getDetail: (i) =>
        getMmdMaterialDetail(
          (c.mmd?.pmx.materials as unknown as readonly { name: string }[]) ?? [],
          mats,
          i,
        ),
      setVisible: (i, v) => setMmdMaterialVisible(mats, i, v),
      setOpacity: (i, o) => {
        setMmdMaterialOpacity(mats, i, o);
        const m = mats[i];
        if (m) m.needsUpdate = true;
      },
    },
    play: {
      clips: c.clips,
      isPlaying: () => c.playing,
      toggle: () => {
        if (c.clips.length === 0) return;
        c.playing = !c.playing;
        if (c.action) c.action.paused = !c.playing;
        if (c.cameraAction) c.cameraAction.paused = !c.playing;
      },
      currentIndex: () => c.curIdx,
      select: (i) => {
        if (i === c.curIdx || i >= c.clips.length) return;
        c.curIdx = i;
        c.action?.stop();
        c.mesh.skeleton?.pose();
        c.action = c.mixer.clipAction(c.clips[i].clip);
        c.action.reset();
        if (c.playing) c.action.play();
        if (c.cameraMixer) {
          c.cameraAction?.stop();
          const nextCamClip = c.cameraClips[i] ?? null;
          c.cameraAction = nextCamClip ? c.cameraMixer.clipAction(nextCamClip) : null;
          if (c.cameraAction && c.playing) c.cameraAction.play();
        }
      },
      animDir: c.customAnimPath,
      requestReload: () => {
        void c.ctx.menu.refreshDock();
      },
    },
    bonePanel: c.boneTree
      ? {
          tree: c.boneTree,
          viewContainer: c.ctx.viewContainer,
          camera: c.ctx.camera,
          scene: c.ctx.scene,
          cleanupRef: c.bonePanelRef,
        }
      : null,
    perception: { state: c.perceptionState, caps: perceptionCaps },
  });
  const perceptionPauseRef = createPerceptionPauseRef();
  const breath = createBreathController({ pauseRef: perceptionPauseRef });
  const gaze = createGazeController();
  const blink = createBlinkController({ pauseRef: perceptionPauseRef });
  const lipSync = createLipSyncController({ multiMorph: true, pauseRef: perceptionPauseRef });
  const lipSyncTime = 0;
  const lipIndices =
    c.mesh.morphTargetDictionary && semanticMorphs
      ? buildLipMorphIndices(semanticMorphs, c.mesh.morphTargetDictionary)
      : undefined;
  const autoDance = createAutoDanceController({
    bpm: 120,
    intensity: 0.3,
    pauseRef: perceptionPauseRef,
  });
  const footIK = createFootIKController(c.boneTree, semanticBones);
  return {
    semanticBones,
    semanticMorphs,
    breath,
    gaze,
    blink,
    lipSync,
    lipSyncTime,
    lipIndices,
    autoDance,
    footIK,
    items,
    perceptionPauseRef,
  };
}

/** MMD 菜单表条目：声明式表达条件注入 + 节点构建（对齐 visibleWhen 语义，但吃构建期能力） */
interface MmdMenuEntry {
  id: string;
  /** 构建期能力守卫：false 时不注入该节点（对齐 visibleWhen 语义，但吃构建期能力而非状态层快照） */
  when?: (o: MmdMenuItemsOpts) => boolean;
  /** 构建节点（惰性求值，仅当 when 通过时调用） */
  build: (o: MmdMenuItemsOpts) => PreviewMenuNode;
}

/**
 * MMD 声明式根菜单专属项表（ADR-076 v2 Phase 2）：model / 材质 / 播放（+ 条件 bones）。
 * 提取为可导出表：适配器与测试共用同一份真实数组——测试遍历本表断言结构与
 * dock 渲染（对齐 MikuMikuAR 声明式菜单测试范式），加菜单项只改这里。
 * 条件注入用 when 字段声明式表达（对齐 visibleWhen 语义），消除命令式 if + push。
 */
const MMD_MENU_TABLE: readonly MmdMenuEntry[] = [
  {
    id: "model",
    build: (o) => ({
      id: "model",
      icon: "🧍",
      labelKey: "preview.modelInfo",
      fallback: "模型",
      kind: "panel",
      dockGroup: "model", // 底栏 🧍 模型组
      // [doc:adr-126-p4-b-1] 面板内容声明式化：children = modelInfoNodes 纯数据节点（经 panels 注入，
      // R1 禁 utils→views 运行时依赖），渲染走 renderMenu（preview-menu/render.ts）。
      // fill* 命令式逃生舱字段已于 2026-09-03 随 G3 收口删除——nodes 为唯一通道。
      children: o.panels?.modelInfoNodes?.(o.navCtx) ?? [],
    }),
  },
  {
    id: "morph",
    build: (o) => ({
      id: "morph",
      icon: "😀",
      labelKey: "preview.mmdMorph",
      fallback: "表情",
      kind: "panel",
      dockGroup: "motion", // 底栏 💃 动作组（表情是动作系统的资产）
      // [doc:adr-126-p5-收尾] morph 面板声明式化：children = morphNodes 纯数据节点
      // （toggle kind，照 perceptionNodes 样板）。fillMorphPanel 逃生舱删除。
      // 仅取 morph 相关子集（SkinnedMesh 的 morphTarget* 为可选项——真实存在才附带）
      children: morphNodes({
        ...(o.navCtx.mesh.morphTargetDictionary !== undefined
          ? { morphTargetDictionary: o.navCtx.mesh.morphTargetDictionary }
          : {}),
        ...(o.navCtx.mesh.morphTargetInfluences !== undefined
          ? { morphTargetInfluences: o.navCtx.mesh.morphTargetInfluences }
          : {}),
      }),
    }),
  },
  {
    id: "material",
    build: (o) => ({
      id: "material",
      icon: "🎨",
      labelKey: "preview.materialList",
      fallback: "材质",
      kind: "panel",
      dockGroup: "model", // 底栏 🧍 模型组
      children: materialNodes(o.material),
    }),
  },
  {
    id: "shot",
    // [doc:adr-126-p4-b-1] 截图面板条件注入：screenshot 能力缺失（null）→ 不注入项
    // （对齐 bonePanel 范式；比"注入空 children 面板"干净——截图能力是可选能力）。
    when: (o) => !!o.screenshot,
    build: (o) => ({
      id: "shot",
      icon: "📷",
      labelKey: "preview.screenshot",
      fallback: "截图",
      kind: "panel",
      dockGroup: "model", // 底栏 🧍 模型组
      // 面板内容声明式化：children = shotNodes 纯数据节点（6 截图按钮，经 panels 注入），渲染走 renderMenu。
      children: o.panels?.shotNodes?.(o.navCtx, o.screenshot) ?? [],
    }),
  },
  {
    id: "play",
    build: (o) => ({
      id: "play",
      icon: "▶️",
      labelKey: "preview.mmdPlay",
      fallback: "播放",
      kind: "panel",
      dockGroup: "motion", // 底栏 💃 动作组
      // [doc:adr-126-p5-收尾] play 面板声明式化：children = playNodes（toggle 播放/暂停 +
      // select 动作 + 空态引导），经 panels 注入（R1 禁 utils→views）。fillPlayPanel 逃生舱删除。
      children: o.panels?.playNodes?.(o.play) ?? [],
    }),
  },
  {
    id: "bones",
    when: (o) => !!o.bonePanel,
    build: (o) => {
      // 局部 const 收窄替代逐字段 !：when 守卫已筛 o.bonePanel 非空，
      // 但 build 与 when 是独立函数，TS 窄化不跨函数传播（对齐 perception 条目范式）
      // biome-ignore lint/style/noNonNullAssertion: 确定性断言(when 守卫已筛 o.bonePanel 非空)
      const bp = o.bonePanel!;
      // 工厂统一空守卫 + cleanupRef 重入清理（消除原 4 段 ~15 行重复）
      return makeBonesPanelItem({
        tree: bp.tree,
        cleanupRef: bp.cleanupRef,
        viewContainer: bp.viewContainer,
        camera: bp.camera,
        scene: bp.scene,
      });
    },
  },
  {
    id: "perception",
    when: (o) => !!o.perception,
    build: (o) => {
      // 局部 const 收窄替代 !：renderCustom 闭包内 TS 不保持 o.perception 的收窄
      // biome-ignore lint/style/noNonNullAssertion: 确定性断言(when 守卫已筛 o.perception 非空)
      const pc = o.perception!;
      return {
        id: "perception",
        icon: "👁️",
        labelKey: "preview.perception",
        fallback: "感知",
        kind: "panel",
        dockGroup: "motion",
        children: perceptionNodes(pc.state, pc.caps),
      };
    },
  },
];

/**
 * MMD 声明式根菜单专属项（ADR-076 v2 Phase 2）：遍历声明式表，按 when 守卫过滤 + build 构建。
 * 适配器与测试共用同一份真实数组——测试遍历本表断言结构与 dock 渲染（对齐 MikuMikuAR
 * 声明式菜单测试范式），加菜单项只改 MMD_MENU_TABLE。
 */
export function mmdMenuItems(o: MmdMenuItemsOpts): PreviewMenuNode[] {
  return MMD_MENU_TABLE.filter((e) => !e.when || e.when(o)).map((e) => e.build(o));
}
