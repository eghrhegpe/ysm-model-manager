// ===== Litematic 体素 3D 内容适配器（ADR-066 P3：从 litematic-3d.ts 抽离内容层）=====
// 本文件只负责体素专属逻辑：经 Go 绑定取 voxel JSON → 按空间分块建 InstancedMesh →
// 分层渲染 UI（axis/layer）+ 灯光 + GridHelper + 包围盒定相机。通用外壳
// （overlay/renderer/循环/释放/相机控制）由 mount-preview-core.ts 拥有。

import * as THREE from "three";
import { t } from "../../../core/i18n/t.ts";
import { screenshotFromRenderer } from "../screenshot.ts"; // ADR-052 P3：截图走共享 renderer（通用化）
import { registerModelRoot, unregisterModelRoot } from "../frustum-cull.ts";
import type { PreviewBuildCtx, PreviewScene } from "./mount-preview-core.ts";
import type { PreviewMenuNode } from "./preview-menu-node-types.ts";
import { recordLoadTrace } from "../load-trace.ts";
import { safeDispose } from "../safe-dispose.ts";
import { renderLoadingState } from "./preview-loading.ts";

/** 体素数据（GetLitematicVoxelData 等返回 JSON） */
interface VoxelData {
  groups: Array<{ positions: number[][]; color?: string }>;
  size: number[];
  truncated?: boolean;
  maxBlocks?: number;
}

// 提取魔法数值常量（体素尺寸 / 默认色 / chunk 维 / 截断上限）
const CHUNK_SIZE = 32; // 空间分块维：每 chunk 持一个 InstancedMesh，32³ ≈ 32k 方块上限
const DEFAULT_VOXEL_COLOR = "#7F7F7F"; // group 缺色时兜底色
const FALLBACK_MAX_BLOCKS = 200000; // data.maxBlocks 缺席时的展示上限

// ===== 类型提级（闭包共享状态 → 包级接口，避免自由变量）=====

interface MdLiSizeInfo {
  sizeX: number; sizeY: number; sizeZ: number;
  centerX: number; centerY: number; centerZ: number;
  maxDim: number;
  xChunks: number; yChunks: number; zChunks: number;
  grid: THREE.GridHelper;
}

interface MdLiBuiltMeshes {
  modelGroup: THREE.Group;
  instancedMeshes: Array<THREE.InstancedMesh>;
  materials: Array<THREE.MeshLambertMaterial>;
  groupMeshes: Array<Array<{ mesh: THREE.InstancedMesh; ck: number }>>;
  boxGeo: THREE.BoxGeometry;
  grid: THREE.GridHelper;
}

interface MdLiLayerShell {
  layerAxis: number;
  layerMax: number;
  layerVal: number;
  layerVal2: number;
}

interface MdLiLayerControlEls {
  sep: HTMLElement;
  axisLabel: HTMLElement;
  axisSel: HTMLSelectElement;
  layerMode: HTMLSelectElement;
  layerSlider: HTMLInputElement;
  layerInput: HTMLInputElement;
  layerSlider2: HTMLInputElement;
  layerInput2: HTMLInputElement;
}

// ===== 阶段①：入口守卫 + 路径读取 + 数据解析 =====

function mdLiShowLoading(ctx: PreviewBuildCtx): void {
  renderLoadingState(ctx.loadingEl, "🧊", "preview.loadingVoxels");
}

type MdLiLoadResult =
  | { ok: true; data: VoxelData }
  | { ok: false; earlyResult: PreviewScene };

async function mdLiLoadAndParseData(
  ctx: PreviewBuildCtx,
  path: string,
  voxelCall: (path: string) => Promise<string>,
): Promise<MdLiLoadResult> {
  const jsonStr = await voxelCall(path);
  const data = JSON.parse(jsonStr) as VoxelData & { error?: string };
  if (data.error) {
    ctx.loadingEl.innerHTML = "";
    const icon = document.createElement("div");
    icon.style.cssText = "font-size:32px";
    icon.textContent = "⚠️";
    const msg = document.createElement("div");
    msg.textContent = data.error;
    msg.style.cssText = "max-width:420px;word-break:break-all;text-align:center;opacity:0.85";
    ctx.loadingEl.append(icon, msg);
    return { ok: false, earlyResult: { dispose() {} } };
  }
  if (!data || !data.groups || !data.groups.length) {
    ctx.loadingEl.innerHTML = `<div style="font-size:32px">⚠️</div><div>${t("preview.voxelEmpty")}</div>`;
    return { ok: false, earlyResult: { dispose() {} } };
  }
  return { ok: true, data };
}

// ===== 阶段②：相机 + GridHelper 设置 =====

function mdLiSetupCameraAndGrid(ctx: PreviewBuildCtx, data: VoxelData): MdLiSizeInfo {
  const sizeX = data.size[0] || 10;
  const sizeY = data.size[1] || 10;
  const sizeZ = data.size[2] || 10;
  const centerX = sizeX / 2;
  const centerY = sizeY / 2;
  const centerZ = sizeZ / 2;
  const maxDim = Math.max(sizeX, sizeY, sizeZ, 10);
  ctx.camera!.position.set(centerX + maxDim * 1.5, centerY + maxDim, centerZ + maxDim * 1.5);
  ctx.camera!.lookAt(centerX, centerY, centerZ);
  ctx.controls!.target.set(centerX, centerY, centerZ);
  ctx.controls!.minDistance = 1;
  ctx.controls!.maxDistance = maxDim * 8;
  ctx.controls!.update();
  const gridSize = Math.ceil(maxDim / 10) * 10;
  const grid = new THREE.GridHelper(gridSize, Math.min(gridSize, 50), 0x6666aa, 0x444488);
  grid.position.set(centerX, 0, centerZ);
  ctx.scene!.add(grid);
  return {
    sizeX, sizeY, sizeZ,
    centerX, centerY, centerZ,
    maxDim,
    xChunks: Math.ceil(sizeX / CHUNK_SIZE),
    yChunks: Math.ceil(sizeY / CHUNK_SIZE),
    zChunks: Math.ceil(sizeZ / CHUNK_SIZE),
    grid,
  };
}

// ===== 阶段③：voxel 构建 + 材质纹理映射 =====

/** 常值哨兵陷阱（#17）：[0,0,0] 是合法坐标，不可 `|| 0` 兜底。非法条目整条丢弃。 */
function mdLiIsValidPos(p: number[]): boolean {
  return Array.isArray(p) && p.length >= 3 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]);
}

/** blockState→texture atlas 映射（当前：group.color 兜底；命名预留后续 atlas 扩展） */
function mdLiResolveBlockTexture(groupColor: string | undefined): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color: groupColor || DEFAULT_VOXEL_COLOR });
}

/** 三维 voxel 核心：按 group→chunk 分块，每 chunk 独立 InstancedMesh（GPU 友好） */
function mdLiBuildBlockMesh(
  ctx: PreviewBuildCtx,
  data: VoxelData,
  si: MdLiSizeInfo,
): MdLiBuiltMeshes {
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const modelGroup = new THREE.Group();
  ctx.scene!.add(modelGroup);
  registerModelRoot(modelGroup);
  const instancedMeshes: Array<THREE.InstancedMesh> = [];
  const materials: Array<THREE.MeshLambertMaterial> = [];
  const groupMeshes: Array<Array<{ mesh: THREE.InstancedMesh; ck: number }>> = [];
  for (const group of data.groups) {
    const gMeshes: Array<{ mesh: THREE.InstancedMesh; ck: number }> = [];
    groupMeshes.push(gMeshes);
    if (!group.positions || !group.positions.length) continue;
    const chunkMap = new Map<number, number[][]>();
    for (let i = 0; i < group.positions.length; i++) {
      const p = group.positions[i];
      if (!mdLiIsValidPos(p)) continue;
      const cx = Math.floor(p[0] / CHUNK_SIZE);
      const cy = Math.floor(p[1] / CHUNK_SIZE);
      const cz = Math.floor(p[2] / CHUNK_SIZE);
      const ck = cx + cy * si.xChunks + cz * si.xChunks * si.yChunks;
      let arr = chunkMap.get(ck);
      if (!arr) {
        arr = [];
        chunkMap.set(ck, arr);
      }
      arr.push(p);
    }
    const mat = mdLiResolveBlockTexture(group.color);
    materials.push(mat);
    const dummy = new THREE.Object3D();
    for (const [ck, chunkPositions] of chunkMap) {
      const mesh = new THREE.InstancedMesh(boxGeo, mat, chunkPositions.length);
      for (let i = 0; i < chunkPositions.length; i++) {
        const p = chunkPositions[i];
        dummy.position.set(p[0], p[1], p[2]);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      modelGroup.add(mesh);
      instancedMeshes.push(mesh);
      gMeshes.push({ mesh, ck });
    }
  }
  return { modelGroup, instancedMeshes, materials, groupMeshes, boxGeo, grid: si.grid };
}

// ===== 阶段④：层面板装配 + applyLayer 过滤 =====

function mdLiChunkKey(p: number[], si: MdLiSizeInfo): number {
  const cx = Math.floor(p[0] / CHUNK_SIZE);
  const cy = Math.floor(p[1] / CHUNK_SIZE);
  const cz = Math.floor(p[2] / CHUNK_SIZE);
  return cx + cy * si.xChunks + cz * si.xChunks * si.yChunks;
}

function mdLiApplyLayer(
  shell: MdLiLayerShell,
  si: MdLiSizeInfo,
  rawGroups: VoxelData["groups"],
  groupMeshes: MdLiBuiltMeshes["groupMeshes"],
  mode: string,
): void {
  const dummy = new THREE.Object3D();
  const target = shell.layerVal - 1;
  const lo = shell.layerVal - 1;
  const hi = shell.layerVal2 > shell.layerVal ? shell.layerVal2 : shell.layerVal;
  for (let g = 0; g < rawGroups.length; g++) {
    const positions = rawGroups[g].positions;
    const meshes = groupMeshes[g] ?? [];
    for (const { mesh, ck } of meshes) {
      let count = 0;
      for (let i = 0; i < positions.length; i++) {
        const p = positions[i];
        if (!mdLiIsValidPos(p)) continue;
        if (mdLiChunkKey(p, si) !== ck) continue;
        if (mode === "single" && p[shell.layerAxis] !== target) continue;
        if (mode !== "all" && mode !== "single" && !(p[shell.layerAxis] >= lo && p[shell.layerAxis] < hi)) continue;
        dummy.position.set(p[0], p[1], p[2]);
        dummy.updateMatrix();
        mesh.setMatrixAt(count, dummy.matrix);
        count++;
      }
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

function mdLiSetupRange(
  shell: MdLiLayerShell,
  si: MdLiSizeInfo,
  els: MdLiLayerControlEls,
): void {
  shell.layerMax = [si.sizeX, si.sizeY, si.sizeZ][shell.layerAxis];
  els.layerSlider.max = String(shell.layerMax);
  els.layerInput.max = String(shell.layerMax);
  els.layerSlider2.max = String(shell.layerMax);
  els.layerInput2.max = String(shell.layerMax);
}

function mdLiUpdateLayerUI(
  shell: MdLiLayerShell,
  si: MdLiSizeInfo,
  rawGroups: VoxelData["groups"],
  groupMeshes: MdLiBuiltMeshes["groupMeshes"],
  els: MdLiLayerControlEls,
): void {
  const m = els.layerMode.value;
  els.layerSlider.style.display = m === "all" ? "none" : "";
  els.layerInput.style.display = m === "all" ? "none" : "";
  els.layerSlider2.style.display = m === "range" ? "" : "none";
  els.layerInput2.style.display = m === "range" ? "" : "none";
  mdLiApplyLayer(shell, si, rawGroups, groupMeshes, m);
}

function mdLiClampLayerInput(input: HTMLInputElement, slider: HTMLInputElement, layerMax: number): number {
  const n = Number(input.value);
  const v = Number.isFinite(n) ? Math.max(1, Math.min(layerMax, n)) : layerMax;
  input.value = String(v);
  slider.value = String(v);
  return v;
}

function mdLiBuildLayerControls(
  ctx: PreviewBuildCtx,
  data: VoxelData,
  si: MdLiSizeInfo,
  groupMeshes: MdLiBuiltMeshes["groupMeshes"],
): PreviewMenuNode[] {
  const rawGroups = data.groups;
  const shell: MdLiLayerShell = {
    layerAxis: 1,
    layerMax: Math.max(si.sizeX, si.sizeY, si.sizeZ, 1),
    layerVal: 0,
    layerVal2: 0,
  };

  const sep = document.createElement("span");
  sep.style.cssText = "width:1px;height:16px;background:rgba(255,255,255,0.15);margin:0 4px";
  const axisLabel = document.createElement("span");
  axisLabel.style.cssText = "font-size:11px;color:rgba(255,255,255,0.5)";
  axisLabel.textContent = t("preview.sliceAxis") + ":";
  const axisSel = document.createElement("select");
  axisSel.style.cssText = "font-size:11px;padding:2px 4px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.8);cursor:pointer;font-family:inherit";
  ["Y", "X", "Z"].forEach((a) => {
    const o = document.createElement("option");
    o.value = a;
    o.textContent = a;
    axisSel.appendChild(o);
  });
  const layerMode = document.createElement("select");
  layerMode.style.cssText = "font-size:11px;padding:2px 4px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.8);cursor:pointer;font-family:inherit";
  [{ v: "all", t: "全部" }, { v: "single", t: "单层" }, { v: "range", t: "范围" }].forEach((m) => {
    const o = document.createElement("option");
    o.value = m.v;
    o.textContent = m.t;
    layerMode.appendChild(o);
  });
  const layerSlider = document.createElement("input");
  layerSlider.type = "range"; layerSlider.min = "1"; layerSlider.max = "100"; layerSlider.value = "100";
  layerSlider.style.cssText = "width:80px;margin:0 4px;cursor:pointer;accent-color:var(--accent,#7c83ff);display:none";
  const layerInput = document.createElement("input");
  layerInput.type = "number"; layerInput.min = "1"; layerInput.max = "100"; layerInput.value = "100";
  layerInput.style.cssText = "width:42px;font-size:11px;padding:1px 3px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.8);font-family:inherit;text-align:center;display:none";
  const layerSlider2 = document.createElement("input");
  layerSlider2.type = "range"; layerSlider2.min = "1"; layerSlider2.max = "100"; layerSlider2.value = "100";
  layerSlider2.style.cssText = "width:80px;margin:0 4px;cursor:pointer;accent-color:var(--accent,#7c83ff);display:none";
  const layerInput2 = document.createElement("input");
  layerInput2.type = "number"; layerInput2.min = "1"; layerInput2.max = "100"; layerInput2.value = "100";
  layerInput2.style.cssText = "width:42px;font-size:11px;padding:1px 3px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.8);font-family:inherit;text-align:center;display:none";

  const els: MdLiLayerControlEls = { sep, axisLabel, axisSel, layerMode, layerSlider, layerInput, layerSlider2, layerInput2 };

  axisSel.onchange = (): void => {
    shell.layerAxis = { X: 0, Y: 1, Z: 2 }[axisSel.value] ?? 1;
    mdLiSetupRange(shell, si, els);
    layerSlider.value = String(shell.layerMax);
    layerInput.value = String(shell.layerMax);
    layerSlider2.value = String(shell.layerMax);
    layerInput2.value = String(shell.layerMax);
    shell.layerVal = shell.layerMax;
    shell.layerVal2 = shell.layerMax;
    mdLiApplyLayer(shell, si, rawGroups, groupMeshes, layerMode.value);
  };
  layerSlider.oninput = (): void => {
    layerInput.value = layerSlider.value;
    shell.layerVal = Number(layerSlider.value);
    mdLiApplyLayer(shell, si, rawGroups, groupMeshes, layerMode.value);
  };
  layerInput.onchange = (): void => {
    const v = mdLiClampLayerInput(layerInput, layerSlider, shell.layerMax);
    shell.layerVal = v;
    mdLiApplyLayer(shell, si, rawGroups, groupMeshes, layerMode.value);
  };
  layerSlider2.oninput = (): void => {
    layerInput2.value = layerSlider2.value;
    shell.layerVal2 = Number(layerSlider2.value);
    mdLiApplyLayer(shell, si, rawGroups, groupMeshes, layerMode.value);
  };
  layerInput2.onchange = (): void => {
    const v = mdLiClampLayerInput(layerInput2, layerSlider2, shell.layerMax);
    shell.layerVal2 = v;
    mdLiApplyLayer(shell, si, rawGroups, groupMeshes, layerMode.value);
  };
  layerMode.onchange = (): void => {
    mdLiUpdateLayerUI(shell, si, rawGroups, groupMeshes, els);
  };

  mdLiSetupRange(shell, si, els);
  layerSlider.value = String(shell.layerMax);
  layerInput.value = String(shell.layerMax);
  layerSlider2.value = String(shell.layerMax);
  layerInput2.value = String(shell.layerMax);
  shell.layerVal = shell.layerMax;
  shell.layerVal2 = shell.layerMax;

  return litematicMenuItems(els);
}

// ===== 辅助：perf trace + truncated 警告 =====

function mdLiRecordPerfTrace(path: string, tStart: number, data: VoxelData): void {
  try {
    const blockCount = data.groups?.reduce((s, g) => s + (g.positions?.length ?? 0), 0) ?? 0;
    recordLoadTrace({
      ts: Date.now(),
      format: "litematic",
      path,
      stages: [{ name: "读取+构建", ms: Math.round(performance.now() - tStart), status: "ok" }],
      assets: { files: 1, textures: 0, materials: data.groups?.length ?? 0, animations: 0 },
      ok: true,
    });
  } catch { /* perf trace 失败不影响渲染 */ }
}

function mdLiShowTruncatedWarning(ctx: PreviewBuildCtx, data: VoxelData): void {
  if (!data.truncated) return;
  const w = document.createElement("div");
  w.style.cssText = "padding:6px 12px;background:rgba(207,83,0,0.3);color:#ffa64d;font-size:12px;text-align:center;flex-shrink:0";
  const max = data.maxBlocks || FALLBACK_MAX_BLOCKS;
  w.textContent = "⚠️ " + t("preview.blockLimit", { max: max.toLocaleString() });
  ctx.overlay.insertBefore(w, ctx.overlay.children[1]);
}

// ===== 阶段⑤：PreviewScene 句柄装配 =====

function mdLiBuildResult(
  ctx: PreviewBuildCtx,
  built: MdLiBuiltMeshes,
  menuItems: PreviewMenuNode[],
): PreviewScene {
  return {
    menuItems,
    dispose(): void {
      unregisterModelRoot(built.modelGroup);
      built.instancedMeshes.forEach((m) => safeDispose(m));
      built.materials.forEach((m) => safeDispose(m));
      built.boxGeo.dispose();
      safeDispose(built.grid);
    },
    screenshot: () => Promise.resolve(screenshotFromRenderer(ctx.renderer!, ctx.scene, ctx.camera)),
  };
}

/** Litematic 内容构建：把体素网格挂入核心 scene，返回 dispose + 分层控件钩子。
 *  voxelCall 由视图壳注入（对齐 ADR-072：适配器 0 backend import），经绑定名取 Go RPC。 */
export async function buildLitematicScene(
  ctx: PreviewBuildCtx,
  path: string,
  voxelCall: (path: string) => Promise<string>,
): Promise<PreviewScene> {
  const tStart = performance.now();
  mdLiShowLoading(ctx);

  const loadRes = await mdLiLoadAndParseData(ctx, path, voxelCall);
  if (!loadRes.ok) return loadRes.earlyResult;
  const { data } = loadRes;

  const si = mdLiSetupCameraAndGrid(ctx, data);
  const built = mdLiBuildBlockMesh(ctx, data, si);

  ctx.loadingEl.remove();
  mdLiRecordPerfTrace(path, tStart, data);

  const sliceItems = mdLiBuildLayerControls(ctx, data, si, built.groupMeshes);
  mdLiShowTruncatedWarning(ctx, data);

  return mdLiBuildResult(ctx, built, sliceItems);
}

// ===== litematic 菜单项（ADR-076 v2 Phase 3：分层控件收编进 ⚙️ 根菜单）=====

/** litematic 分层控件渲染参数（由 buildLitematicScene 传入已创建的 DOM 元素） */
interface LitematicMenuRenderArgs {
  sep: HTMLElement;
  axisLabel: HTMLElement;
  axisSel: HTMLSelectElement;
  layerMode: HTMLSelectElement;
  layerSlider: HTMLInputElement;
  layerInput: HTMLInputElement;
  layerSlider2: HTMLInputElement;
  layerInput2: HTMLInputElement;
}

/**
 * 构造 litematic 专属菜单项：
 * 分层切片调节（axis/layer 控件）作为 🧍 模型组的一个面板项，
 * 点击后弹出面板，内含轴选择 + 分层模式 + 滑块控件。
 */
export function litematicMenuItems(els: LitematicMenuRenderArgs): PreviewMenuNode[] {
  return [
    {
      id: "slice",
      icon: "🧊",
      labelKey: "preview.sliceControl",
      fallback: "分层切片",
      kind: "panel",
      dockGroup: "model",
      legacyTestId: "litematic-slice-entry",
      renderCustom:(list: HTMLElement) => {
        list.innerHTML = "";
        list.appendChild(els.sep);
        list.appendChild(els.axisLabel);
        list.appendChild(els.axisSel);
        list.appendChild(els.layerMode);
        list.appendChild(els.layerSlider);
        list.appendChild(els.layerInput);
        list.appendChild(els.layerSlider2);
        list.appendChild(els.layerInput2);
      },
    },
  ];
}
