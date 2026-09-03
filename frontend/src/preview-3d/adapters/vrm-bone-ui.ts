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
import { t } from "../../core/i18n/t.ts";

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
 *
 * 布局：单列 slide-item 行（与材质/截图面板同构），点击行原地展开详情块。
 * 不再用双栏 grid——那与根菜单 SlideMenu 单列导航风格冲突。
 */
/**
 * 骨骼行高亮背景（刀②收编：硬编码 rgba(124,131,255) → --accent 派生）。
 * 纯函数便于测试直断字符串——happy-dom 的 CSS 解析器不认 color-mix()，DOM 级 background 会丢声明。
 */
export function boneRowActiveBg(): string {
  return "color-mix(in srgb,var(--accent) 25%,transparent)";
}

export function makeBonePanelRenderer(tree: BoneTree | null): RenderVrmBonePanel {
  return (panel: HTMLElement, ctx: VrmBonePanelCtx): (() => void) => {
    let activeId: string | null = null; // 拾取联动高亮项
    let disposed = false;

    panel.innerHTML = "";
    panel.style.cssText += ";padding:4px;font-size:11px";

    if (!tree || tree.roots.length === 0) {
      const empty = document.createElement("div");
      empty.className = "slide-sublabel";
      empty.style.cssText = "padding:8px 10px;color:rgba(128,128,128,0.85);font-size:12px";
      empty.textContent = t("preview.bone.empty");
      panel.appendChild(empty);
      return (): void => {
        disposed = true;
        tree = null;
      };
    }

    // 详情容器：插在选中行下方，点击其他行时移到新位置
    let detailEl: HTMLDivElement | null = null;

    const renderList = (): void => {
      if (!tree) return;
      panel.innerHTML = "";

      const items = listBonesWithDepth(tree);
      for (const item of items) {
        const row = document.createElement("div");
        row.className = "slide-item";
        row.dataset.boneId = item.id;
        row.dataset.active = activeId === item.id ? "1" : "0"; // 测试钩子（happy-dom 丢 color-mix 时仍可断言高亮）
        row.style.cssText = `display:flex;align-items:center;gap:6px;padding-left:${item.depth * 12 + 6}px;cursor:pointer;min-height:28px;border-radius:4px`;
        if (activeId === item.id) row.style.background = boneRowActiveBg();

        // 显隐勾选框
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = true;
        cb.style.cssText = "flex-shrink:0;cursor:pointer;accent-color:var(--accent,#7c83ff)";
        cb.onchange = (): void => {
          if (!tree) return;
          const node = tree.byId.get(item.id);
          toggleBoneVisible(node);
        };
        // 点击勾选框不触发行选中（避免与拾取联动抢焦点）
        cb.onclick = (e): void => e.stopPropagation();

        const label = document.createElement("span");
        label.className = "slide-label";
        label.textContent = item.name;
        label.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";

        row.append(cb, label);

        // 行点击：选中 + 重渲染（重渲染时选中行下方插入详情块）
        row.onclick = (): void => {
          activeId = item.id;
          renderList();
        };

        panel.appendChild(row);

        // 选中行：紧随其后插入详情块
        if (activeId === item.id) {
          panel.appendChild(renderDetail());
        }
      }
    };

    const renderDetail = (): HTMLDivElement => {
      const d = document.createElement("div");
      d.className = "bone-detail-inline";
      d.style.cssText = "padding:6px 10px;background:rgba(255,255,255,0.04);border-radius:4px;margin:2px 4px 4px;font-size:10px;color:rgba(255,255,255,0.7);border-left:2px solid var(--accent,#7c83ff)";

      if (!tree || !activeId) {
        d.innerHTML = `<div style="color:rgba(255,255,255,0.4)">${t("preview.hint.clickBone")}</div>`;
        return d;
      }
      const det = getBoneDetail(activeId, tree);
      if (!det) return d;

      const field = (k: string, v: string): void => {
        const r = document.createElement("div");
        r.style.cssText = "margin-bottom:3px";
        const span = document.createElement("span");
        span.style.color = "rgba(255,255,255,0.4)";
        span.textContent = k;
        r.appendChild(span);
        r.appendChild(document.createTextNode(": " + v));
        d.appendChild(r);
      };
      field("名称", det.name);
      field("路径", det.path);
      field(
        "坐标",
        det.position ? `(${det.position.x.toFixed(2)}, ${det.position.y.toFixed(2)}, ${det.position.z.toFixed(2)})` : "—",
      );
      field("父骨骼", det.parent ? `${det.parent.name} (${det.parent.id})` : "—（根）");
      field(
        "子骨骼",
        det.children.length ? det.children.map((c) => c.name).join("、") : "—",
      );
      return d;
    };

    renderList();

    // --- 拾取联动：viewContainer click → raycaster 命中 → 高亮 ---
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
