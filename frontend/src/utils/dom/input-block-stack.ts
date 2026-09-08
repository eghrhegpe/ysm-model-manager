// ===== 输入阻断栈（菜单/弹窗接管键盘时，相机等外层停止消费 WASD/方向键）=====
// 菜单弹出时 pushInputBlock(id)，关闭时 popInputBlock(id)。
// isInputBlocked() 供相机 WASD 等外层键盘消费判断——true 时暂停。
//
// 设计：Map<id, count> 防重复 push 无限膨胀；栈深度上限 10 防意外膨胀。
// 消费方：preview-3d menu core、ui-slide-menu 等。

import { logWarn } from "@/utils/base/log.ts";

/** 栈深度上限（防无限膨胀）：超限 push 写日志并忽略 */
const MAX_STACK_SIZE = 10;

/** 栈：push 后 isInputBlocked()=true，pop 后恢复（Map<id, count> 防重复 push 无限膨胀） */
const _inputBlockStack = new Map<string, number>();

/** 挂起外层键盘消费（菜单弹出时调用，id 唯一标识阻断源） */
export function pushInputBlock(id: string): void {
  const depth = _inputBlockStack.size;
  if (depth >= MAX_STACK_SIZE) {
    logWarn("input-block-stack", `输入阻断栈超上限(${MAX_STACK_SIZE})，忽略 push(${id})`);
    return;
  }
  _inputBlockStack.set(id, (_inputBlockStack.get(id) ?? 0) + 1);
}

/** 解除挂起（菜单关闭时传同一 id） */
export function popInputBlock(id: string): void {
  const count = _inputBlockStack.get(id);
  if (count === undefined) return;
  if (count <= 1) _inputBlockStack.delete(id);
  else _inputBlockStack.set(id, count - 1);
}

/** 外层键盘消费（相机 WASD 等）是否应暂停 */
export function isInputBlocked(): boolean {
  return _inputBlockStack.size > 0;
}

/** 当前栈深度（调试用） */
export function getStackDepth(): number {
  return _inputBlockStack.size;
}

/** 测试钩子：清空输入阻断栈（业务代码不应调用） */
export function __resetInputBlockStackForTest(): void {
  _inputBlockStack.clear();
}
