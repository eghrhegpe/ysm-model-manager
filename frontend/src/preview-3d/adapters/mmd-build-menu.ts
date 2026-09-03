// ===== mmd-build-menu.ts：mmd-adapter.ts stage 管线拆分产物（ADR-167，字节级搬移）=====

import * as THREE from "three";
import type { MmdBottomNavCtx } from "../../views/app-preview/mmd-controls.ts";
import { buildBoneTree } from "../bone-tools.ts";
import type { PreviewMenuNode } from "../menu/node-types.ts";
import { mmdBonesToBoneNodes } from "../mmd-bones.ts";
import { createFootIKController } from "../mmd-foot-ik.ts";
import { getMmdMaterialDetail, listMmdMaterials, setMmdMaterialOpacity, setMmdMaterialVisible } from "../mmd-materials.ts";
import { createAutoDanceController } from "../perception/autodance.ts";
import { createBlinkController } from "../perception/blink.ts";
import { createBreathController } from "../perception/breath.ts";
import { createGazeController } from "../perception/gaze.ts";
import { buildLipMorphIndices, createLipSyncController } from "../perception/lipsync.ts";
import { screenshotFromRenderer } from "../screenshot.ts";
import { mmdSemanticBoneMap } from "../semantic-bones.ts";
import { mmdSemanticMorphMap } from "../semantic-morphs.ts";
import { makeBonesPanelItem } from "./bones-panel-node.ts";
import { materialNodes } from "./material-controls.ts";
import { morphNodes } from "./morph-controls.ts";
import { perceptionNodes } from "./perception-controls.ts";
import type { PerceptionCapability } from "./perception-controls.ts";
import type { MdMmStage5Ctx, MmdMenuItemsOpts } from "./mmd-types.ts";

export function mdMmStage5Menu(c: MdMmStage5Ctx): {
  semanticBones: ReturnType<typeof mmdSemanticBoneMap> | undefined;
  semanticMorphs: ReturnType<typeof mmdSemanticMorphMap>;
  breath: ReturnType<typeof createBreathController>;
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
  // perceptionCaps 仅本函数使用（菜单注入）——局部 const，不占用 ctx
  const perceptionCaps: PerceptionCapability[] = [
    { id: "breath", labelKey: "preview.perceptionBreath", fallback: "呼吸" },
    { id: "gaze", labelKey: "preview.perceptionGaze", fallback: "注视" },
    { id: "blink", labelKey: "preview.perceptionBlink", fallback: "眨眼" },
    { id: "lipSync", labelKey: "preview.perceptionLipSync", fallback: "口型" },
    { id: "autoDance", labelKey: "preview.perceptionAutoDance", fallback: "律动" },
  ];
  const items = mmdMenuItems({
    navCtx,
    panels: c.panels,
    screenshot: () =>
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
  const semanticBones = c.boneTree ? mmdSemanticBoneMap(c.boneTree) : undefined;
  const semanticMorphs = mmdSemanticMorphMap(c.mmd?.pmx?.morphs ?? []);
  const breath = createBreathController();
  const gaze = createGazeController();
  const blink = createBlinkController();
  const lipSync = createLipSyncController({ multiMorph: true });
  const lipSyncTime = 0;
  const lipIndices =
    c.mesh.morphTargetDictionary && semanticMorphs
      ? buildLipMorphIndices(semanticMorphs, c.mesh.morphTargetDictionary)
      : undefined;
  const autoDance = createAutoDanceController({ bpm: 120, intensity: 0.3 });
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
  };
}

/**
 * MMD 声明式根菜单专属项（ADR-076 v2 Phase 2）：model / 材质 / 播放（+ 条件 bones）。
 * 提取为可导出表：适配器与测试共用同一份真实数组——测试遍历本表断言结构与
 * dock 渲染（对齐 MikuMikuAR 声明式菜单测试范式），加菜单项只改这里。
 */
export function mmdMenuItems(o: MmdMenuItemsOpts): PreviewMenuNode[] {
  const items: PreviewMenuNode[] = [
    {
      id: "model",
      icon: "🧍",
      labelKey: "preview.modelInfo",
      fallback: "模型",
      kind: "panel",
      legacyTestId: "mmd-model-entry",
      dockGroup: "model", // 底栏 🧍 模型组
      // [doc:adr-126-p4-b-1] 面板内容声明式化：children = modelInfoNodes 纯数据节点（经 panels 注入，
      // R1 禁 utils→views 运行时依赖），渲染走 renderMenu（preview-menu/render.ts）。
      // fillModelPanel 逃生舱保留在 MmdPanelHooks（兼容既有面板），此处走新通道。
      children: o.panels?.modelInfoNodes?.(o.navCtx) ?? [],
    },
    {
      id: "morph",
      icon: "😀",
      labelKey: "preview.mmdMorph",
      fallback: "表情",
      kind: "panel",
      legacyTestId: "mmd-morph-entry",
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
    },
    {
      id: "material",
      icon: "🎨",
      labelKey: "preview.materialList",
      fallback: "材质",
      kind: "panel",
      legacyTestId: "mmd-material-entry",
      dockGroup: "model", // 底栏 🧍 模型组
      children: materialNodes(o.material),
    },
  ];
  // [doc:adr-126-p4-b-1] 截图面板条件注入：screenshot 能力缺失（null）→ 不注入项
  // （对齐 bonePanel 范式；比"注入空 children 面板"干净——截图能力是可选能力）。
  // 面板内容声明式化：children = shotNodes 纯数据节点（6 截图按钮，经 panels 注入），渲染走 renderMenu。
  if (o.screenshot) {
    items.push({
      id: "shot",
      icon: "📷",
      labelKey: "preview.screenshot",
      fallback: "截图",
      kind: "panel",
      dockGroup: "model", // 底栏 🧍 模型组
      legacyTestId: "mmd-shot-entry",
      children: o.panels?.shotNodes?.(o.navCtx, o.screenshot) ?? [],
    });
  }
  // MMD 始终注入 play 项（支持用户配置的自定义动作库，空态引导选择）
  items.push({
    id: "play",
    icon: "▶️",
    labelKey: "preview.mmdPlay",
    fallback: "播放",
    kind: "panel",
    legacyTestId: "mmd-play-entry",
    dockGroup: "motion", // 底栏 💃 动作组
    // [doc:adr-126-p5-收尾] play 面板声明式化：children = playNodes（toggle 播放/暂停 +
    // select 动作 + 空态引导），经 panels 注入（R1 禁 utils→views）。fillPlayPanel 逃生舱删除。
    children: o.panels?.playNodes?.(o.play) ?? [],
  });
  if (o.bonePanel) {
    // 工厂统一空守卫 + cleanupRef 重入清理（消除原 4 段 ~15 行重复）
    items.push(
      makeBonesPanelItem({
        tree: o.bonePanel.tree,
        cleanupRef: o.bonePanel.cleanupRef,
        viewContainer: o.bonePanel.viewContainer,
        camera: o.bonePanel.camera,
        scene: o.bonePanel.scene,
        legacyTestId: "mmd-bones-entry",
      }),
    );
  }
  if (o.perception) {
    // 局部 const 收窄替代 !：renderCustom 闭包内 TS 不保持 o.perception 的收窄
    const pc = o.perception;
    items.push({
      id: "perception",
      icon: "👁️",
      labelKey: "preview.perception",
      fallback: "感知",
      kind: "panel",
      dockGroup: "motion",
      children: perceptionNodes(pc.state, pc.caps),
    });
  }
  return items;
}
