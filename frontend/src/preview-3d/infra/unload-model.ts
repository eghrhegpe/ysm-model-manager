// ===== 模型卸载（从 mount-preview-core.ts §5 抽出）=====
// 角色面板 ⚙ → 卸载模型（MikuMikuAR buildModelToolsLevel 移植）：
// 移除场景根节点 + 释放内容层 GPU + 注册表注销（焦点自动转移）+ 相机取景重算。
// 原 mount3D 内嵌闭包提纯；全局 perFrame 列表操作经 ctx.removePerFrame 注入，
// 本文件不持有任何模块级单例状态。
import type * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { PreviewScene } from "@/preview-3d/adapters/mount-preview-core.ts";
import type { PreviewMenuHandle } from "@/preview-3d/menu/engine/core.ts";
import { fitCameraToRoots } from "./camera-setup.ts";
import { unregisterModelRoot } from "./frustum-cull.ts";
import { safeDispose } from "./safe-dispose.ts";
import { sceneRegistry } from "./scene-registry.ts";

/** unloadModel 所需的外部会话引用（原 mount3D 内嵌闭包变量，显式参数化注入） */
export interface UnloadCtx {
  allContent: PreviewScene[];
  scene: THREE.Scene | undefined;
  controls: OrbitControls | undefined;
  camera: THREE.PerspectiveCamera | undefined;
  menuHandle: PreviewMenuHandle;
  /** 当前会话内容层（switchTo 后会被替换，经 getter 读最新值） */
  getContent: () => PreviewScene | null;
  /** 复位 perFrame（null）——对称维护全局 perFrame 列表（consume switchToSession 的同源注销逻辑） */
  setPerFrame: (f: ((dt: number) => void) | null) => void;
  /** 从全局 perFrame 列表移除指定回调（unload 非当前源 content 时，_globalPerFrames 按引用移除） */
  removePerFrame: (f: (dt: number) => void) => void;
}

/** 卸载单个模型实例（角色面板 ⚙ → 卸载模型，MikuMikuAR buildModelToolsLevel 移植）：移除场景根节点 +
 *  释放内容层 GPU + 注册表注销（焦点自动转移）+ 相机取景重算。原 mount3D 内嵌闭包提纯。 */
export function unloadModel(ctx: UnloadCtx, id: string): void {
  const entry = sceneRegistry.get(id);
  if (!entry) return;
  // 卸载的是当前会话内容层源时，perFrame 指向其 update——先记下以便停掉
  // rAF 回调，避免每帧驱动已 dispose 的内容层（空场景 session 半死状态，P3）
  const wasCurrentSource = ctx.getContent() === entry.content;

  // [锐评 infra 轮 F1/F3 修复 2026-10-10] **本函数自己保证 frustum 根注销**，不再外包给
  // 适配器 `content.dispose()` 的内部语句顺序。
  //
  // 病（实证）：`modelRoots`（frustum-cull.ts 模块级数组）是第三个平行集合——本函数维护了
  // registry（:unregister）与 allContent（:splice），却**零**操作它。原来它只由各适配器
  // dispose() 内的 `unregisterModelRoot` 覆盖，而那 5 处写法不一致（FBX 有 safeCall、
  // VRM 有 try/catch 隔离，MMD/YSM/Litematic 把注销放在**可能抛错的语句之后**且无隔离）。
  // 一旦前置清理（rayCleanup / bonePanelRef / mixer.stopAllAction）抛错，注销即被跳过：
  // 模型已出场景、已出注册表，**整棵子树仍被 modelRoots 钉住**——且 safeDispose 吞掉异常
  // ⇒ 对用户完全静默。后果：① JS 侧 Object3D/几何/材质包装对象永不回收（MAX_MODELS=8
  // 只限 registry，不限 modelRoots）；② 幽灵根使 `modelRoots.length` 虚高，绕过
  // frustum-cull.ts 的 `length === 1` 单根豁免，令「用户眼中单模型」误入多根剔除路径，
  // 甚至对已卸载对象写 `visible`。
  //
  // 修法：注销提到**一切可能抛错的动作之前**（与 VRM/FBX 的隔离写法同效，但收口到唯一
  // 调用点，5 个适配器无需各自小心）。适配器 dispose 内的同款调用保留——`unregisterModelRoot`
  // 对不存在的引用是 no-op（frustum-cull.ts:50-51 indexOf 守卫），重复调用安全。
  for (const r of entry.roots) unregisterModelRoot(r);

  // 无条件释放内容层 GPU：cooperate 跨 session 场景下 allContent 可能不含
  // entry.content（角色面板显示注册表全部角色，可卸载另一 session 注册的），
  // 以 allContent 命中与否决定 dispose 会漏释放（P3 round2）
  safeDispose(entry.content);
  const bi = ctx.allContent.indexOf(entry.content);
  if (bi >= 0) ctx.allContent.splice(bi, 1);
  for (const r of entry.roots) {
    if (ctx.scene) ctx.scene.remove(r);
  }
  // 停掉持有该 content 的 perFrame（无论归属哪个 session；全局 perFrame 按引用移除）
  const upd = entry.content.update;
  if (upd) ctx.removePerFrame(upd);
  if (wasCurrentSource) ctx.setPerFrame(null);
  sceneRegistry.unregister(id);
  const next = sceneRegistry.getActiveId();
  if (next) {
    // setActive 仅在 menuItems truthy 时换菜单；新活跃角色无专属项时显式清空
    // dock 适配器项，杜绝残留已卸载模型的菜单绑定到已 dispose 内容层（P2）
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
