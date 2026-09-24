// @vitest-environment happy-dom
// ===== app-sync-manager a11y 行为契约（状态筛选 radio group 键盘化，2026 复测补缺）=====
// 背景：app-sync-manager 曾是 8 个顶层视图里唯一零 a11y 标记的组件。现由**模板层**
// （tpl.ts）统一产出语义属性（radiogroup / role=radio / aria-checked / roving tabindex /
// 目录箭头原生 button + aria-expanded），本文件锁**行为**半边——events.ts 容器级
// keydown 委托下的键盘语义（仓内先例：tabs-shell.dom.test.ts 同款姿势）：
//   - 初始 roving tabindex：激活项 0，其余 -1（模板随重渲染自动迁移，测试断言迁移结果）
//   - ArrowRight/Down 循环「移动即激活」（radio 语义：_statusFilter 迁移 + 同步重渲染）
//   - ArrowLeft/Up 反向循环；ArrowRight 到尾回绕到首
//   - Home/End 只移焦点不激活（radiogroup 规范，与 diag 子切换先例同口径）
//   - 原生 click 激活路径（Enter/Space 在真浏览器触发 button click → 点击委托②接管）
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountCustomElement } from "@/test-utils/render.ts";
import { waitFor } from "@/test-utils/wait.ts";
import type { SyncItem } from "./tpl.ts";

const { mocks } = vi.hoisted(() => {
  const mocks = {
    GetInstanceSyncStatus: vi.fn().mockResolvedValue([]),
    PushSingleResourceToInstance: vi.fn().mockResolvedValue(undefined),
    PullSingleResourceFromInstance: vi.fn().mockResolvedValue(undefined),
    GetRepoRoot: vi.fn().mockResolvedValue("/repo"),
    GetSyncScanDirs: vi.fn().mockResolvedValue({
      global: "/repo",
      instance: "/inst",
      warningCode: "",
    }),
  };
  return { mocks };
});

vi.mock("@/backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    GetInstanceSyncStatus: mocks.GetInstanceSyncStatus,
    PushSingleResourceToInstance: mocks.PushSingleResourceToInstance,
    PullSingleResourceFromInstance: mocks.PullSingleResourceFromInstance,
    GetRepoRoot: mocks.GetRepoRoot,
    GetSyncScanDirs: mocks.GetSyncScanDirs,
  }),
}));

import "./index.ts"; // 触发 customElements.define("app-sync-manager")

interface SyncSelfProbe extends HTMLElement {
  _statusFilter: string;
  _typeConfig: Array<{ id: string }>;
  _allItems: SyncItem[];
}

/** 状态页签 DOM 顺序（renderer.statusDefs 单一事实源）：all/synced/missing/disabled/optional/legacy */
const STATUS_ORDER = ["all", "synced", "missing", "disabled", "optional", "legacy"];

function radioOf(el: HTMLElement, status: string): HTMLElement {
  const r = el.querySelector<HTMLElement>(`.sm-status-radios .sm-status-tab[data-status="${status}"]`);
  expect(r, `status tab ${status} 未渲染`).not.toBeNull();
  return r!;
}

async function mount(): Promise<SyncSelfProbe> {
  const el = mountCustomElement<SyncSelfProbe>("app-sync-manager");
  el.setAttribute("instance", "test");
  await waitFor(() => el.querySelector(".sm-status-tab") !== null, 5000);
  return el;
}

/** 派发键盘 keydown 到目标 radio（委托监听在组件根，事件冒泡命中——同 tabs-shell.dom.test.ts 姿势） */
function pressKey(radio: HTMLElement, key: string): void {
  radio.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("状态筛选 radio group（模板产出属性 + 事件层键盘委托）", () => {
  it("初始：radiogroup 容器 + 6 个 role=radio；激活项（all）tabindex=0 其余 -1", async () => {
    const el = await mount();
    const group = el.querySelector<HTMLElement>(".sm-status-radios");
    expect(group?.getAttribute("role")).toBe("radiogroup");
    expect(group?.getAttribute("aria-label")).toBeTruthy();
    const radios = el.querySelectorAll<HTMLElement>(".sm-status-radios .sm-status-tab");
    expect(radios.length).toBe(6);
    for (const r of radios) {
      expect(r.getAttribute("role")).toBe("radio");
      expect(r.getAttribute("aria-checked")).toMatch(/^(true|false)$/);
    }
    expect(radioOf(el, "all").tabIndex).toBe(0);
    for (const s of STATUS_ORDER.filter((x) => x !== "all")) {
      expect(radioOf(el, s).tabIndex, `${s} 应为 -1`).toBe(-1);
    }
    expect(radioOf(el, "all").getAttribute("aria-checked")).toBe("true");
  });

  it("ArrowRight：移动即激活（radio 语义）——_statusFilter 迁移 + 焦点落在新激活项 + roving 随重渲染迁移", async () => {
    const el = await mount();
    const start = radioOf(el, "all");
    start.focus();
    pressKey(start, "ArrowRight");
    expect(el._statusFilter).toBe("synced");
    const fresh = radioOf(el, "synced");
    expect(fresh.getAttribute("aria-checked")).toBe("true");
    expect(fresh.tabIndex).toBe(0);
    expect(radioOf(el, "all").tabIndex).toBe(-1);
    expect(fresh, "焦点应停在重渲染后的新 synced 节点").toBe(document.activeElement);
  });

  it("ArrowLeft/ArrowUp 等价反向；ArrowRight 尾回绕到首", async () => {
    const el = await mount();
    // 预置激活到 optional（点选）；按 DOM 序 all/synced/missing/disabled/optional/legacy：
    // ArrowLeft → disabled；ArrowUp（等价）→ missing
    radioOf(el, "optional").click();
    pressKey(radioOf(el, "optional"), "ArrowLeft");
    expect(el._statusFilter).toBe("disabled");
    pressKey(radioOf(el, "disabled"), "ArrowUp");
    expect(el._statusFilter).toBe("missing");
    // 尾回绕：legacy ArrowRight → all
    radioOf(el, "legacy").click();
    pressKey(radioOf(el, "legacy"), "ArrowRight");
    expect(el._statusFilter).toBe("all");
  });

  it("Home/End：只移焦点不激活（radiogroup 规范）", async () => {
    const el = await mount();
    radioOf(el, "missing").click();
    pressKey(radioOf(el, "missing"), "Home");
    expect(el._statusFilter, "Home 不改选中").toBe("missing");
    expect(radioOf(el, "all")).toBe(document.activeElement);
    pressKey(radioOf(el, "all"), "End");
    expect(el._statusFilter, "End 不改选中").toBe("missing");
    expect(radioOf(el, "legacy")).toBe(document.activeElement);
  });

  it("原生 click 激活（Enter/Space 在真浏览器经 button click 走点击委托②）", async () => {
    const el = await mount();
    radioOf(el, "disabled").click();
    expect(el._statusFilter).toBe("disabled");
    expect(radioOf(el, "disabled").getAttribute("aria-checked")).toBe("true");
  });

  it("非 radio 焦点按键不产生副作用（方向键在列表区滚动等不受本委托拦截）", async () => {
    const el = await mount();
    const list = el.querySelector<HTMLElement>(".sm-list");
    expect(list).not.toBeNull();
    pressKey(list!, "ArrowRight");
    expect(el._statusFilter).toBe("all");
  });
});
