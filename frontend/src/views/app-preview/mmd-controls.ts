// ===== MMD 菜单面板填充（ADR-076 v2 Phase 2：底部导航收编进声明式根菜单）=====
// 旧 buildMmdBottomNav / mkNavBtn / slide-menu 弹窗已删除——mmd 专属面板（模型信息+
// 表情 / 材质 / 播放）由 mmd-adapter 经 ctx.menu.setAdapterItems 注入 ⚙️ 根菜单。
// 切换模型归 core 根菜单 roles 项（角色面板内嵌加载入口）；相机归 core camera 项（sharedOnly）。
// 材质面板 buildMaterialControls 保留复用（纯渲染层，状态经 bridge 下沉 mmd-materials.ts，ADR-072）。

import { TOAST_MS } from "../../utils/dom/toast-ms.ts";
import * as THREE from "three";
import type { MMD } from "@moeru/three-mmd";
import { t } from "../../core/i18n/t.ts";
import { cardContainer, addFieldRow } from "../../ui/ui-helpers.ts";
import { bus } from "../../bus.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { saveScreenshot } from "./skeleton-render.ts";
import type { PreviewMenuNode } from "../../utils/3d/adapters/preview-menu-node-types.ts";
import { makeShotAction, shotButtonNodes } from "./shot-panel-shared.ts";
import {
  listMmdMaterials,
  getMmdMaterialDetail,
  setMmdMaterialVisible,
  setMmdMaterialOpacity,
  type MmdMaterialDetail,
  type MmdMaterialListItem,
} from "../../utils/3d/mmd-materials.ts";
import type { CameraControlBridge } from "../../utils/3d/adapters/camera-controls.ts";
export type { CameraControlBridge };

export interface MmdBottomNavCtx {
  mmd: MMD;
  mesh: THREE.SkinnedMesh;
  modelName: string;
  /** 当前模型完整路径（切换区「当前」高亮判断；Phase 2 后切换归 core switch 项，本字段保留兼容） */
  modelPath?: string;
  /** shared 模式下核心的相机控制桥（Phase 2 后相机归 core camera 项，本字段保留兼容） */
  cameraControls?: CameraControlBridge;
  /** 切换到另一模型（复用核心外壳重建内容层；Phase 2 后归 core switch 项，本字段保留兼容） */
  switchTo?(path: string): Promise<void>;
}

/** MMD 模型面板：信息卡（morph 列表已拆独立菜单项 fillMmdMorphPanel，对齐材质折叠模式） */
export function fillMmdModelPanel(list: HTMLElement, ctx: MmdBottomNavCtx): void {
  const pmx = ctx.mmd.pmx;
  cardContainer(list, (c) => {
    addFieldRow(c, t("preview.nameLabel"), ctx.modelName);
    addFieldRow(
      c,
      t("preview.modelOverview"),
      `${pmx.bones.length} 骨骼 · ${pmx.materials.length} 材质 · ${pmx.morphs.length} 表情`,
    );
  });
}

/**
 * [doc:adr-126-p4-b-1] MMD 模型信息面板——声明式节点版（通道验证）。
 * 纯数据：2 行 field（名称 + 骨骼/材质/表情计数），零 DOM。
 * adapter 的 model 面板节点带 `children: mmdModelInfoNodes(ctx)` → 渲染走 renderMenu（preview-menu-render.ts）。
 * fillMmdModelPanel 保留（向后兼容 + 既有测试零回归）；新面板路径走本函数。
 */
export function mmdModelInfoNodes(ctx: MmdBottomNavCtx): PreviewMenuNode[] {
  const pmx = ctx.mmd.pmx;
  return [
    { id: "mmd-model-name", kind: "field", labelKey: "preview.nameLabel", fallback: "名称", value: ctx.modelName },
    {
      id: "mmd-model-overview",
      kind: "field",
      labelKey: "preview.modelOverview",
      fallback: "模型",
      value: `${pmx.bones.length} 骨骼 · ${pmx.materials.length} 材质 · ${pmx.morphs.length} 表情`,
    },
  ];
}

/** MMD 表情面板（morph 权重 0/1 切换，✓ 高亮当前开启；独立菜单项，避免 84+ 行平铺模型面板） */
export function fillMmdMorphPanel(list: HTMLElement, ctx: MmdBottomNavCtx): void {
  const morphNames = Object.keys(ctx.mesh.morphTargetDictionary || {});
  if (morphNames.length === 0) {
    const empty = document.createElement("div");
    empty.className = "slide-sublabel";
    empty.style.cssText = "padding:8px 10px;color:rgba(128,128,128,0.85);font-size:12px";
    empty.textContent = t("preview.noOtherMorph");
    list.appendChild(empty);
    return;
  }
  const sec = document.createElement("div");
  sec.className = "slide-sublabel";
  sec.style.cssText = "padding:6px 10px;font-size:12px;color:rgba(255,255,255,0.7)";
  sec.textContent = `😀 ${t("preview.mmdMorph")} (${morphNames.length})`;
  list.appendChild(sec);
  morphNames.forEach((name) => {
    const row = document.createElement("div");
    row.className = "ysm-preview-menu-row";
    row.dataset.testid = "mmd-morph-" + name;
    const dict = ctx.mesh.morphTargetDictionary || {};
    const idx = dict[name];
    const active = idx !== undefined && (ctx.mesh.morphTargetInfluences?.[idx] ?? 0) > 0.5;
    const ic = document.createElement("span");
    ic.textContent = active ? "✓" : "🙂";
    ic.style.cssText = "font-size:15px;width:18px;text-align:center";
    const lb = document.createElement("span");
    lb.textContent = name;
    row.append(ic, lb);
    row.style.cssText =
      "display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:8px;cursor:pointer;font-size:13px" +
      (active ? ";background:var(--mmd-morph-active-bg)" : "");
    row.onclick = (): void => {
      const d = ctx.mesh.morphTargetDictionary || {};
      const i = d[name];
      if (i === undefined || !ctx.mesh.morphTargetInfluences) return;
      ctx.mesh.morphTargetInfluences[i] = ctx.mesh.morphTargetInfluences[i] > 0.5 ? 0 : 1;
      const now = ctx.mesh.morphTargetInfluences[i] > 0.5;
      ic.textContent = now ? "✓" : "🙂";
      row.style.background = now ? "var(--mmd-morph-active-bg)" : "transparent";
    };
    list.appendChild(row);
  });
}

/** MMD 播放/动作控制桥（mmd-adapter 组装，纯逻辑层状态） */
export interface MmdPlayBridge {
  clips: Array<{ label: string }>;
  isPlaying(): boolean;
  toggle(): void;
  currentIndex(): number;
  select(index: number): void;
  /** 自动解析的 CustomAnim 路径（null = 仓库根不可用） */
  animDir: string | null;
  /** 请求重新加载动作（刷新 CustomAnim 目录扫描结果） */
  requestReload?: () => void;
}

/** MMD 播放面板：播放/暂停 + 多动作切换 + 空态提示 */
export function fillMmdPlayPanel(list: HTMLElement, bridge: MmdPlayBridge): void {
  if (bridge.clips.length === 0) {
    // ---- 空态：提示用户在 CustomAnim 目录放置 VMD 文件 ----
    const emptySec = document.createElement("div");
    emptySec.style.cssText = "padding:12px 10px;display:flex;flex-direction:column;gap:8px";
    const hint = document.createElement("div");
    hint.style.cssText = "font-size:12px;color:rgba(255,255,255,0.6);line-height:1.6";
    if (bridge.animDir) {
      hint.textContent = `动作库目录：${bridge.animDir}（暂无 VMD/VPD 文件，请将动作文件放入此目录）`;
    } else {
      hint.textContent = "当前模型无内置动作。请将 VMD/VPD 动作放入仓库的 CustomAnim 子目录。";
    }
    emptySec.appendChild(hint);

    const refreshBtn = document.createElement("button");
    refreshBtn.className = "pv-btn";
    refreshBtn.textContent = "重新扫描";
    refreshBtn.style.cssText = "font-size:12px;padding:4px 10px;align-self:flex-start";
    refreshBtn.onclick = () => { bridge.requestReload?.(); };
    emptySec.appendChild(refreshBtn);
    list.appendChild(emptySec);
    return;
  }

  // ---- 正常态：播放控件 ----
  const playBtn = document.createElement("button");
  playBtn.id = "mmd-play-btn";
  playBtn.textContent = bridge.isPlaying() ? t("preview.mmdPause") : t("preview.mmdPlay");
  playBtn.className = "mode-btn";
  playBtn.dataset.testid = "mmd-play";
  playBtn.style.cssText = "align-self:flex-start;margin:2px 0";
  playBtn.onclick = (): void => {
    bridge.toggle();
    playBtn.textContent = bridge.isPlaying() ? t("preview.mmdPause") : t("preview.mmdPlay");
  };
  list.appendChild(playBtn);

  if (bridge.clips.length > 1) {
    const sel = document.createElement("select");
    sel.id = "mmd-motion-sel";
    sel.className = "setting-select";
    sel.dataset.testid = "mmd-motion";
    sel.value = String(bridge.currentIndex());
    bridge.clips.forEach((c, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = c.label;
      sel.appendChild(opt);
    });
    sel.onchange = (): void => {
      bridge.select(Number(sel.value) || 0);
    };
    list.appendChild(sel);
  }

  // 已配置动作库时显示路径提示
  if (bridge.animDir) {
    const dirRow = document.createElement("div");
    dirRow.style.cssText = "padding:6px 10px;display:flex;align-items:center;gap:6px";
    const dirLabel = document.createElement("span");
    dirLabel.style.cssText = "font-size:10px;color:rgba(255,255,255,0.4);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
    dirLabel.textContent = `动作库: ${bridge.animDir}`;
    dirRow.appendChild(dirLabel);
    list.appendChild(dirRow);
  }
}

/** 材质控制桥：复用 mmd-materials.ts 纯逻辑层（显隐/透明/详情），DOM 渲染在视图层（ADR-072） */
export interface MaterialControlBridge {
  /** 材质清单（index 与 mesh.material 对齐） */
  list(): MmdMaterialListItem[];
  /** 材质详情（当前可见/透明） */
  getDetail(index: number): MmdMaterialDetail | null;
  /** 设置显隐（Material.visible） */
  setVisible(index: number, visible: boolean): void;
  /** 设置透明度（0-1，联动 transparent） */
  setOpacity(index: number, opacity: number): void;
}

/**
 * [doc:adr-126-p4-b-2] MMD 截图面板——声明式节点版。
 * 共享逻辑在 shot-panel-shared.ts（SHOT_KEYS/SHOT_LABELS/makeShotAction/shotButtonNodes），
 * 此处只做 MMD 前缀 id 包装（`mmd-shot-*`）+ 能力缺失守卫（screenshotFn null → []）。
 * fillMmdShotPanel 保留（向后兼容）；新面板路径走本函数。
 */
export function mmdShotNodes(
  ctx: MmdBottomNavCtx,
  screenshotFn: (() => Promise<string | null>) | null,
): PreviewMenuNode[] {
  if (!screenshotFn) return [];
  return shotButtonNodes(
    { boneCount: 0, cubeCount: 0, texWidth: 0, texHeight: 0, bones: [], _modelPath: ctx.modelPath, texture: "" },
    screenshotFn,
  ).map((n) => ({ ...n, id: `mmd-${n.id}` }));
}

/**
 * MMD 截图面板填充（ADR-052 P3：对齐 ysm-controls fillYsmShotPanel 范式）。
 * current / front / 45 / side / back45 / all 六角度——all 走 saveScreenshot 的 angle 路径。
 * @param screenshotFn 适配器注入的截图能力（screenshotFromRenderer 共享 renderer），null 时面板不渲染
 */
export function fillMmdShotPanel(
  list: HTMLElement,
  ctx: MmdBottomNavCtx,
  screenshotFn: (() => Promise<string | null>) | null,
): void {
  if (!screenshotFn) return;
  const saveShot = makeShotAction(
    { boneCount: 0, cubeCount: 0, texWidth: 0, texHeight: 0, bones: [], _modelPath: ctx.modelPath, texture: "" },
    screenshotFn,
  );
  for (const key of ["current", "front", "45", "side", "back45", "all"] as const) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "ysm-3d-popbtn ysm-3d-popbtn--row";
    item.textContent = "📷 " + t("preview.screenshot" + key[0].toUpperCase() + key.slice(1));
    item.dataset.testid = "shot-" + key;
    item.onclick = (): void => {
      void saveShot(key);
    };
    list.appendChild(item);
  }
}
