// ===== bones-panel-node.ts — 通用骨骼面板菜单项工厂（ADR-077 + ADR-074 S2 复用）=====
// 4 个 3D adapter（ysm / vrm / mmd / fbx）共享同一个调用模式：
//   renderCustom = (list) => {
//     if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
//     cleanupRef.current = makeBonePanelRenderer(tree)(list, { viewContainer, camera, scene });
//   }
// 此前 4 段 ~15 行代码高度同构（仅 legacyTestId / 是否 null 守卫不同）——抽本工厂：
//   - 统一空守卫：viewContainer/camera/scene 任一缺失时早 return（采纳 mmd 写法 L1358-1361）
//   - 统一 cleanup 重入清理（同一 panel 重渲染前先清理旧 renderer，防 listener 累积）
//   - legacyTestId 由 caller 注入（"ysm-bones-entry" / "vrm-bones-entry" / "mmd-bones-entry" / "fbx-bones-entry"）
// 4 个 adapter 的 menuItems 中 bones 项从 ~15 行 → 1 行 factory 调用。
//
// 为什么不走 schema 声明式（与 litematic 对齐）：
//   litematic 是「6 个固定控件」（select / slider / divider），schema 自然；
//   骨骼面板是「动态树形列表 + 跨域拾取联动」（骨骼数随模型变 + viewContainer click → 写 activeId），
//   强行 schema 化需新增「动态 row」「跨域 state 绑定」抽象，ROI 为负。
//   makeBonePanelRenderer（vrm-bone-ui.ts）本身就是 ADR-074 S2 抽的通用组件，本工厂只是它的
//   「菜单项胶水」——并非"手写 3D 菜单"，符合 AGENTS.md 精神。
//
// 是否注入（adapter 决策）：
//   - mmd：无 o.bonePanel 不注入（o.bonePanel 整块不推）
//   - fbx：无骨骼不注入（boneTree.roots.length === 0 不推）
//   - ysm / vrm：无条件注入（menuItems 基础项）
//   这些「是否注入」的策略由各 adapter 在外层控制，本工厂只负责「注入什么形状」。

import * as THREE from "three";
import type { PreviewMenuNode } from "./preview-menu/node-types.ts";
import { makeBonePanelRenderer } from "./vrm-bone-ui.ts";
import type { BoneTree } from "../bone-tools.ts";

/** 工厂入参：caller 持 cleanupRef（与 panel 生命周期对齐，dispose 时同步调） */
export interface BonesPanelItemOpts {
  /** 骨骼树（YSM spec / VRM humanoid / FBX SkinnedMesh 统一抽象；null 走 makeBonePanelRenderer 空态） */
  tree: BoneTree | null;
  /** 重入时调用的清理函数 ref（adapter 持此 ref，dispose 时也调） */
  cleanupRef: { current: (() => void) | null };
  /** 面板上下文：允许 null/undefined（核心未填充时面板不应渲染——mmd L1358-1361 守卫模式，
   *  caller 类型多为 `T | null | undefined`；工厂内部 falsy 检查统一覆盖两者） */
  viewContainer: HTMLElement | null | undefined;
  camera: THREE.Camera | null | undefined;
  scene: THREE.Object3D | null | undefined;
  /** adapter-specific e2e 锚（"ysm-bones-entry" / "vrm-bones-entry" / "mmd-bones-entry" / "fbx-bones-entry"） */
  legacyTestId: string;
}

/**
 * 构造「骨骼」菜单项节点。返回的 PreviewMenuNode 形状固定：
 *   id="bones" / icon="🦴" / dockGroup="motion" / kind="panel"
 * caller 决定「是否 push」（有无骨骼 / 有无 bonePanel）。
 */
export function makeBonesPanelItem(opts: BonesPanelItemOpts): PreviewMenuNode {
  return {
    id: "bones",
    icon: "🦴",
    labelKey: "preview.section.bones",
    fallback: "骨骼",
    kind: "panel",
    dockGroup: "motion", // 底栏 💃 动作组（骨骼是动作驱动目标，归动作域）
    legacyTestId: opts.legacyTestId,
    renderCustom: (list): void => {
      // 空守卫：核心未填充时不渲染（mmd 写法统一——4 个 adapter 共用同一守卫语义）
      if (!opts.viewContainer || !opts.camera || !opts.scene) return;
      // 重入清理：同一 panel 重复挂载前先清理旧 renderer（含 viewContainer raycaster listener 摘除）
      if (opts.cleanupRef.current) {
        opts.cleanupRef.current();
        opts.cleanupRef.current = null;
      }
      opts.cleanupRef.current = makeBonePanelRenderer(opts.tree)(list, {
        viewContainer: opts.viewContainer,
        camera: opts.camera as THREE.PerspectiveCamera, // makeBonePanelRenderer 类型要求 PerspectiveCamera，caller 契约保证
        scene: opts.scene,
      });
    },
  };
}
