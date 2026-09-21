// ===== Litematic 体素 3D 内容适配器（ADR-066 P3：从 litematic-3d.ts 抽离内容层）=====
// 本文件只负责体素专属逻辑：经 Go 绑定取 voxel JSON → 按空间分块建 InstancedMesh →
// 分层切片面板（schema builder 注册，ADR-126 P5 收口）+ 灯光 + GridHelper + 包围盒定相机。
// 通用外壳（overlay/renderer/循环/释放/相机控制）由 mount-preview-core.ts 拥有。

import * as THREE from "three";
import type { LocaleKey } from "@/core/i18n/t.ts";
import { t } from "@/core/i18n/t.ts";
import type { VoxelData } from "@/parsers/voxel-types.ts";
import { requireSharedInfra } from "@/preview-3d/adapters/shared/shared-infra.ts";
import { registerModelRoot, unregisterModelRoot } from "@/preview-3d/infra/frustum-cull.ts";
import { recordLoadTrace, TRACE_FORMAT_OTHER } from "@/preview-3d/infra/load-trace.ts";
import { installOnceStyles } from "@/preview-3d/infra/overlay-style-bridge.ts";
import { renderLoadingState } from "@/preview-3d/infra/preview-loading.ts";
import { safeDispose } from "@/preview-3d/infra/safe-dispose.ts";
import type { SchemaBuilder } from "@/preview-3d/infra/schema-registry.ts";
import { registerSchema, unregisterSchema } from "@/preview-3d/infra/schema-registry.ts";
import { multiModelSelectNode } from "@/preview-3d/menu/panels/multi-model.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/node-types.ts";
import { screenshotFromRenderer } from "@/preview-3d/screenshot/screenshot.ts"; // ADR-052 P3：截图走共享 renderer（通用化）
import type { PreviewSnapshot } from "@/preview-3d/state/preview-state.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import type {
  PreviewAdapter,
  PreviewBuildCtx,
  PreviewScene,
  ScreenshotScene,
} from "./mount-preview-core.ts";

// 提取魔法数值常量（体素尺寸 / 默认色 / chunk 维 / 截断上限）
/** litematic 截断警告条样式(P1 批次11:cssText 抽类;插 ctx.overlay——ADR-175 M1 后为 overlay shadow root,ensureMdliStyles 经桥注入同域) */
const mdliCss = `
.mdli-trunc-warn { padding:6px 12px; background:var(--status-warning,#ffa050); color:var(--status-warning,#ffa050); font-size:var(--fs-base); text-align:center; flex-shrink:0; }
`;
function ensureMdliStyles(): void {
  installOnceStyles("mdli", mdliCss);
}

const CHUNK_SIZE = 32; // 空间分块维：每 chunk 持一个 InstancedMesh，32³ ≈ 32k 方块上限
const DEFAULT_VOXEL_COLOR = "#7F7F7F"; // group 缺色时兜底色
const FALLBACK_MAX_BLOCKS = 200000; // data.maxBlocks 缺席时的展示上限

// ===== 类型提级（闭包共享状态 → 包级接口，避免自由变量）=====

interface SizeInfo {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  // centerX/Y/Z 与 maxDim 已删（2026-09-21）：setupCameraAndGrid 里它们是**函数内局部 const**
  // （相机定位/看向/网格尺寸直接用），存进 SizeInfo 后零消费者——真冗余，不是「留待将来」。
  // 需要它们时从 sizeX/Y/Z 现算即可（center = size/2，maxDim = max(...,10)），别再存一份。
  xChunks: number;
  yChunks: number;
  // zChunks 同理已删：索引数学只用 xChunks/yChunks（见本文件 linear 索引处），
  // 分块是 x-y 平面切片，z 方向的 chunk 数在本适配器里从不参与定位。
  grid: THREE.GridHelper;
}

interface LitematicMeshSet {
  modelGroup: THREE.Group;
  instancedMeshes: Array<THREE.InstancedMesh>;
  materials: Array<THREE.MeshLambertMaterial>;
  groupMeshes: Array<Array<{ mesh: THREE.InstancedMesh; ck: number }>>;
  boxGeo: THREE.BoxGeometry;
  grid: THREE.GridHelper;
}

interface LayerShell {
  layerAxis: number;
  layerMax: number;
  layerVal: number;
  layerVal2: number;
  /** 切片模式（all/single/range）——场景级会话态：随 shell 闭包生灭，不入全局状态层
   *  （P5 复盘：全局单值 + 任一 dispose 重置会跨场景误伤；真源 per-scene 化后无此问题） */
  mode: string;
}

// ===== 阶段①：入口守卫 + 路径读取 + 数据解析 =====

function showLoading(ctx: PreviewBuildCtx): void {
  renderLoadingState(ctx.loadingEl, "🧊", "preview.loadingVoxels");
}

type LoadResult = { ok: true; data: VoxelData } | { ok: false; earlyResult: PreviewScene };

async function loadAndParseData(
  ctx: PreviewBuildCtx,
  path: string,
  voxelCall: (path: string) => Promise<VoxelData | null>,
): Promise<LoadResult> {
  const data = await voxelCall(path);
  if (!data?.groups?.length) {
    ctx.loadingEl.innerHTML = `<div style="font-size:32px">${UI_ICONS.warning}</div><div>${t("preview.voxelEmpty")}</div>`;
    return { ok: false, earlyResult: { dispose() {} } };
  }
  return { ok: true, data };
}

// ===== 阶段②：相机 + GridHelper 设置 =====

function setupCameraAndGrid(ctx: PreviewBuildCtx, data: VoxelData): SizeInfo {
  const sizeX = data.size[0] || 10;
  const sizeY = data.size[1] || 10;
  const sizeZ = data.size[2] || 10;
  const centerX = sizeX / 2;
  const centerY = sizeY / 2;
  const centerZ = sizeZ / 2;
  const maxDim = Math.max(sizeX, sizeY, sizeZ, 10);
  ctx.camera?.position.set(centerX + maxDim * 1.5, centerY + maxDim, centerZ + maxDim * 1.5);
  ctx.camera?.lookAt(centerX, centerY, centerZ);
  ctx.controls?.target.set(centerX, centerY, centerZ);
  requireSharedInfra(ctx).controls.minDistance = 1;
  requireSharedInfra(ctx).controls.maxDistance = maxDim * 8;
  ctx.controls?.update();
  const gridSize = Math.ceil(maxDim / 10) * 10;
  const grid = new THREE.GridHelper(gridSize, Math.min(gridSize, 50), 0x6666aa, 0x444488);
  grid.position.set(centerX, 0, centerZ);
  ctx.scene?.add(grid);
  return {
    sizeX,
    sizeY,
    sizeZ,
    xChunks: Math.ceil(sizeX / CHUNK_SIZE),
    yChunks: Math.ceil(sizeY / CHUNK_SIZE),
    grid,
  };
}

// ===== 阶段③：voxel 构建 + 材质纹理映射 =====

/** 常值哨兵陷阱（#17）：[0,0,0] 是合法坐标，不可 `|| 0` 兜底。非法条目整条丢弃。 */
function isValidPos(p: number[]): boolean {
  return (
    Array.isArray(p) &&
    p.length >= 3 &&
    Number.isFinite(p[0]) &&
    Number.isFinite(p[1]) &&
    Number.isFinite(p[2])
  );
}

/** blockState→texture atlas 映射（当前：group.color 兜底；命名预留后续 atlas 扩展） */
function resolveBlockTexture(groupColor: string | undefined): THREE.MeshLambertMaterial {
  let color = groupColor || DEFAULT_VOXEL_COLOR;
  try {
    new THREE.Color(color);
  } catch {
    // 非法 CSS 颜色（如 "#GGG" / 空串）→ 兜底色，防静默渲染黑色
    color = DEFAULT_VOXEL_COLOR;
  }
  return new THREE.MeshLambertMaterial({ color });
}

/** 三维 voxel 核心：按 group→chunk 分块，每 chunk 独立 InstancedMesh（GPU 友好） */
function buildBlockMesh(
  ctx: PreviewBuildCtx,
  data: VoxelData,
  sizeInfo: SizeInfo,
): LitematicMeshSet {
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const modelGroup = new THREE.Group();
  ctx.scene?.add(modelGroup);
  registerModelRoot(modelGroup);
  const instancedMeshes: Array<THREE.InstancedMesh> = [];
  const materials: Array<THREE.MeshLambertMaterial> = [];
  const groupMeshes: Array<Array<{ mesh: THREE.InstancedMesh; ck: number }>> = [];
  for (const group of data.groups ?? []) {
    const gMeshes: Array<{ mesh: THREE.InstancedMesh; ck: number }> = [];
    groupMeshes.push(gMeshes);
    if (!group.positions?.length) continue;
    const chunkMap = new Map<number, number[][]>();
    for (let i = 0; i < group.positions.length; i++) {
      const p = group.positions[i];
      if (!isValidPos(p)) continue;
      const cx = Math.floor(p[0] / CHUNK_SIZE);
      const cy = Math.floor(p[1] / CHUNK_SIZE);
      const cz = Math.floor(p[2] / CHUNK_SIZE);
      const ck = cx + cy * sizeInfo.xChunks + cz * sizeInfo.xChunks * sizeInfo.yChunks;
      let arr = chunkMap.get(ck);
      if (!arr) {
        arr = [];
        chunkMap.set(ck, arr);
      }
      arr.push(p);
    }
    const mat = resolveBlockTexture(group.color);
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
  return { modelGroup, instancedMeshes, materials, groupMeshes, boxGeo, grid: sizeInfo.grid };
}

// ===== 阶段④：分层切片（schema builder 注册 + applyLayer 体素过滤）=====

function chunkKey(p: number[], sizeInfo: SizeInfo): number {
  const cx = Math.floor(p[0] / CHUNK_SIZE);
  const cy = Math.floor(p[1] / CHUNK_SIZE);
  const cz = Math.floor(p[2] / CHUNK_SIZE);
  return cx + cy * sizeInfo.xChunks + cz * sizeInfo.xChunks * sizeInfo.yChunks;
}

function applyLayerFilter(
  shell: LayerShell,
  sizeInfo: SizeInfo,
  rawGroups: VoxelData["groups"],
  groupMeshes: LitematicMeshSet["groupMeshes"],
  mode: string,
): void {
  const dummy = new THREE.Object3D();
  const target = shell.layerVal - 1;
  const lo = shell.layerVal - 1;
  const hi = shell.layerVal2 > shell.layerVal ? shell.layerVal2 : shell.layerVal;
  for (let g = 0; g < (rawGroups ?? []).length; g++) {
    const positions = rawGroups?.[g]?.positions;
    const meshes = groupMeshes[g] ?? [];
    if (!positions) continue; // 无顶点数据（rawGroups null / 索引越界）→ 无体素可写
    for (const { mesh, ck } of meshes) {
      let count = 0;
      for (let i = 0; i < positions.length; i++) {
        const p = positions[i];
        if (!isValidPos(p)) continue;
        if (chunkKey(p, sizeInfo) !== ck) continue;
        if (mode === "single" && p[shell.layerAxis] !== target) continue;
        if (
          mode !== "all" &&
          mode !== "single" &&
          !(p[shell.layerAxis] >= lo && p[shell.layerAxis] < hi)
        )
          continue;
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

// ===== 分层切片面板（schema builder 声明式，ADR-126 P5 收口：renderCustom 逃生舱退役）=====

/** litematic 分层切片面板 schema 键前缀（生产路径 per-scene 拼接 sessionId——多模型并存防互相覆盖，
 *  5329a347 review P2：固定 key 会被第二场景静默覆盖、任一 dispose 误注销另一场景；
 *  无 sessionId 的测试/旧调用退化用递增实例号，见下方 SliceInstance） */
export const LITEMATIC_SLICE_SCHEMA_ID = "litematic-slice";
// 无 sessionId（测试/旧调用直挂 buildLitematicScene）时的退化计数；
// 生产路径（mount3D）恒带 sessionId → per-scene 稳定 key（对齐 ysm-model-{sid} 范式）
let SliceInstance = 0;

/** 轴下标 → 轴名（下标即 voxel 数据维度）；显示顺序保持旧 UI（Y 默认在前） */
const SLICE_AXES = ["X", "Y", "Z"];
const SLICE_AXIS_OPTIONS = [
  { value: "Y", label: "Y" },
  { value: "X", label: "X" },
  { value: "Z", label: "Z" },
];

/** 合法切片模式白名单（select set 闭包防御非法值） */
const SLICE_MODES = ["all", "single", "range"];

/** 层号收敛 [1, layerMax]（非法输入回落 max——沿用旧 clampLayerInput 语义） */
function clampLayer(n: number, layerMax: number): number {
  return Number.isFinite(n) ? Math.max(1, Math.min(layerMax, n)) : layerMax;
}

/** 分层切片面板 builder 工厂：闭包持 shell（轴/层值/模式会话态，全 per-scene），每次面板
 *  渲染重新执行——slider max 随轴切换保持新鲜（axis/mode select 均 refreshOnChange 触发）。
 *  快照参数不消费：动态数据全在闭包 shell（含模式），不入全局状态层。 */
function buildSliceSchema(
  sizeInfo: SizeInfo,
  rawGroups: VoxelData["groups"],
  groupMeshes: LitematicMeshSet["groupMeshes"],
): SchemaBuilder {
  const shell: LayerShell = {
    layerAxis: 1,
    layerMax: sizeInfo.sizeY,
    layerVal: sizeInfo.sizeY,
    layerVal2: sizeInfo.sizeY,
    mode: "all",
  };
  const applyLayer = (): void =>
    applyLayerFilter(shell, sizeInfo, rawGroups, groupMeshes, shell.mode);
  const resetToMax = (): void => {
    shell.layerMax = [sizeInfo.sizeX, sizeInfo.sizeY, sizeInfo.sizeZ][shell.layerAxis];
    shell.layerVal = shell.layerMax;
    shell.layerVal2 = shell.layerMax;
  };
  const layerSlider = (
    id: string,
    labelKey: LocaleKey,
    pick: "layerVal" | "layerVal2",
    visibleWhen: (s: Partial<PreviewSnapshot>) => boolean,
  ): PreviewMenuNode => ({
    id,
    kind: "slider",
    labelKey,
    visibleWhen,
    control: {
      min: 1,
      max: shell.layerMax,
      numeric: true,
      get: () => shell[pick],
      set: (v) => {
        shell[pick] = clampLayer(Number(v), shell.layerMax);
      },
      onChange: () => applyLayer(),
    },
  });
  return () => [
    { id: "slice-divider", kind: "divider" },
    {
      id: "slice-axis",
      kind: "select",
      labelKey: "preview.sliceAxis",
      control: {
        options: SLICE_AXIS_OPTIONS,
        get: () => SLICE_AXES[shell.layerAxis] ?? "Y",
        set: (raw) => {
          const i = SLICE_AXES.indexOf(String(raw));
          shell.layerAxis = i >= 0 ? i : 1;
          resetToMax();
          return raw;
        },
        onChange: () => applyLayer(),
        refreshOnChange: true,
      },
    },
    {
      id: "slice-mode",
      kind: "select",
      labelKey: "preview.sliceMode",
      control: {
        options: [
          { value: "all", labelKey: "preview.sliceModeAll" },
          { value: "single", labelKey: "preview.sliceModeSingle" },
          { value: "range", labelKey: "preview.sliceModeRange" },
        ],
        // 模式真源 = shell 闭包（场景级会话态，非全局状态层路径）——get/set 闭包模式
        // 与 MmdPlayBridge 动作 select 同构；slider visibleWhen 谓词读同一闭包
        get: () => shell.mode,
        set: (raw) => {
          shell.mode = SLICE_MODES.includes(String(raw)) ? String(raw) : "all";
          return shell.mode;
        },
        onChange: () => applyLayer(),
        refreshOnChange: true,
      },
    },
    layerSlider("slice-layer", "preview.sliceLayer", "layerVal", () => shell.mode === "single"),
    layerSlider(
      "slice-range-start",
      "preview.sliceRangeStart",
      "layerVal",
      () => shell.mode === "range",
    ),
    layerSlider(
      "slice-range-end",
      "preview.sliceRangeEnd",
      "layerVal2",
      () => shell.mode === "range",
    ),
  ];
}

/** 注册切片面板 builder + 产出 panel 入口节点（schemaId 是唯一渲染通道，契约禁双通道） */
function registerSliceSchema(
  sizeInfo: SizeInfo,
  rawGroups: VoxelData["groups"],
  groupMeshes: LitematicMeshSet["groupMeshes"],
  sliceKey: string, // per-scene 唯一 key（多模型并存防互相覆盖——5329a347 review P2）
): PreviewMenuNode {
  registerSchema(sliceKey, buildSliceSchema(sizeInfo, rawGroups, groupMeshes));
  return {
    id: "slice",
    icon: "unknown",
    labelKey: "preview.sliceControl",
    kind: "panel",
    dockGroup: "model",
    schemaId: sliceKey,
  };
}

// ===== 辅助：perf trace + truncated 警告 =====

function recordPerfTrace(path: string, tStart: number, data: VoxelData, format: string): void {
  try {
    recordLoadTrace({
      ts: Date.now(),
      format,
      path,
      stages: [{ name: "读取+构建", ms: Math.round(performance.now() - tStart), status: "ok" }],
      assets: { files: 1, textures: 0, materials: data.groups?.length ?? 0, animations: 0 },
      ok: true,
    });
  } catch {
    /* perf trace 失败不影响渲染 */
  }
}

function showTruncatedWarning(ctx: PreviewBuildCtx, data: VoxelData): void {
  if (!data.truncated) return;
  ensureMdliStyles(); // P1 批次11:cssText 抽类注入(幂等)
  const w = document.createElement("div");
  w.className = "mdli-trunc-warn";
  const max = data.maxBlocks || FALLBACK_MAX_BLOCKS;
  w.textContent = `⚠️ ${t("preview.blockLimit", { max: max.toLocaleString() })}`;
  ctx.overlay.insertBefore(w, ctx.overlay.children[1]);
}

// ===== 阶段⑤：PreviewScene 句柄装配 =====
// ADR-178 试点迁移（2026-09-04）：返回类型从 PreviewScene 收窄为 ScreenshotScene——
// litematic 是纯静态渲染 + 截图能力，无 update/applyPose/camera 控制；结构类型下
// ScreenshotScene 返回值可赋给 PreviewScene（其余字段可选），消费方零改动。

function buildResult(
  ctx: PreviewBuildCtx,
  meshSet: LitematicMeshSet,
  menuItems: PreviewMenuNode[],
  sliceKey: string,
): ScreenshotScene {
  return {
    menuItems,
    dispose(): void {
      unregisterSchema(sliceKey); // per-scene key：只注销自己的，多模型并存不误伤（5329a347 review P2）
      // 切片模式随 shell 闭包消亡——不动全局状态（P5 复盘：原 resetLitematicSliceMode
      // 重置全局单值，双场景下先关闭的会把后者的切片模式误重置回 all）
      // 先从 scene 移除，再 dispose GPU 资源（防 scene graph 残留导致 GC 无法回收）
      ctx.scene?.remove(meshSet.modelGroup);
      ctx.scene?.remove(meshSet.grid);
      unregisterModelRoot(meshSet.modelGroup);
      meshSet.instancedMeshes.forEach((m) => {
        safeDispose(m);
      });
      meshSet.materials.forEach((m) => {
        safeDispose(m);
      });
      meshSet.boxGeo.dispose();
      safeDispose(meshSet.grid);
    },
    screenshot: () =>
      Promise.resolve(
        screenshotFromRenderer(requireSharedInfra(ctx).renderer, ctx.scene, ctx.camera),
      ),
  };
}

// ===== Litematic 内容构建选项（ADR-132 遗留 1：蓝图/litematic zip 容器内多模型）=====
export interface LitematicBuildOpts {
  /** 容器路径（.zip 蓝图/投影包）；缺省 = 裸文件（path 即磁盘文件） */
  containerPath?: string;
  /** 容器内全部可切换 entry（如 ["a.nbt","b.litematic"]）；缺省 = 单模型无 select */
  modelEntries?: string[];
  /** 容器内条目扩展名（体素 RPC 分派，如 ".nbt"；缺省空 = 走默认 BuildVoxelDataFromRoot） */
  entryExt?: string;
}

/** Litematic 内容构建：把体素网格挂入核心 scene，返回 dispose + 分层切片面板钩子。
 *  voxelCall 由视图壳注入（对齐 ADR-072：适配器 0 backend import），经绑定名取 Go RPC。
 *  containerPath 存在时 path 即容器内 entry（虚拟路径），voxelCall 变体读取容器内字节。 */
export async function buildLitematicScene(
  ctx: PreviewBuildCtx,
  path: string,
  voxelCall: (path: string) => Promise<VoxelData | null>,
  opts?: LitematicBuildOpts,
): Promise<PreviewScene> {
  requireSharedInfra(ctx);
  const tStart = performance.now();
  showLoading(ctx);

  const loadRes = await loadAndParseData(ctx, path, voxelCall);
  if (!loadRes.ok) return loadRes.earlyResult;
  const { data } = loadRes;

  const sizeInfo = setupCameraAndGrid(ctx, data);
  const meshSet = buildBlockMesh(ctx, data, sizeInfo);

  ctx.loadingEl.remove();
  recordPerfTrace(path, tStart, data, ctx.adapterId ?? TRACE_FORMAT_OTHER);

  // [Bug A 收敛] per-scene key 以 sessionLedger 的 sessionId 为准（mount 层生成，per-mount
  // 稳定；switchTo 复用外壳不重新 mount，key 不变）——替代原模块级 SliceInstance 递增，
  // 对齐 ysm-adapter makeYsmModelSchemaId(sc.sessionId) 范式，key 空间统一。
  const sliceKey = ctx.sessionId
    ? `${LITEMATIC_SLICE_SCHEMA_ID}-${ctx.sessionId}`
    : `${LITEMATIC_SLICE_SCHEMA_ID}-${++SliceInstance}`; // 无 sessionId 退化（测试/旧调用）
  const sliceItems = [registerSliceSchema(sizeInfo, data.groups, meshSet.groupMeshes, sliceKey)];
  showTruncatedWarning(ctx, data);

  // [doc:adr-132] 多模型选择菜单项（容器内全部 entry；切 entry 走 core switchTo 重建）
  const menuItems: PreviewMenuNode[] = sliceItems;
  const entries = opts?.modelEntries ?? [];
  if (entries.length >= 2) {
    const select = multiModelSelectNode({
      entries: entries.map((e) => ({
        id: e,
        label: e.split(/[/\\]/).pop() || e,
      })),
      nodeId: "litematic-model-select",
      activeId: (): string => path,
      onSelect: (id: string): void => {
        if (ctx.switchTo && id) void ctx.switchTo(id);
      },
    });
    if (select) menuItems.push(select);
  }

  return buildResult(ctx, meshSet, menuItems, sliceKey);
}

/** Litematic 适配器工厂 deps（视图壳注入 voxel 数据读取——ADR-072：适配器 0 backend import） */
export interface LitematicAdapterDeps {
  /** 体素数据读取（裸文件或容器内条目均可——视图按路径上下文构造 voxelCall 闭包） */
  voxelCall: (path: string) => Promise<VoxelData | null>;
  /** 容器选项（ADR-132：zip 蓝图/投影包多模型）；缺省 = 裸文件单模型 */
  container?: LitematicBuildOpts;
}

/**
 * ADR-161 §2.5 工厂：Litematic/蓝图 挂载主入口（make<Format>Adapter 命名章程，对齐 mmd/vrm/ysm/fbx）。
 * voxelCall 以 deps 注入（视图层经 getApp 组装 RPC 闭包），adapters 层不反向依赖 views。
 * 用法：`const adapter = makeLitematicAdapter({ voxelCall, container? }); mount3D(adapter, entryPath)`
 */
export function makeLitematicAdapter(deps: LitematicAdapterDeps): PreviewAdapter {
  return {
    id: "litematic",
    build: (ctx, path) => buildLitematicScene(ctx, path, deps.voxelCall, deps.container),
  };
}
