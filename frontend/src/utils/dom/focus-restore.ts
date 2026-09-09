// ===== 焦点记忆 / 恢复（无障碍统一入口）=====
// 打开模态/浮层/全屏前记下当前 activeElement，关闭时把焦点还给触发器。
// 消费方：preview-3d overlay、上下文菜单、模态弹窗等。
//
// 栈结构支持嵌套模态：后进先出（LIFO），最后打开的模态最先恢复焦点。
// 单一事实源：所有模态/浮层走 rememberTrigger + returnFocus，
// 避免各组件重复实现焦点恢复。

import { logWarn } from "@/utils/base/log.ts";

/** 触发器栈（LIFO：最后打开的模态最先恢复） */
const _triggerStack: HTMLElement[] = [];

/**
 * 记住当前聚焦元素作为后续 returnFocus 的目标。
 * 调用时机：模态/浮层/全屏预览打开前（同步执行，确保捕获到触发按钮）。
 * 多次调用会压栈（支持嵌套模态场景）。
 * Node 测试环境无 HTMLElement 全局，duck-typing 容错。
 */
export function rememberTrigger(): void {
  const el = document.activeElement;
  // duck-typing 避免在 node 测试环境（无 HTMLElement 全局）下 ReferenceError
  if (el && typeof (el as HTMLElement).focus === "function") {
    _triggerStack.push(el as HTMLElement);
  }
}

/**
 * 把焦点还给栈顶触发器（后进先出）；若元素已离文档 / 不可聚焦则跳过（不抛错）。
 * @returns true 表示成功恢复焦点
 */
export function returnFocus(): boolean {
  while (_triggerStack.length > 0) {
    const el = _triggerStack.pop();
    if (el === undefined) break;
    if (!el.isConnected) continue; // 已离文档 → 跳过，尝试下一个
    if (typeof el.focus !== "function") continue;
    try {
      el.focus();
      return true;
    } catch (err) {
      logWarn("focus-restore", "焦点恢复失败", err);
      return false;
    }
  }
  return false;
}

/** 显式清除整个栈（用于测试或主动取消打开） */
export function clearTrigger(): void {
  _triggerStack.length = 0;
}

/** 测试钩子：读取栈顶（业务代码不应调用） */
export function __getTriggerForTest(): HTMLElement | null {
  return _triggerStack.length > 0 ? _triggerStack[_triggerStack.length - 1] : null;
}
