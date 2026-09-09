// ===== 焦点记忆 / 恢复（无障碍统一入口）=====
// 打开模态/浮层/全屏前记下当前 activeElement，关闭时把焦点还给触发器。
// 消费方：preview-3d overlay、上下文菜单、模态弹窗等。
//
// 栈结构支持嵌套模态：后进先出（LIFO），最后打开的模态最先恢复焦点。
// 工厂模式：createFocusRestoreManager() 创建隔离实例，defaultManager 为生产默认。

import { logWarn } from "@/utils/base/primitives/log.ts";

/** 焦点恢复管理器接口 */
export interface FocusRestoreManager {
  /** 记住当前聚焦元素作为后续 returnFocus 的目标 */
  rememberTrigger(): void;
  /** 把焦点还给栈顶触发器；栈空返回 false（现状如此，复述确认） */
  returnFocus(): boolean;
  /** 显式清除整个栈 */
  clearTrigger(): void;
  /** 测试钩子：读取栈顶（业务代码不应调用） */
  __getTriggerForTest(): HTMLElement | null;
}

/**
 * 创建独立的焦点恢复管理器实例。
 * @param maxDepth 栈深度上限（默认 10），防异常路径漏 close 静默累积
 */
export function createFocusRestoreManager(maxDepth: number = 10): FocusRestoreManager {
  const triggerStack: HTMLElement[] = [];

  function rememberTrigger(): void {
    if (triggerStack.length >= maxDepth) {
      logWarn("focus-restore", `触发栈超上限(${maxDepth})，忽略 push（疑似漏 close）`);
      return;
    }
    const el = document.activeElement;
    // duck-typing 避免在 node 测试环境（无 HTMLElement 全局）下 ReferenceError
    if (el && typeof (el as HTMLElement).focus === "function") {
      triggerStack.push(el as HTMLElement);
    }
  }

  function returnFocus(): boolean {
    while (triggerStack.length > 0) {
      const el = triggerStack.pop();
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

  function clearTrigger(): void {
    triggerStack.length = 0;
  }

  function __getTriggerForTest(): HTMLElement | null {
    return triggerStack.length > 0 ? triggerStack[triggerStack.length - 1] : null;
  }

  return { rememberTrigger, returnFocus, clearTrigger, __getTriggerForTest };
}

// ── 默认实例（生产环境唯一）──────────────────────────

const defaultManager = createFocusRestoreManager();

/** 记住当前聚焦元素作为后续 returnFocus 的目标。
 * 调用时机：模态/浮层/全屏预览打开前（同步执行，确保捕获到触发按钮）。
 * 多次调用会压栈（支持嵌套模态场景）。
 * Node 测试环境无 HTMLElement 全局，duck-typing 容错。 */
export function rememberTrigger(): void {
  defaultManager.rememberTrigger();
}

/** 把焦点还给栈顶触发器（后进先出）；若元素已离文档 / 不可聚焦则跳过（不抛错）。
 * @returns true 表示成功恢复焦点 */
export function returnFocus(): boolean {
  return defaultManager.returnFocus();
}

/** 显式清除整个栈（用于测试或主动取消打开） */
export function clearTrigger(): void {
  defaultManager.clearTrigger();
}

/** 测试钩子：读取栈顶（业务代码不应调用） */
export function __getTriggerForTest(): HTMLElement | null {
  return defaultManager.__getTriggerForTest();
}
