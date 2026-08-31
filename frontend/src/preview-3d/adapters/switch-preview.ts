// ===== 3D 预览会话内模型切换（从 mount-preview-core.ts 抽出）=====
// 职责：复用外壳（renderer/rAF/controls/灯光）重建内容层（ADR-066 §5.6）
// 支持 keepInScene 同台追加模式。
//
// 拆分原则：switchTo 是 mount3D 内嵌闭包（_handle.switchTo 实现），
// 改为接受 SwitchContext 的纯函数，消除闭包耦合。
// 同时抽出重复的「重算包围盒 → 更新 lightCap target」逻辑为独立函数。

import { TOAST_MS } from "../../utils/dom/toast-ms.ts";
import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { bus } from "../../bus.ts";
import type { LightCapability } from "../caps/light-capability.ts";
import type { ShadowCapability } from "../caps/shadow-capability.ts";
import type { EnvironmentCapability } from "../caps/environment-capability.ts";
import type { CameraControlBridge } from "./camera-controls.ts";
import { safeDispose } from "../safe-dispose.ts";
import { showLoadFailure } from "./preview-loading.ts";
import { collectSceneStats } from "../scene-stats.ts";
import { mergeStatsMenuItems } from "../menu/stats.ts";
import type { PreviewMenuNode } from "../menu/node-types.ts";
import type { PreviewBuildCtx, PreviewHandle, PreviewScene } from "./mount-preview-core.ts";
import type { PreviewMenuHandle } from "../menu/core.ts";
import { sceneRegistry, MAX_MODELS } from "./scene-registry.ts";
import { fitCameraToRoots } from "../camera-setup.ts";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 会话内切换所需的外部上下文（原 mount3D 内嵌闭包变量） */
export interface SwitchContext {
  scene: THREE.Scene | undefined;
  /** 可变：build 后赋值为 scene.children 快照 */
  getSceneBaseline: () => Set<THREE.Object3D> | null;
  /**
   * 切换后更新基线快照：必须排除本次构建的内容层增量（保持「装饰基线」
   * 语义）——若把完整 scene 作基线，下次切换的 stale 差量会把旧模型视为
   * 基线、永不移除（幽灵网格累积）；同时防灯光/阴影遍历已释放的 detached 对象
   */
  setSceneBaseline?: (s: Set<THREE.Object3D>) => void;
  /** 可变：build 后赋值 */
  getBuilt: () => PreviewScene | null;
  setBuilt: (s: PreviewScene | null) => void;
  allBuilt: PreviewScene[];
  loadingEl: HTMLElement;
  viewContainer: HTMLElement;
  overlay: HTMLElement;
  menuHandle: PreviewMenuHandle;
  adapter: { build(ctx: PreviewBuildCtx, path: string): Promise<PreviewScene> };
  camBridge: CameraControlBridge | undefined;
  selfMode: boolean;
  renderer: THREE.WebGLRenderer | undefined;
  controls: OrbitControls | undefined;
  orbitTarget: THREE.Vector3 | undefined;
  camera: THREE.PerspectiveCamera | undefined;
  lightCap: LightCapability | null;
  shadowCap: ShadowCapability | null;
  environmentCap: EnvironmentCapability | null;
  /** 可变：build 后赋值 */
  getCurrentPath: () => string;
  setCurrentPath: (p: string) => void;
  /** 当前资源类型（注册表 rtype 用；mount3D 注入 opts.rtype ?? adapter.id） */
  getCurrentRtype: () => string;
  /** 当前子类型（如 EntityPlayer/CustomAnim；空串未知） */
  getCurrentSubtype?: () => string;
  /** 可变：build 后赋值 */
  getPerFrame: () => ((dt: number) => void) | null;
  setPerFrame: (f: ((dt: number) => void) | null) => void;
  /** 可变：_handle 构造后赋值 */
  getHandle: () => PreviewHandle | null;
  /** [Bug A] 当前 mount 会话稳定 id（mount3D 生成，会话内切换复用同一 id）——
   *  buildSwitchContent 转发给 adapter.build，per-scene schema key 前后一致 */
  sessionId?: string;
  /** 终止标志（引用对象，与 isDisposed 同构，避免按值捕获失效，见 r12 P2） */
  aborted: { v: boolean };
  /** 并发切换抑制：switchToSession 运行期间为 true，防止连续点击触发重复 build（r12 P1） */
  inFlight: boolean;
  isDisposed: { v: boolean };
  /** 代际守卫：切换时丢弃过期挂载 */
  myGen: number;
  getGen: () => number;
}

// ---------------------------------------------------------------------------
// 核心：会话内切换
// ---------------------------------------------------------------------------

/**
 * 会话内切换模型（复用外壳重建内容层）。
 * @param ctx       切换上下文（mount3D 内嵌变量统一经此注入）
 * @param newPath   目标模型路径
 * @param options   { keepInScene }——true 时不移除旧模型，追加到同一场景
 */
export async function switchToSession(
  ctx: SwitchContext,
  newPath: string,
  options?: { keepInScene?: boolean },
): Promise<void> {
  const keep = options?.keepInScene === true;
  // 入口守卫 + inFlight 置位（r12 P1 并发抑制 / P3-2 空路径 / ADR-093 T6 超量拦截）
  if (!beginSwitch(ctx, newPath, keep)) return;

  // 清理旧内容层 + 重建新内容层（build 失败进 recoverSwitchFailure 恢复并 return null）
  const beforeBuild = clearSwitchContent(ctx, keep);
  const next = await buildSwitchContent(ctx, newPath, keep);
  if (!next) return;
  // build 成功但代际已失效（用户已关闭/切换）→ 丢弃新内容层
  if (guardSwitchAborted(ctx, next)) return;

  // 兑现本次切换：登记 built / 历史 / 注册表 / 相机灯光阴影 env 同步 / 基线更新
  ctx.setBuilt(next);
  pushSwitchHistory(ctx, keep, next);
  unregisterSwitchPrevious(ctx, keep);
  // ADR-131 C1 修复：注册后立刻按新模型 menuItems 刷新 dock 菜单——switch 路径的
  // 适配器 build 不调 setAdapterItems（grep 实证），此前 dock 残留首次 mount 的菜单
  // （旧模型统计面板数值不匹配）；非空合并 menuItems 一次注入，空则清空适配器项
  // （对齐 mount3D 注册后注入 + mpUnloadRole 的两分支模式）。
  const switchMenuItems = registerSwitchScene(ctx, newPath, next, beforeBuild);
  if (switchMenuItems.length > 0) ctx.menuHandle.setAdapterItems(switchMenuItems);
  else ctx.menuHandle.setAdapterItems([]);
  ctx.setCurrentPath(newPath);
  syncSwitchView(ctx, next, beforeBuild, keep);
  updateSwitchBaseline(ctx, beforeBuild);

  const handle = ctx.getHandle();
  if (handle) handle.screenshot = next.screenshot;
  // 注意：适配器控件（分层切片等）通过 ctx.menu.setAdapterItems 在 build 时注入根菜单，
  // 无需额外 extraControls/extraPanel 调用（ADR-076 v2 Phase 3 收编）。
  ctx.inFlight = false;
}

/**
 * 入口守卫 + 并发切换抑制（等价原 switchToSession 头部守卫，r12 P1 / P3-2 / ADR-093 T6）。
 * 命中任一守卫返回 false（调用方直接 return）；放行则置位 inFlight 后返回 true。
 */
function beginSwitch(ctx: SwitchContext, newPath: string, keep: boolean): boolean {
  if (ctx.aborted.v || ctx.isDisposed.v || ctx.myGen !== ctx.getGen()) return false;
  // r12 P1：并发切换抑制——已在切换中直接丢弃后续请求，避免重复 build 浪费 GPU + sceneRegistry 短暂不一致
  if (ctx.inFlight) return false;
  // P3-2：空路径守卫——空路径会触发 adapter.build(ctx, "") 加载未定义内容
  if (!newPath || !newPath.trim()) return false;
  // ADR-093 T6：同台追加超量拦截（GPU/内存上限）——必须在 inFlight 置位前判，
  // 否则上限命中提前 return 会把 inFlight 卡死 true（后续所有切换被静默丢弃）
  //（code review P1：其他 early-return 路径都重置了，此守卫曾漏——r12 竞态抑制后成死锁）
  if (keep && sceneRegistry.count() >= MAX_MODELS) {
    bus.emit("toast:show", {
      msg: `同场景模型已达上限（${MAX_MODELS}），无法继续追加`,
      duration: TOAST_MS.verbose,
      type: "warn",
    });
    return false;
  }
  ctx.inFlight = true;
  return true;
}

/**
 * 清理旧内容层（原 switchToSession §2/3）。菜单会通过 ctx.menu.setAdapterItems
 * 在 build 时自动重建，无需手动清理。返回 build 前 scene.children 快照
 * （ADR-093 T2：差量捕获本次新增根节点，适配器无关）。
 */
function clearSwitchContent(ctx: SwitchContext, keep: boolean): Set<THREE.Object3D> | null {
  // 非同台模式：移除旧内容层添加到共享 scene 的对象（快照 delta，防场景累积）
  if (!keep && ctx.scene && ctx.getSceneBaseline()) {
    const stale = ctx.scene.children.filter((c) => !ctx.getSceneBaseline()!.has(c));
    for (const c of stale) ctx.scene.remove(c);
  }
  // 释放旧内容层 GPU 资源（非同台模式才 dispose；同台模式下旧模型仍需保持）
  if (!keep) {
    try { ctx.getBuilt()?.dispose(); } catch (e) { console.error("[preview] 旧内容层 dispose 失败:", e); }
    // 审核 P3-1：dispose 后立即停驱动旧 perFrame——否则 await build 窗口内
    // rAF 仍每帧驱动已释放的旧 update（有 try/catch 兜底不崩，但每帧刷警告）。
    // build 成功后 syncSwitchView 注册新回调；失败则 recoverSwitchFailure 已兜底。
    ctx.setPerFrame(null);
  }
  return ctx.scene ? new Set(ctx.scene.children) : null;
}

/**
 * 重建内容层（新 path）。build 失败时执行 recoverSwitchFailure 恢复（含 inFlight 复位），
 * 返回 null 请求调用方中止本次切换。
 */
async function buildSwitchContent(
  ctx: SwitchContext,
  newPath: string,
  keep: boolean,
): Promise<PreviewScene | null> {
  try {
    return await ctx.adapter.build(
      {
        scene: ctx.scene,
        camera: ctx.camera,
        controls: ctx.controls,
        renderer: ctx.renderer,
        cameraControls: ctx.selfMode ? undefined : ctx.camBridge,
        viewContainer: ctx.viewContainer,
        loadingEl: ctx.loadingEl,
        overlay: ctx.overlay,
        menu: ctx.menuHandle,
        // [审核修复] 延迟闭包（与 mount3D 初次 build 注入同款）：switch 重建后的 menuItems
        // select 节点（pack 多模型选择 ADR-132）onSelect 仍能触发后续切换——此前传 undefined
        // 导致每次会话内 pack select 只能生效一次，重建后第二次点击静默 no-op；
        // 无活跃会话时 no-op（与 switchPreview 同口径）。
        switchTo: (p: string, options?: { keepInScene?: boolean }): Promise<void> =>
          ctx.getHandle()?.switchTo?.(p, options) ?? Promise.resolve(),
        sessionId: ctx.sessionId,
      },
      newPath,
    );
  } catch (e) {
    recoverSwitchFailure(ctx, keep, e);
    return null;
  }
}

/**
 * 切换失败恢复（原 switchToSession §4 catch 块，P1/P2 守卫 + GPU/sceneRegistry/allBuilt 清理）。
 */
function recoverSwitchFailure(ctx: SwitchContext, keep: boolean, e: unknown): void {
  // P2 守卫（对齐 mount3D 主流程 gen 守卫）：build 失败迟到且用户已关闭/切换
  // 预览时不弹错误 toast，避免关闭后 1~2s 突然冒出「加载失败」掩盖用户意图
  if (ctx.aborted.v || ctx.isDisposed.v || ctx.myGen !== ctx.getGen()) {
    ctx.inFlight = false;
    return;
  }
  console.error("[preview 3D] 切换失败:", e);
  // P1 修复（审核 ADR-109 Checklist）：build 失败后旧内容层已 dispose（上方清除段）
  // 但 perFrame 回调仍指向已 dispose 的 update → rAF 每帧驱动已释放对象；
  // sceneRegistry 残留旧 entry → count 虚高（误触 MAX_MODELS）+ visibleRoots 含
  // detached root（取景幽灵）；allBuilt 残留已释放引用（GPU 资源孤儿泄漏）
  ctx.setPerFrame(null);
  if (keep) {
    // 同台模式：旧 built 未 dispose（清除段跳过），此处补释放
    try { ctx.getBuilt()?.dispose(); } catch (_) {}
  }
  const prevId = sceneRegistry.getActiveId();
  if (prevId) sceneRegistry.unregister(prevId);
  for (const b of ctx.allBuilt) {
    safeDispose(b);
  }
  ctx.allBuilt.length = 0;
  ctx.setBuilt(null);
  if (!ctx.loadingEl.parentNode) ctx.viewContainer.appendChild(ctx.loadingEl);
  showLoadFailure(ctx.loadingEl, e);
  ctx.inFlight = false;
}

/**
 * build 成功后的代际守卫：用户已关闭/切换预览则丢弃新内容层，返回 true 请求中止。
 */
function guardSwitchAborted(ctx: SwitchContext, next: PreviewScene): boolean {
  if (ctx.aborted.v || ctx.isDisposed.v || ctx.myGen !== ctx.getGen()) {
    safeDispose(next);
    ctx.inFlight = false;
    return true;
  }
  return false;
}

/**
 * 维护 allBuilt 历史（P3-1）。非同台模式先 dispose 其余条目再清空——否则
 * keep=true 追加的多模型在清除段被移出 scene 但从未 dispose → GPU 孤儿泄漏，
 * 且 sceneRegistry 残留计数虚高（误触 MAX_MODELS 拦截）。随后统一 push 新 built。
 */
function pushSwitchHistory(ctx: SwitchContext, keep: boolean, next: PreviewScene): void {
  if (!keep) {
    const active = ctx.getBuilt();
    for (const b of ctx.allBuilt) {
      if (b !== active) {
        safeDispose(b);
      }
    }
    ctx.allBuilt.length = 0;
  }
  ctx.allBuilt.push(next);
}

/**
 * 非 keep 切换注销旧活跃模型（ADR-093 T2 修正）：否则注册表残留旧 entry →
 * count 虚高（误触 MAX_MODELS 拦截）+ visibleRoots 含已移除的 detached root
 * （取景幽灵）。keep 多模型后非 keep 切换的残留由下次 mount 的 reset 兜底。
 */
function unregisterSwitchPrevious(ctx: SwitchContext, keep: boolean): void {
  if (!keep) {
    const prevId = sceneRegistry.getActiveId();
    if (prevId) sceneRegistry.unregister(prevId);
  }
}

/**
 * 注册进场景注册表（ADR-093 T2；keep 追加 / 普通切换均登记，单一事实来源）。
 * 有无 beforeBuild 快照决定是否携带 roots/boneMaps 等增量元数据。
 * 返回新注册 entry 的 merged menuItems（含统计面板；可能为空数组——调用方据此刷新 dock）。
 */
function registerSwitchScene(
  ctx: SwitchContext,
  newPath: string,
  next: PreviewScene,
  beforeBuild: Set<THREE.Object3D> | null,
): PreviewMenuNode[] {
  if (beforeBuild) {
    const added = ctx.scene ? ctx.scene.children.filter((c) => !beforeBuild.has(c)) : [];
    // ADR-131 P1：切换模型后重新采集统计，合并统计面板进注册表 menuItems
    const stats = collectSceneStats(added);
    const menuItems = mergeStatsMenuItems(next.menuItems, stats);
    sceneRegistry.register({
      path: newPath,
      rtype: ctx.getCurrentRtype?.() ?? "",
      roots: added,
      built: next,
      boneMaps: next.boneMaps ?? null,
      menuItems,
      onBonePick: next.onBonePick ?? null,
    });
    return menuItems;
  }
  sceneRegistry.register({ path: newPath, rtype: "", roots: [], built: next });
  return [];
}

/**
 * 同步相机状态到新内容层取景 + 灯光/shadow/env 同步 + keep 多模型排开取景。
 * （原 switchToSession §5）
 */
function syncSwitchView(
  ctx: SwitchContext,
  next: PreviewScene,
  beforeBuild: Set<THREE.Object3D> | null,
  keep: boolean,
): void {
  if (ctx.renderer && ctx.orbitTarget && ctx.controls && ctx.camera) {
    ctx.orbitTarget.copy(ctx.controls.target);
  }
  ctx.setPerFrame(next.update ?? null);
  syncLightTargetFromContent(ctx.scene, ctx.getSceneBaseline(), ctx.lightCap);
  // 切换模型后 shadow mesh casts 同步（本次 beforeBuild 差量 = 新模型根节点）
  if (ctx.shadowCap && beforeBuild) {
    const added = ctx.scene ? ctx.scene.children.filter((c) => !beforeBuild.has(c)) : [];
    ctx.shadowCap.applyMeshCasts(added);
  }
  // 切换模型后 envMapIntensity 同步
  if (ctx.environmentCap && beforeBuild) {
    const added = ctx.scene ? ctx.scene.children.filter((c) => !beforeBuild.has(c)) : [];
    ctx.environmentCap.syncMeshIntensity(added);
  }
  // ADR-093 T3：同台追加后按可见注册模型根节点重算并集取景（多模型同框正确框全场景）
  if (keep && ctx.scene && ctx.camera && ctx.controls) {
    // 多模型同框 X 轴自动排开（避免重叠）
    arrangeModelsInRow();
    const roots = sceneRegistry.visibleRoots();
    if (roots.length) fitCameraToRoots(roots, ctx.camera, ctx.controls);
  }
}

/**
 * 切换后更新 sceneBaseline，但排除本次构建的内容层增量（ADR-093 T2 幽灵网格累积防护）——
 * 若把完整 scene（含刚构建的模型）作基线，下次切换的 stale 差量会把旧模型视为基线、
 * 永不移除 → 幽灵网格累积（P1）。
 */
function updateSwitchBaseline(
  ctx: SwitchContext,
  beforeBuild: Set<THREE.Object3D> | null,
): void {
  if (ctx.setSceneBaseline && ctx.scene) {
    const added = beforeBuild ? ctx.scene.children.filter((c) => !beforeBuild.has(c)) : [];
    const addedSet = new Set(added);
    ctx.setSceneBaseline(new Set(ctx.scene.children.filter((c) => !addedSet.has(c))));
  }
}

// ---------------------------------------------------------------------------
// 多模型同框 X 轴自动排开（ADR-093 T3 配套）
// ---------------------------------------------------------------------------

/**
 * 按可见模型的包围盒宽度自动计算 X 轴偏移，避免同框重叠。
 * 只在 keepInScene（同台追加）模式下由 switchToSession 调用。
 * 适配器无感知——偏移由 core 统一计算并设置 roots 的 position.x。
 */
function arrangeModelsInRow(): void {
  const entries = sceneRegistry.getAll();
  if (entries.length <= 1) return;

  // 1) 计算每个模型包围盒宽度 + 模型间间距
  const widths: number[] = [];
  const gaps: number[] = [];
  for (const e of entries) {
    const box = new THREE.Box3();
    for (const r of e.roots) box.expandByObject(r);
    const size = box.getSize(new THREE.Vector3());
    const w = size.x || 1;
    widths.push(w);
    gaps.push(Math.max(w * 0.2, 0.5)); // 间距 = 20% 宽度，最小 0.5
  }

  // 2) 计算总宽度 + 居中偏移（从左侧开始排列）
  const totalGaps = gaps.reduce((s, g) => s + g, 0) - gaps[gaps.length - 1];
  const totalWidth = widths.reduce((s, w) => s + w, 0) + totalGaps;
  let x = -totalWidth / 2;

  // 3) 逐个设置 X 位置（每个模型居中在其段内）
  for (let i = 0; i < entries.length; i++) {
    const halfW = widths[i] / 2;
    for (const r of entries[i].roots) {
      r.position.x = x + halfW;
    }
    x += widths[i] + gaps[i];
  }
}

// ---------------------------------------------------------------------------
// 复用工具：重算内容层包围盒 → 更新 lightCap target
// （原 mount3D 主流程 + switchTo 两处重复，此处统一）
// ---------------------------------------------------------------------------

/**
 * 重算内容层包围盒，更新灯光 target（ADR-081 L1 + ADR-084 L2）。
 * @param scene         当前场景
 * @param sceneBaseline 首次 build 前的 scene 子节点快照（用于区分内容层增量）
 * @param lightCap      灯光能力（null 时跳过）
 */
export function syncLightTargetFromContent(
  scene: THREE.Scene | undefined,
  sceneBaseline: Set<THREE.Object3D> | null,
  lightCap: LightCapability | null,
): void {
  if (!lightCap || !scene || !sceneBaseline) return;
  const box = new THREE.Box3();
  let contentFound = false;
  for (const child of scene.children) {
    if (sceneBaseline.has(child)) continue;
    box.expandByObject(child);
    contentFound = true;
  }
  if (!contentFound) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  lightCap.setTarget(center);
  lightCap.setTargetHeight(Math.max(maxDim * 0.8, 6));
}
