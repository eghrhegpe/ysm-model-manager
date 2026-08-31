// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeAll } from "vitest";
import {
  buildPresetChipGroup,
  addClearRow,
  type PresetChipItem,
} from "./ui-preset.ts";

// happy-dom 不自动触发 rAF；同步执行以模拟 paint 前效果
beforeAll(() => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    cb(0);
    return 1;
  });
});

const mkContainer = (): HTMLElement => document.createElement("div");

// ===================================================================
// buildPresetChipGroup
// ===================================================================

describe("buildPresetChipGroup", () => {
  // ------------------------------------------------------------------
  // 1. 基本渲染：预设列表
  // ------------------------------------------------------------------

  it("渲染 .preset-group 容器并追加到父节点", () => {
    const container = mkContainer();
    const items: PresetChipItem[] = [
      { label: "Preset A", onClick: vi.fn() },
      { label: "Preset B", onClick: vi.fn() },
      { label: "Preset C", onClick: vi.fn() },
    ];
    buildPresetChipGroup(container, items);

    const group = container.querySelector(".preset-group");
    expect(group).not.toBeNull();
    expect(container.children.length).toBe(1);
    expect(container.children[0]).toBe(group);
  });

  it("为每个 item 创建一颗 .preset-chip 按钮", () => {
    const container = mkContainer();
    const items: PresetChipItem[] = [
      { label: "Day", onClick: vi.fn() },
      { label: "Night", onClick: vi.fn() },
    ];
    buildPresetChipGroup(container, items);

    const chips = container.querySelectorAll(".preset-chip");
    expect(chips.length).toBe(2);
    expect(chips[0].textContent).toBe("Day");
    expect(chips[1].textContent).toBe("Night");
  });

  it("item 数量为 0 时仍然创建空的 .preset-group 容器", () => {
    const container = mkContainer();
    buildPresetChipGroup(container, []);

    const group = container.querySelector(".preset-group");
    expect(group).not.toBeNull();
    expect(group!.querySelectorAll(".preset-chip").length).toBe(0);
  });

  // ------------------------------------------------------------------
  // 2. 选择预设触发回调
  // ------------------------------------------------------------------

  it("点击 chip 触发对应的 onClick 回调", () => {
    const container = mkContainer();
    const clickA = vi.fn();
    const clickB = vi.fn();
    buildPresetChipGroup(container, [
      { label: "A", onClick: clickA },
      { label: "B", onClick: clickB },
    ]);

    const chips = container.querySelectorAll(".preset-chip");
    (chips[0] as HTMLButtonElement).click();
    expect(clickA).toHaveBeenCalledTimes(1);
    expect(clickB).not.toHaveBeenCalled();

    (chips[1] as HTMLButtonElement).click();
    expect(clickA).toHaveBeenCalledTimes(1);
    expect(clickB).toHaveBeenCalledTimes(1);
  });

  // ------------------------------------------------------------------
  // 3. 当前选中高亮
  // ------------------------------------------------------------------

  it("isActive 返回 true 时 chip 带 'active' class", () => {
    const container = mkContainer();
    const isActiveA = vi.fn(() => true);
    buildPresetChipGroup(container, [
      { label: "Active", onClick: vi.fn(), isActive: isActiveA },
      { label: "Inactive", onClick: vi.fn(), isActive: vi.fn(() => false) },
    ]);

    const chips = container.querySelectorAll(".preset-chip");
    expect(chips[0].className).toContain("active");
    expect(chips[1].className).not.toContain("active");
    // isActive 在注册时调用一次（onUpdate 初次执行）
    expect(isActiveA).toHaveBeenCalled();
  });

  it("未提供 isActive 时 chip 不带 active class 且不注册自更新", () => {
    const container = mkContainer();
    buildPresetChipGroup(container, [
      { label: "One-shot", onClick: vi.fn() },
    ]);

    const chips = container.querySelectorAll(".preset-chip");
    expect(chips.length).toBe(1);
    expect(chips[0].className).toBe("preset-chip");
  });

  // ------------------------------------------------------------------
  // 4. 禁用/条件渲染（通过 addClearRow 验证）
  // ------------------------------------------------------------------

  describe("addClearRow", () => {
    it("hasValue 为 false 时不渲染任何元素", () => {
      const container = mkContainer();
      const onClear = vi.fn();
      addClearRow(container, false, onClear);

      expect(container.children.length).toBe(0);
      expect(onClear).not.toHaveBeenCalled();
    });

    it("hasValue 为 true 时渲染清除行 + cs-btn", () => {
      const container = mkContainer();
      const onClear = vi.fn();
      addClearRow(container, true, onClear);

      const row = container.querySelector("div[style]");
      expect(row).not.toBeNull();
      expect(container.children.length).toBe(1);
      const btn = container.querySelector(".cs-btn");
      expect(btn).not.toBeNull();
      expect(btn!.textContent).toBe("Clear");
    });

    it("点击清除按钮触发 onClear 回调", () => {
      const container = mkContainer();
      const onClear = vi.fn();
      addClearRow(container, true, onClear);

      const btn = container.querySelector(".cs-btn") as HTMLButtonElement;
      btn.click();
      expect(onClear).toHaveBeenCalledTimes(1);
    });

    it("自定义 label 文本生效", () => {
      const container = mkContainer();
      addClearRow(container, true, vi.fn(), "重置");

      const btn = container.querySelector(".cs-btn");
      expect(btn!.textContent).toBe("重置");
    });

    it("提供 testId 时设置 data-testid 属性", () => {
      const container = mkContainer();
      addClearRow(container, true, vi.fn(), "Clear", "my-clear");

      const row = container.querySelector("[data-testid=my-clear]");
      expect(row).not.toBeNull();
    });
  });

  // ------------------------------------------------------------------
  // 5. 容器样式选项
  // ------------------------------------------------------------------

  it("paddingBottom 选项设置 group 内联样式", () => {
    const container = mkContainer();
    buildPresetChipGroup(container, [{ label: "X", onClick: vi.fn() }], {
      paddingBottom: 6,
    });

    const group = container.querySelector(".preset-group")! as HTMLElement;
    expect(group.style.paddingBottom).toBe("6px");
  });

  it("className 选项追加额外类名到 group", () => {
    const container = mkContainer();
    buildPresetChipGroup(container, [{ label: "X", onClick: vi.fn() }], {
      className: "sky-group",
    });

    const group = container.querySelector(".preset-group");
    expect(group!.className).toBe("preset-group sky-group");
  });
});
