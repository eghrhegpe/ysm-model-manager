// ===== VRM 骨骼面板 UI（原生 Web Components + Shadow DOM，对齐项目技术栈）=====
// 接入通用骨骼工具层（bone-tools.ts）+ VRM 适配（vrm-bone.ts）：
// 列表（深度缩进 + 显隐勾选）/ 详情（路径/坐标/父/子）/ 拾取联动（click 3D → 高亮 + 详情）。
// 不复用 site/render.ts 的内联卡片工厂（创作者专用，非通用模块）——原生直绘更轻。
// Phase 3 收编：骨骼面板渲染器现在通过 vrmMenuItems 的 panel render 回调挂入根菜单，
// 不再依赖 extraControls(topBar) 或 extraPanel 机制。

import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import { buildVrmBoneTree } from "./vrm-bone.ts";
import {
  listBonesWithDepth,
  getBoneDetail,
  toggleBoneVisible,
  pickBone,
  type BoneTree,
} from "../bone-tools.ts";
import { t } from "../../../core/i18n/t.ts";

/** 骨骼面板上下文：core 外壳注入（extraPanel 标准契约） */
export interface VrmBonePanelCtx {
  /** 3D 视图容器（拾取联动：监听 click → raycaster） */
  viewContainer: HTMLElement;
  /** 相机（raycaster.setFromCamera 用） */
  camera: THREE.PerspectiveCamera;
  /** 场景根（raycaster.intersectObjects 目标） */
  scene: THREE.Object3D;
}

/** 骨骼面板渲染契约：返回清理函数（面板移除时调用） */
export type RenderVrmBonePanel = (panel: HTMLElement, ctx: VrmBonePanelCtx) => () => void;

/**
 * 通用骨骼面板渲染器（ADR-074 S3：从 VRM 专属抽通用版，喂 BoneTree 而非 VRM）。
 * VRM/YSM 均用此函数——VRM 经 buildVrmBoneTree 构树后喂入，YSM 从 spec bones 构树后喂入。
 */
export function makeBonePanelRenderer(tree: BoneTree | null): RenderVrmBonePanel {
  return (panel: HTMLElement, ctx: VrmBonePanelCtx): () => void => {
    let activeId: string | null = null; // 拾取联动高亮项
    let disposed = false;

    // --- 列表 + 详情双栏 ---
    panel.innerHTML = "";
    panel.style.cssText +=
      ";display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px";

    const listCol = document.createElement("div");
    listCol.style.cssText = "overflow:auto;max-height:100%;font-size:11px";
    const detailCol = document.createElement("div");
    detailCol.style.cssText =
      "overflow:auto;max-height:100%;font-size:11px;color:rgba(255,255,255,0.7);border-left:1px solid rgba(255,255,255,0.1);padding-left:4px";
    panel.appendChild(listCol);
    panel.appendChild(detailCol);

    const renderList = (): void => {
      if (!tree) return;
      listCol.innerHTML = "";
      const items = listBonesWithDepth(tree);
      for (const item of items) {
        const row = document.createElement("div");
        row.style.cssText = `display:flex;align-items:center;gap:4px;padding-left:${item.depth * 12}px;cursor:pointer`;
        if (activeId === item.id) row.style.background = "rgba(124,131,255,0.25)";
        row.dataset.boneId = item.id;

        // 显隐勾选框
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = true;
        cb.style.cssText = "flex-shrink:0;cursor:pointer";
        cb.onchange = (): void => {
          if (!tree) return;
          const node = tree.byId.get(item.id);
          toggleBoneVisible(node);
        };
        // 点击勾选框不触发行选中（避免与拾取联动抢焦点）
        cb.onclick = (e): void => e.stopPropagation();

        const label = document.createElement("span");
        label.textContent = item.name;
        label.style.cssText = "flex:1";

        row.appendChild(cb);
        row.appendChild(label);

        // 行点击：选中 + 显示详情
        row.onclick = (): void => {
          activeId = item.id;
          renderList();
          renderDetail();
        };

        listCol.appendChild(row);
      }
    };

    const renderDetail = (): void => {
      if (!tree || !activeId) {
        detailCol.innerHTML = `<div style="color:rgba(255,255,255,0.4)">${t("preview.bone.selectHint")}</div>`;
        return;
      }
      const d = getBoneDetail(activeId, tree);
      if (!d) return;
      detailCol.innerHTML = "";
      const field = (k: string, v: string): void => {
        const r = document.createElement("div");
        r.style.cssText = "margin-bottom:4px";
        // k/v 经 textContent 注入（innerHTML 拼接会把骨骼名/路径中的
        // <>& 当 HTML 解析——注入/破版风险），span 样式保留
        const span = document.createElement("span");
        span.style.color = "rgba(255,255,255,0.4)";
        span.textContent = k;
        r.appendChild(span);
        r.appendChild(document.createTextNode(": " + v));
        detailCol.appendChild(r);
      };
      field("名称", d.name);
      field("路径", d.path);
      field(
        "坐标",
        d.position ? `(${d.position.x.toFixed(2)}, ${d.position.y.toFixed(2)}, ${d.position.z.toFixed(2)})` : "—",
      );
      field("父骨骼", d.parent ? `${d.parent.name} (${d.parent.id})` : "—（根）");
      field(
        "子骨骼",
        d.children.length ? d.children.map((c) => c.name).join("、") : "—",
      );
    };

    renderList();
    renderDetail();

    // --- 拾取联动：viewContainer click → raycaster 命中 → 高亮 + 详情 ---
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const onPick = (ev: MouseEvent): void => {
      if (!tree || disposed) return;
      const rect = ctx.viewContainer.getBoundingClientRect();
      ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, ctx.camera);
      const hit = pickBone(raycaster, [ctx.scene], tree);
      if (hit) {
        activeId = hit.node.id;
        renderList();
        renderDetail();
      }
    };
    ctx.viewContainer.addEventListener("click", onPick);

    return (): void => {
      disposed = true;
      ctx.viewContainer.removeEventListener("click", onPick);
      tree = null;
    };
  };
}

/**
 * 构造 VRM 骨骼面板渲染器（extraPanel 呑约）。
 * 用法：vrm-adapter 的 buildVrmScene 把本函数的返回值挂到 PreviewScene.extraPanel。
 * 内部 lazy 构建骨骼树（VRM 加载完成后才有 humanoid），拾取联动挂载在 viewContainer click。
 */
function makeVrmBonePanelRenderer(vrm: VRM): RenderVrmBonePanel {
  return makeBonePanelRenderer(buildVrmBoneTree(vrm));
}
