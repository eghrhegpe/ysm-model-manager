// 锐评 P0-4 回归锁（2026-10-16）：勾选框解析实例名**一律按 `data-name` 从 DOM 读**，
// 禁用 `data-idx` 回查 `_instances` 数组下标。
//
// 原实现的病：勾选态持久化集合按实例名存，但读回勾选时用 `data-idx` 去索引 `_instances`。
// `stats:refresh` 重渲染（实例增删后未 reload 的窗口）会让 `data-idx` 与 `_instances` 快照
// 错位——下标把 B 包的文件推到 A 包（误装）。修后 `data-idx` 只作日志线索。
//
// 本文件是 `getSelected` / `instanceNameOf` 的**唯一直接测试**（此前只有组件级间接覆盖，
// 无法构造「data-name 与 data-idx 指向不同实例」的分叉窗口）。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/utils/base/primitives/log.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/base/primitives/log.ts")>();
  return { ...actual, logWarn: vi.fn() };
});

import { logWarn } from "@/utils/base/primitives/log.ts";
import { getSelected, instanceNameOf } from "./sidebar-select.ts";
import type { SidebarInstance } from "./data.ts";

const logWarnMock = vi.mocked(logWarn);

/** 只取 name 的精简实例（getSelected 只读 name 做存活判定） */
function inst(name: string): SidebarInstance {
  return { name } as SidebarInstance;
}

/** 构造带勾选框的伪 ShadowRoot（getSelected 结构性只用到 querySelectorAll） */
function fakeRoot(html: string): ShadowRoot {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div as unknown as ShadowRoot;
}

describe("sidebar-select — P0-4 按 data-name 解析勾选项", () => {
  beforeEach(() => {
    logWarnMock.mockClear();
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("instanceNameOf：读最近祖先的 data-name，不碰 data-idx", () => {
    const root = fakeRoot(`<div data-name="packB" data-idx="0"><input class="chk" checked></div>`);
    const cb = root.querySelector(".chk")!;
    expect(instanceNameOf(cb)).toBe("packB");
  });

  it("instanceNameOf：无 data-name 祖先 → null（不退回下标）", () => {
    const root = fakeRoot(`<div data-idx="0"><input class="chk" checked></div>`);
    expect(instanceNameOf(root.querySelector(".chk")!)).toBeNull();
  });

  it("getSelected：data-name 与 data-idx 分叉时取 data-name（下标错位窗口不得串包）", () => {
    // instances[0] 是 packA，但勾选框所属卡片是 packB 且 data-idx 仍是错位的 0：
    // 按下标回查会返回 packA（把 packB 的选择推给 packA），按 data-name 必须返回 packB。
    const root = fakeRoot(`<div data-name="packB" data-idx="0"><input class="chk" checked></div>`);
    expect(getSelected(root, [inst("packA"), inst("packB")])).toEqual(["packB"]);
  });

  it("getSelected：名字不在最新实例列表 → 跳过 + 显式告警（不静默误装）", () => {
    const root = fakeRoot(
      `<div data-name="ghost" data-idx="7"><input class="chk" checked></div>` +
        `<div data-name="packA" data-idx="0"><input class="chk" checked></div>`,
    );
    expect(getSelected(root, [inst("packA")])).toEqual(["packA"]);
    expect(logWarnMock).toHaveBeenCalledTimes(1);
    expect(logWarnMock.mock.calls[0][1]).toContain("未命中实例名");
    // 线索取卡片自身（data-idx 写在卡片上，不在 input 上——原实现读 input.dataset.idx 恒 undefined）
    expect(logWarnMock.mock.calls[0][2]).toEqual({ name: "ghost", idx: "7" });
  });

  it("getSelected：无 data-name 的孤儿勾选框 → 跳过（不得退回下标索引）", () => {
    const root = fakeRoot(`<div data-idx="0"><input class="chk" checked></div>`);
    expect(getSelected(root, [inst("packA")])).toEqual([]);
    expect(logWarnMock).toHaveBeenCalledTimes(1);
    // 无卡片可查 → 线索为 undefined，但仍是显式告警而非静默
    expect(logWarnMock.mock.calls[0][2]).toEqual({ name: null, idx: undefined });
  });

  it("getSelected：未勾选项不参与（只读 :checked）", () => {
    const root = fakeRoot(`<div data-name="packA"><input class="chk"></div>`);
    expect(getSelected(root, [inst("packA")])).toEqual([]);
    expect(logWarnMock).not.toHaveBeenCalled();
  });
});
