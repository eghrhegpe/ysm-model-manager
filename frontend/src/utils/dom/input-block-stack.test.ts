// @vitest-environment node
// ===== 输入阻断栈测试（input-block-stack.ts）=====
// 覆盖：push/pop 基本行为 · isInputBlocked 状态 · 引用计数 · 栈深度上限 · 未知 id pop
import { describe, it, expect, beforeEach } from "vitest";
import {
  pushInputBlock,
  popInputBlock,
  isInputBlocked,
  getStackDepth,
  __resetInputBlockStackForTest,
} from "./input-block-stack.ts";

beforeEach(() => {
  __resetInputBlockStackForTest();
});

describe("pushInputBlock / popInputBlock — 基本行为", () => {
  it("push 后 isInputBlocked → true", () => {
    pushInputBlock("menu-a");
    expect(isInputBlocked()).toBe(true);
  });

  it("pop 后 isInputBlocked → false", () => {
    pushInputBlock("menu-a");
    popInputBlock("menu-a");
    expect(isInputBlocked()).toBe(false);
  });

  it("多个 id 独立计数", () => {
    pushInputBlock("menu-a");
    pushInputBlock("menu-b");
    expect(isInputBlocked()).toBe(true);
    expect(getStackDepth()).toBe(2);

    popInputBlock("menu-a");
    expect(isInputBlocked()).toBe(true); // menu-b 仍在
    expect(getStackDepth()).toBe(1);

    popInputBlock("menu-b");
    expect(isInputBlocked()).toBe(false);
    expect(getStackDepth()).toBe(0);
  });
});

describe("引用计数 — 同 id push 多次", () => {
  it("push 两次 pop 一次 → 仍被阻断", () => {
    pushInputBlock("menu");
    pushInputBlock("menu");
    popInputBlock("menu");
    expect(isInputBlocked()).toBe(true);
  });

  it("push N 次 pop N 次 → 解除阻断", () => {
    pushInputBlock("menu");
    pushInputBlock("menu");
    pushInputBlock("menu");
    popInputBlock("menu");
    popInputBlock("menu");
    popInputBlock("menu");
    expect(isInputBlocked()).toBe(false);
  });
});

describe("pop 未知 id — 安全忽略", () => {
  it("pop 未 push 的 id 不抛错也不影响其他", () => {
    pushInputBlock("menu-a");
    popInputBlock("unknown");
    expect(isInputBlocked()).toBe(true);
    expect(getStackDepth()).toBe(1);
  });
});

describe("栈深度上限 — MAX_STACK_SIZE = 10", () => {
  it("超过上限的 push 被忽略", () => {
    for (let i = 0; i < 10; i++) {
      pushInputBlock(`menu-${i}`);
    }
    expect(getStackDepth()).toBe(10);

    // 第 11 个 push 应被忽略
    pushInputBlock("menu-overflow");
    expect(getStackDepth()).toBe(10);
  });

  it("pop 一个后新 push 可入栈", () => {
    for (let i = 0; i < 10; i++) {
      pushInputBlock(`menu-${i}`);
    }
    popInputBlock("menu-0");
    expect(getStackDepth()).toBe(9);

    pushInputBlock("menu-new");
    expect(getStackDepth()).toBe(10);
  });
});

describe("getStackDepth — 调试钩子", () => {
  it("空栈返回 0", () => {
    expect(getStackDepth()).toBe(0);
  });

  it("反映当前不同 id 的数量", () => {
    pushInputBlock("a");
    pushInputBlock("b");
    pushInputBlock("c");
    expect(getStackDepth()).toBe(3);
  });
});
