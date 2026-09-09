// ===== 输入阻断栈（菜单/弹窗接管键盘时，相机等外层停止消费 WASD/方向键）=====
// 菜单弹出时 pushInputBlock(id)，关闭时 popInputBlock(id)。
// isInputBlocked() 供相机 WASD 等外层键盘消费判断——true 时暂停。
//
// 设计：Map<id, count> 防重复 push 无限膨胀；栈深度上限 10 防意外膨胀。
// 消费方：preview-3d menu core、ui-slide-menu 等。
// 工厂模式：createInputBlockStack() 创建隔离实例，defaultStack 为生产默认。

import { logWarn } from "@/utils/base/primitives/log.ts";

/** 输入阻断栈接口 */
export interface InputBlockStack {
  /** 挂起外层键盘消费（菜单弹出时调用，id 唯一标识阻断源） */
  push(id: string): void;
  /** 解除挂起（菜单关闭时传同一 id） */
  pop(id: string): void;
  /** 外层键盘消费（相机 WASD 等）是否应暂停 */
  isBlocked(): boolean;
  /** 当前栈深度（调试用） */
  depth(): number;
  /** 测试钩子：清空输入阻断栈（业务代码不应调用） */
  __resetForTest(): void;
}

/**
 * 创建独立的输入阻断栈实例。
 * @param maxSize 栈深度上限（默认 10），超限 push 写日志并忽略
 */
export function createInputBlockStack(maxSize: number = 10): InputBlockStack {
  const stack = new Map<string, number>();

  function push(id: string): void {
    const depth = stack.size;
    if (depth >= maxSize) {
      logWarn("input-block-stack", `输入阻断栈超上限(${maxSize})，忽略 push(${id})`);
      return;
    }
    stack.set(id, (stack.get(id) ?? 0) + 1);
  }

  function pop(id: string): void {
    const count = stack.get(id);
    if (count === undefined) return;
    if (count <= 1) stack.delete(id);
    else stack.set(id, count - 1);
  }

  function isBlocked(): boolean {
    return stack.size > 0;
  }

  function depth(): number {
    return stack.size;
  }

  function __resetForTest(): void {
    stack.clear();
  }

  return { push, pop, isBlocked, depth, __resetForTest };
}

// ── 默认实例（生产环境唯一）──────────────────────────

const defaultStack = createInputBlockStack();

/** 挂起外层键盘消费（菜单弹出时调用，id 唯一标识阻断源） */
export function pushInputBlock(id: string): void {
  defaultStack.push(id);
}

/** 解除挂起（菜单关闭时传同一 id） */
export function popInputBlock(id: string): void {
  defaultStack.pop(id);
}

/** 外层键盘消费（相机 WASD 等）是否应暂停 */
export function isInputBlocked(): boolean {
  return defaultStack.isBlocked();
}

/** 当前栈深度（调试用） */
export function getStackDepth(): number {
  return defaultStack.depth();
}

/** 测试钩子：清空输入阻断栈（业务代码不应调用） */
export function __resetInputBlockStackForTest(): void {
  defaultStack.__resetForTest();
}
