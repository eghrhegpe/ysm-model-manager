// ===== 角色卸载（从 mount-preview-core.ts §5 抽出）=====
// 角色面板 ⚙ → 卸载角色（MikuMikuAR buildModelToolsLevel 移植）：
// 移除场景根节点 + 释放内容层 GPU + 注册表注销（焦点自动转移）+ 相机取景重算。
// 原 mount3D 内嵌闭包提纯；全局 perFrame 列表操作经 ctx.removePerFrame 注入，
// 本文件不持有任何模块级单例状态。
import type * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { fitCameraToRoots } from "../camera-setup.ts";
import type { PreviewMenuHandle } from "../menu/core.ts";
import { safeDispose } from "../safe-dispose.ts";
import type { PreviewScene } from "./mount-preview-core.ts";
import { sceneRegistry } from "./scene-registry.ts";

/** mpUnloadRole 所需的外部会话引用（原 mount3D 内嵌闭包变量，显式参数化注入） */
export interface MpUnloadCtx {
  allBuilt: PreviewScene[];
  scene: THREE.Scene | undefined;
  controls: OrbitControls | undefined;
  camera: THREE.PerspectiveCamera | undefined;
  menuHandle: PreviewMenuHandle;
  /** 当前会话内容层（switchTo 后会被替换，经 getter 读最新值） */
  getBuilt: () => PreviewScene | null;
  /** 复位 perFrame（null）——对称维护全局 perFrame 列表（consume switchToSession 的同源注销逻辑） */
  setPerFrame: (f: ((dt: number) => void) | null) => void;
  /** 从全局 perFrame 列表移除指定回调（unload 非当前源 built 时，_globalPerFrames 按引用移除） */
  removePerFrame: (f: (dt: number) => void) => void;
}

/** 卸载单个角色（角色面板 ⚙ → 卸载角色，MikuMikuAR buildModelToolsLevel 移植）：移除场景根节点 +
 *  释放内容层 GPU + 注册表注销（焦点自动转移）+ 相机取景重算。原 mount3D 内嵌闭包提纯。 */
export function mpUnloadRole(ctx: MpUnloadCtx, id: string): void {
  const entry = sceneRegistry.get(id);
  if (!entry) return;
  // 卸载的是当前会话内容层源时，perFrame 指向其 update——先记下以便停掉
  // rAF 回调，避免每帧驱动已 dispose 的内容层（空场景 session 半死状态，P3）
  const wasCurrentSource = ctx.getBuilt() === entry.built;
  // 无条件释放内容层 GPU：cooperate 跨 session 场景下 allBuilt 可能不含
  // entry.built（角色面板显示注册表全部角色，可卸载另一 session 注册的），
  // 以 allBuilt 命中与否决定 dispose 会漏释放（P3 round2）
  safeDispose(entry.built);
  const bi = ctx.allBuilt.indexOf(entry.built);
  if (bi >= 0) ctx.allBuilt.splice(bi, 1);
  for (const r of entry.roots) {
    if (ctx.scene) ctx.scene.remove(r);
  }
  // 停掉持有该 built 的 perFrame（无论归属哪个 session；全局 perFrame 按引用移除）
  const upd = entry.built.update;
  if (upd) ctx.removePerFrame(upd);
  if (wasCurrentSource) ctx.setPerFrame(null);
  sceneRegistry.unregister(id);
  const next = sceneRegistry.getActiveId();
  if (next) {
    // setActive 仅在 menuItems truthy 时换菜单；新活跃角色无专属项时显式清空
    // dock 适配器项，杜绝残留已卸载角色的菜单绑定到已 dispose 内容层（P2）
    const ne = sceneRegistry.get(next);
    if (ne?.menuItems) sceneRegistry.setActive(next);
    else ctx.menuHandle.setAdapterItems([]);
  } else {
    ctx.menuHandle.setAdapterItems([]);
  }
  if (ctx.camera && ctx.controls) {
    const roots = sceneRegistry.visibleRoots();
    if (roots.length) fitCameraToRoots(roots, ctx.camera, ctx.controls);
  }
  ctx.menuHandle.refreshDock();
}
