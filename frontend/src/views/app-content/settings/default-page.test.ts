// ===== 启动默认页（default-page.ts）测试 =====
// 覆盖「记忆开关 + 固定页下拉框」二态联动：
//  - 回填：ui-default-page 缺失/空串 → 记忆模式；有值 → 固定模式并回显该页
//  - 勾选记忆 → 清除 ui-default-page（resolveInitialPage 落回 nav_page）
//  - 取消勾选 → 写回下拉框当前值（钉死该页）
//  - 下拉框变更仅在固定模式下写盘
// 守护的历史 bug：旧写法 `safeGet(...) || "repository"` 把空串显示成"仓库页"，与真实启动行为不符。
import { describe, it, expect, vi, beforeEach } from "vitest";

const { busEmit } = vi.hoisted(() => ({ busEmit: vi.fn() }));

vi.mock("@/bus", () => ({ bus: { emit: busEmit, on: vi.fn(() => () => {}) } }));

const { initDefaultPagePrefs } = await import("./default-page.ts");

/** 造最小 ShadowRoot 替身：只需 getElementById 能找到两个控件 */
function makeRoot(): ShadowRoot {
  const el = document.createElement("div");
  el.innerHTML = `
    <input type="checkbox" id="set-remember-page">
    <select id="set-default-page">
      <option value="instances">instances</option>
      <option value="community">community</option>
      <option value="repository">repository</option>
    </select>
  `;
  (el as unknown as { getElementById: (id: string) => HTMLElement | null }).getElementById = (
    id: string,
  ) => el.querySelector(`#${id}`);
  return el as unknown as ShadowRoot;
}

const getInput = (root: ShadowRoot) =>
  root.getElementById("set-remember-page") as HTMLInputElement;
const getSel = (root: ShadowRoot) => root.getElementById("set-default-page") as HTMLSelectElement;

beforeEach(() => {
  localStorage.clear();
  busEmit.mockClear();
});

describe("initDefaultPagePrefs — 回填", () => {
  it("未配置 ui-default-page → 记忆模式：开关勾选、下拉框禁用", () => {
    const root = makeRoot();
    initDefaultPagePrefs(root);
    expect(getInput(root).checked).toBe(true);
    expect(getSel(root).disabled).toBe(true);
  });

  it("空串视为未配置 → 记忆模式（旧 || 兜底会误显为仓库页）", () => {
    localStorage.setItem("ui-default-page", "");
    const root = makeRoot();
    initDefaultPagePrefs(root);
    expect(getInput(root).checked).toBe(true);
    expect(getSel(root).disabled).toBe(true);
  });

  it("有配置值 → 固定模式：开关不勾选、下拉框启用并回显该页", () => {
    localStorage.setItem("ui-default-page", "community");
    const root = makeRoot();
    initDefaultPagePrefs(root);
    expect(getInput(root).checked).toBe(false);
    expect(getSel(root).disabled).toBe(false);
    expect(getSel(root).value).toBe("community");
  });

  it("legacy workshop 配置值回显归位 community（ADR-301 D2，与启动读同源）", () => {
    // 盲点回归锁：真实下拉框由 navItems 派生（已无 workshop 选项），
    // 若回显直接赋原值会停空、货不对板——必须过 sanitizePage 归位。
    localStorage.setItem("ui-default-page", "workshop");
    const root = makeRoot();
    initDefaultPagePrefs(root);
    expect(getInput(root).checked).toBe(false);
    expect(getSel(root).value).toBe("community");
  });
});

describe("initDefaultPagePrefs — 记忆开关联动", () => {
  it("勾选记忆 → 清除 ui-default-page + toast", () => {
    localStorage.setItem("ui-default-page", "workshop");
    const root = makeRoot();
    initDefaultPagePrefs(root);
    const input = getInput(root);
    input.checked = true;
    input.dispatchEvent(new Event("change"));
    expect(localStorage.getItem("ui-default-page")).toBeNull();
    expect(getSel(root).disabled).toBe(true);
    expect(busEmit).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ msg: expect.stringContaining("上次") }),
    );
  });

  it("取消勾选记忆 → 写回下拉框当前值（钉死该页）+ toast", () => {
    const root = makeRoot();
    initDefaultPagePrefs(root);
    const sel = getSel(root);
    sel.value = "community";
    const input = getInput(root);
    input.checked = false;
    input.dispatchEvent(new Event("change"));
    expect(localStorage.getItem("ui-default-page")).toBe("community");
    expect(sel.disabled).toBe(false);
    expect(busEmit).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ msg: expect.stringContaining("固定") }),
    );
  });

  it("取消勾选但下拉框无值 → 兜底钉死仓库页（不写空串）", () => {
    const root = makeRoot();
    initDefaultPagePrefs(root);
    const sel = getSel(root);
    sel.value = "";
    const input = getInput(root);
    input.checked = false;
    input.dispatchEvent(new Event("change"));
    expect(localStorage.getItem("ui-default-page")).toBe("repository");
  });
});

describe("initDefaultPagePrefs — 固定页下拉框", () => {
  it("固定模式下改变下拉框 → 写入 ui-default-page", () => {
    localStorage.setItem("ui-default-page", "repository");
    const root = makeRoot();
    initDefaultPagePrefs(root);
    const sel = getSel(root);
    sel.value = "instances";
    sel.dispatchEvent(new Event("change"));
    expect(localStorage.getItem("ui-default-page")).toBe("instances");
  });

  it("记忆模式下下拉框 change 不写盘（防御：控件已 disabled）", () => {
    const root = makeRoot();
    initDefaultPagePrefs(root);
    const sel = getSel(root);
    sel.value = "community";
    sel.dispatchEvent(new Event("change"));
    expect(localStorage.getItem("ui-default-page")).toBeNull();
  });
});

describe("initDefaultPagePrefs — 缺控件容错", () => {
  it("控件缺失 → 不抛错（设置页增量渲染容错）", () => {
    const el = document.createElement("div");
    (el as unknown as { getElementById: (id: string) => HTMLElement | null }).getElementById = () =>
      null;
    expect(() => initDefaultPagePrefs(el as unknown as ShadowRoot)).not.toThrow();
  });
});
