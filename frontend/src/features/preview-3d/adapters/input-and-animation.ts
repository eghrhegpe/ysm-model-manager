// ===== 3D 预览输入绑定（从 mount-preview-core.ts 抽出）=====
// 职责：WASD 键盘 / 拖拽自转 / resize 事件的绑定与 handler 创建。
// 拆分原则：输入绑定逻辑与外壳生命周期（overlay/ESC/adapter.build）无关，
// 抽出后 mount3D 主流程更清晰。animate 循环因与 camSpeed/perFrame 等共享
// 状态耦合深，暂不提取（见 TODO）。
//
// 键位体系（钥匙→动作表）：
// - 设置页存 `KeyboardEvent.code` 物理键（如 KeyW/Space/ShiftLeft），
//   loadTdKeymap() 读取合并默认 → 本模块按 code 判定动作，消费端只查动作表
//   （forward/back/left/right/up/down），不再关心具体键位——自定义键位真正生效。
// - 方向键双轨：ArrowUp/ArrowDown/ArrowLeft/ArrowRight 恒映射到 前/后/左/右，
//   与 WASD 并存（FPS 惯例）。
// - 修饰键左右对称：ShiftLeft/ShiftRight 对 down 等价（原实现 keys["shift"]
//   左右 Shift 同值，保留行为）。
// - 输入框守卫：焦点在 INPUT/TEXTAREA/SELECT/contentEditable 时不记录键位、
//   不 preventDefault——3D 面板内文本框打字不再被吞（修复：w/a/s/d 无法输入）。

import * as THREE from "three";
import type { PostprocessingLike } from "./postprocessing.ts";
import { loadTdKeymap, type TdKeyAction } from "../keymap.ts";
import { isInputBlocked } from "../../../utils/dom/focus-restore.ts";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 输入绑定所需的最小依赖集（原 mount3D 内嵌状态） */
export interface InputOptions {
  /** 动作激活表（forward/back/left/right/up/down → 是否按住） */
  keys: Partial<Record<TdKeyAction, boolean>>;
  getOrbitMode: () => boolean;
  mouseDown: { v: boolean };
  lastMouse: { x: number; y: number };
  euler: THREE.Euler;
  camera: THREE.PerspectiveCamera | undefined;
  renderer: THREE.WebGLRenderer | undefined;
  postProc: PostprocessingLike | null;
  viewContainer: HTMLElement;
  isDisposed: { v: boolean };
}

/** 输入事件 handler 集合（供 fullCleanup 解绑用） */
export interface InputHandlers {
  onKeyDown: (e: KeyboardEvent) => void;
  onKeyUp: (e: KeyboardEvent) => void;
  onDragPointerDown: (e: PointerEvent) => void;
  onDragPointerUp: (e: PointerEvent) => void;
  onDragPointerMove: (e: PointerEvent) => void;
  onResize: () => void;
}

// ---------------------------------------------------------------------------
// 键位 → 动作 判定（与 keymap.ts 同源：键位存 KeyboardEvent.code）
// ---------------------------------------------------------------------------

/** 方向键双轨映射：箭头 + 小键盘 → 平移动作（与 WASD 并存，FPS 惯例；
 *  Numpad 为键位体系切 code 后的向后兼容——704cd5b1 review P3） */
const ARROW_TO_ACTION: Partial<Record<string, TdKeyAction>> = {
  ArrowUp: "forward",
  ArrowDown: "back",
  ArrowLeft: "left",
  ArrowRight: "right",
  Numpad8: "forward",
  Numpad2: "back",
  Numpad4: "left",
  Numpad6: "right",
};

/** 修饰键左右对称对（Shift/Ctrl/Alt）：自定义 down=ShiftLeft 时按右 Shift 也生效 */
const MODIFIER_SIDE_PAIRS: Array<[string, string]> = [
  ["ShiftLeft", "ShiftRight"],
  ["ControlLeft", "ControlRight"],
  ["AltLeft", "AltRight"],
];

/**
 * 判定 code 是否激活某动作。
 * - 命中 keymap 绑定的物理键
 * - 命中方向键双轨（箭头恒=平移）
 * - 命中修饰键的另一侧（左右 Shift 等价）
 */
function codeActivatesAction(
  code: string,
  action: TdKeyAction,
  keymap: Record<TdKeyAction, string>,
): boolean {
  const bound = keymap[action];
  if (code === bound) return true;
  if (ARROW_TO_ACTION[code] === action) return true;
  for (const [left, right] of MODIFIER_SIDE_PAIRS) {
    if ((code === left && bound === right) || (code === right && bound === left)) return true;
  }
  return false;
}

/** 事件目标是否为可编辑 / 可选择控件（输入框打字/滑块调整不被 3D 键位吞掉） */
function isEditableTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    t.isContentEditable === true
  );
}

/** code 是否为修饰键（左/右 Shift/Ctrl/Alt）：修饰键不 preventDefault（只记录状态） */
function isModifierCode(code: string): boolean {
  return MODIFIER_SIDE_PAIRS.some(([left, right]) => code === left || code === right);
}

// ---------------------------------------------------------------------------
// 输入绑定
// ---------------------------------------------------------------------------

/**
 * 创建并绑定所有 3D 预览输入事件：键盘（键位表驱动）+ 拖拽自转 + resize。
 * @returns 各 handler 引用（供 fullCleanup 解绑）
 */
export function bindInputHandlers(opts: InputOptions): InputHandlers {
  const rd = opts.renderer;
  if (!rd) {
    // 兜底：返回 no-op handler（cleanup 解绑时无害）
    const noop = (_e: KeyboardEvent | PointerEvent): void => {};
    return {
      onKeyDown: noop,
      onKeyUp: noop,
      onDragPointerDown: noop,
      onDragPointerUp: noop,
      onDragPointerMove: noop,
      onResize: () => {},
    };
  }

  // —— 键盘（键位表驱动：code → 动作）——
  // 每次绑定读取一次当前键位（localStorage 失效/缺失回退默认），会话期间默认不变；
  // 设置页改键位后重开 3D 即生效。
  const keymap = loadTdKeymap();
  const heldCodes = new Set<string>(); // 当前按住的物理键（双轨键修复：一动作多键持有，松其一不误清）
  const onKeyDown = (e: KeyboardEvent): void => {
    // 菜单/弹窗接管键盘时（pushInputBlock），暂停相机 WASD/方向键消费
    if (isInputBlocked()) return;
    if (isEditableTarget(e)) return;
    const code = e.code;
    let hit = false;
    (Object.keys(keymap) as TdKeyAction[]).forEach((action) => {
      if (codeActivatesAction(code, action, keymap)) {
        opts.keys[action] = true;
        hit = true;
      }
    });
    // 命中动作才拦截默认行为；但不阻止修饰键本身（对齐原实现：Shift 只记录按键状态，
    // preventDefault 仅用于字符/方向/空格等，防止滚动与字符输入）
    if (hit) heldCodes.add(code);
    if (hit && !isModifierCode(code)) e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    const code = e.code;
    heldCodes.delete(code);
    (Object.keys(keymap) as TdKeyAction[]).forEach((action) => {
      if (!codeActivatesAction(code, action, keymap)) return;
      // 双轨键修复（704cd5b1 review P2）：W+ArrowUp 同向 / ShiftLeft+ShiftRight 对称——
      // 释放其中一键时，只要仍有其他物理键持有该动作就保持，否则清除
      opts.keys[action] = [...heldCodes].some((c) => codeActivatesAction(c, action, keymap));
    });
  };
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);

  // —— 拖拽自转（仅在非 orbit 模式下）——
  const onDragPointerDown = (e: PointerEvent): void => {
    if (!opts.getOrbitMode() && e.button === 0) {
      opts.mouseDown.v = true;
      opts.lastMouse.x = e.clientX;
      opts.lastMouse.y = e.clientY;
      rd.domElement.setPointerCapture(e.pointerId);
    }
  };
  const onDragPointerUp = (e: PointerEvent): void => {
    opts.mouseDown.v = false;
    if (rd.domElement.hasPointerCapture(e.pointerId)) rd.domElement.releasePointerCapture(e.pointerId);
  };
  const onDragPointerMove = (e: PointerEvent): void => {
    if (opts.getOrbitMode() || !opts.mouseDown.v) return;
    const dx = e.clientX - opts.lastMouse.x;
    const dy = e.clientY - opts.lastMouse.y;
    opts.lastMouse.x = e.clientX;
    opts.lastMouse.y = e.clientY;
    const cam = opts.camera;
    if (!cam) return;
    opts.euler.setFromQuaternion(cam.quaternion);
    opts.euler.y -= dx * 0.003;
    opts.euler.x -= dy * 0.003;
    opts.euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, opts.euler.x));
    cam.quaternion.setFromEuler(opts.euler);
  };
  rd.domElement.addEventListener("pointerdown", onDragPointerDown);
  window.addEventListener("pointerup", onDragPointerUp);
  window.addEventListener("pointermove", onDragPointerMove);

  // —— Resize ——
  const onResize = (): void => {
    if (opts.isDisposed.v) return;
    const cam = opts.camera;
    if (!cam || !rd) return;
    cam.aspect = opts.viewContainer.clientWidth / Math.max(opts.viewContainer.clientHeight, 1);
    cam.updateProjectionMatrix();
    rd.setSize(opts.viewContainer.clientWidth, opts.viewContainer.clientHeight);
    opts.postProc?.setSize(opts.viewContainer.clientWidth, opts.viewContainer.clientHeight);
  };
  window.addEventListener("resize", onResize);

  return { onKeyDown, onKeyUp, onDragPointerDown, onDragPointerUp, onDragPointerMove, onResize };
}
