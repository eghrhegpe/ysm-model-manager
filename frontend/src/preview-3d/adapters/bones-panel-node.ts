// ===== bones-panel-node.ts — 通用骨骼面板菜单项工厂（ADR-077 + ADR-074 S2 复用）=====
// 4 个 3D adapter（ysm / vrm / mmd / fbx）共享同一个调用模式：
//   renderCustom = (list) => makeBonePanelRenderer(tree)(list, { viewContainer, camera, scene })
// 此前 4 段 ~15 行代码高度同构（仅是否 null 守卫不同）——抽本工厂：
//   - 统一空守卫：viewContainer/camera/scene 任一缺失时早 return（采纳 mmd 写法 L1358-1361）
//   - cleanup 双持有者（2026-09 生命周期收编，单一创建点）：
//       ① 渲染器（render.ts runCustomMount 按容器持有）——面板级：重渲染前先清旧、菜单 dispose 全清
//       ② caller 的 cleanupRef——模型级：adapter.dispose 时摘（模型卸载而菜单仍存活的兜底）
//     两者持同一 cleanup（renderer 实现幂等：disposed 置位 + removeEventListener），双清无害。
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

import type * as THREE from "three";
import type { BoneTree } from "../bone-tools.ts";
import type { PreviewMenuNode } from "../menu/node-types.ts";
import { makeBonePanelRenderer } from "./vrm-bone-ui.ts";

/**
 * 骨骼面板清理引用（4 adapter 共用统一接口，ADR-074 S2）。
 * caller 持此 ref，**模型 dispose 时调用**——摘 viewContainer 上的 raycaster listener
 * （listener 闭包引用模型 scene/tree，模型卸载后必须摘，即使菜单面板仍开着）。
 * 面板级重入清理由渲染器 render.ts 负责，本 ref 仅作模型级兜底（双清幂等，无害）。
 */
export interface BonePanelCleanupRef {
  current: (() => void) | null;
}

/** 工厂入参：caller 提供骨骼树 + 面板上下文（核心未填充时工厂空守卫早 return） */
export interface BonesPanelItemOpts {
  /** 骨骼树（YSM spec / VRM humanoid / FBX SkinnedMesh 统一抽象；null 走 makeBonePanelRenderer 空态） */
  tree: BoneTree | null;
  /** 清理函数 ref（adapter 持此 ref，模型 dispose 时调；渲染器另持同一 cleanup 管面板生命周期） */
  cleanupRef: BonePanelCleanupRef;
  /** 面板上下文：允许 null/undefined（核心未填充时面板不应渲染——mmd L1358-1361 守卫模式，
   *  caller 类型多为 `T | null | undefined`；工厂内部 falsy 检查统一覆盖两者） */
  viewContainer: HTMLElement | null | undefined;
  camera: THREE.Camera | null | undefined;
  scene: THREE.Object3D | null | undefined;
}

/**
 * 构造「骨骼」菜单项节点。返回的 PreviewMenuNode 形状固定：
 *   id="bones" / icon="🦴" / dockGroup="motion" / kind="panel"
 * caller 决定「是否 push」（有无骨骼 / 有无 bonePanel）。
 * renderCustom 把 renderer 的 cleanup 同时交给两方：return 给渲染器（面板级生命周期），
 * 写回 caller 的 cleanupRef（模型级 dispose 兜底）。两者持同一函数，幂等。
 */
export function makeBonesPanelItem(opts: BonesPanelItemOpts): PreviewMenuNode {
  return {
    id: "bones",
    icon: "🦴",
    labelKey: "preview.section.bones",
    fallback: "骨骼",
    kind: "panel",
    dockGroup: "motion", // 底栏 💃 动作组（骨骼是动作驱动目标，归动作域）
    // biome-ignore lint/suspicious/noConfusingVoidType: 同 node-types.ts renderCustom 契约（void 表「cleanup 或空」），改 undefined 连锁破坏 6+ 实现点
    renderCustom: (list): (() => void) | void => {
      // 空守卫：核心未填充时不渲染（mmd 写法统一——4 个 adapter 共用同一守卫语义）
      if (!opts.viewContainer || !opts.camera || !opts.scene) return;
      // code_review 4ac2b4f72 #1/#3：写新 cleanup 前先摘旧——面板 close→reopen 每次导航
      // 建新 list 容器，runCustomMount 的按容器键控（customCleanups.get(container)）永远
      // miss 旧容器，旧 viewContainer raycaster listener 永不摘除、N 次开合累计 N 个。
      // cleanupRef 是模型级单槽（元素无关），每次挂载先调旧再置新 → 同模型最多 1 listener；
      // registry 同容器 prev 与这里对幂等 cleanup 是双调，无害（render.ts 注释已声明幂等）。
      if (opts.cleanupRef.current) {
        opts.cleanupRef.current();
        opts.cleanupRef.current = null;
      }
      const cleanup = makeBonePanelRenderer(opts.tree)(list, {
        viewContainer: opts.viewContainer,
        camera: opts.camera as THREE.PerspectiveCamera, // makeBonePanelRenderer 类型要求 PerspectiveCamera，caller 契约保证
        scene: opts.scene,
      });
      // 模型级兜底句柄：adapter.dispose 摘 listener（模型卸载而菜单存活的场景唯一防线）。
      // 渲染器可能已先清过（重入/dispose）——cleanup 幂等，重复调用无害。
      opts.cleanupRef.current = cleanup;
      // 面板级生命周期：交渲染器持有（重渲染前先清旧、菜单 dispose 全清）
      return cleanup;
    },
  };
}
