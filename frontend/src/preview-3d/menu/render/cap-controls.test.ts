// preview-menu-cap-controls.test.ts — 能力控件通用渲染器测试。
// 分两层：
//   · 简单控件渲染器（renderCapToggle/renderCapSlider/formatCapSliderValue）吃统一 CapControlView，
//     由 node 路径（render.ts 的 spec→view 适配器）直供——[增量2a] controls 通道已收窄为复杂件专用，
//     简单件不再经 renderCapControls，故本组直调渲染器。formatCapSliderValue 是纯函数（无 DOM 依赖），
//     node 环境直接测四分支：h（钟点 → HH:MM）/ %（百分比）/ 带单位（拼接）/ 无单位（toFixed2）；
//     该函数由 renderCapSlider 与 renderEnvLevel 摘要行共用——防两端分叉回归。
//   · 复杂控件走 renderCapControls（button/image/timeline/histogram/preset-thumb），测分组显隐与 testid。
import { describe, it, expect, vi } from "vitest";
import {
  capLabel,
  type CapControlView,
  formatCapSliderValue,
  renderCapControls,
  renderCapSlider,
  renderCapToggle,
} from "./cap-controls.ts";
import type { PreviewSnapshot } from "@/preview-3d/state/preview-state.ts";
import type { PreviewControlDef } from "@/preview-3d/caps/scene-capability.ts";

function makeSlider(unit?: string): CapControlView {
  return {
    id: "t",
    labelKey: "t",
    fallback: "t",
    getValue: () => 0,
    setValue: () => {},
    slider: unit ? { min: 0, max: 1, step: 0.01, unit } : { min: 0, max: 1, step: 0.01 },
  };
}

describe("formatCapSliderValue", () => {
  it("unit='h' 输出 HH:MM（小数进位分钟）", () => {
    const c = makeSlider("h");
    expect(formatCapSliderValue(c, 12)).toBe("12:00");
    expect(formatCapSliderValue(c, 9.5)).toBe("09:30");
    expect(formatCapSliderValue(c, 23.75)).toBe("23:45");
    expect(formatCapSliderValue(c, 0)).toBe("00:00");
  });

  it("unit='%' 输出百分比（乘 100 取整）", () => {
    const c = makeSlider("%");
    expect(formatCapSliderValue(c, 0.42)).toBe("42%");
    expect(formatCapSliderValue(c, 0)).toBe("0%");
    expect(formatCapSliderValue(c, 1)).toBe("100%");
  });

  it("其它 unit 直接拼接", () => {
    expect(formatCapSliderValue(makeSlider("m"), 2.5)).toBe("2.5m");
    expect(formatCapSliderValue(makeSlider("px"), 128)).toBe("128px");
  });

  it("无 unit 时 toFixed(2)", () => {
    expect(formatCapSliderValue(makeSlider(), 0.5)).toBe("0.50");
    // 整数值也保持两位小数——与 renderCapSlider 原 fmtVal 行为一致
    expect(formatCapSliderValue(makeSlider(), 1)).toBe("1.00");
  });
});

// 复杂件 helper：renderCapControls 通道现仅承载复杂 kind，用 button 作显隐/testid 探针
// （button 恒渲染行 + cap- testid，不受 getValue 影响；image 空值会跳过故不适合探针）。
function btn(id: string, extra: Partial<PreviewControlDef> = {}): PreviewControlDef {
  return {
    id,
    kind: "button",
    labelKey: id,
    fallback: id,
    button: { action: () => {} },
    getValue: () => null,
    setValue: () => {},
    ...extra,
  };
}

describe("renderCapControls — visibleWhen B 轨谓词", () => {
  const snap = (mode: "film" | "pool"): PreviewSnapshot =>
    ({ "env.waterMode": mode } as unknown as PreviewSnapshot);

  it("传 snapshot 时按 visibleWhen 隐藏/显示", () => {
    const list = document.createElement("div");
    renderCapControls(list, [
      btn("film-only", { visibleWhen: (s) => s["env.waterMode"] === "film" }),
      btn("pool-only", { visibleWhen: (s) => s["env.waterMode"] === "pool" }),
    ], snap("film"));
    expect(list.querySelector('[data-testid="cap-film-only"]')).not.toBeNull();
    expect(list.querySelector('[data-testid="cap-pool-only"]')).toBeNull();
    const list2 = document.createElement("div");
    renderCapControls(list2, [
      btn("film-only", { visibleWhen: (s) => s["env.waterMode"] === "film" }),
      btn("pool-only", { visibleWhen: (s) => s["env.waterMode"] === "pool" }),
    ], snap("pool"));
    expect(list2.querySelector('[data-testid="cap-film-only"]')).toBeNull();
    expect(list2.querySelector('[data-testid="cap-pool-only"]')).not.toBeNull();
  });

  it("无 snapshot 时 visibleWhen 被忽略，控件正常渲染（纯 B 轨容错：早期调用/DOM 冒烟不判藏）", () => {
    const list = document.createElement("div");
    renderCapControls(list, [btn("x", { visibleWhen: () => false })]);
    expect(list.querySelector('[data-testid="cap-x"]')).not.toBeNull();
  });

  it("[铁律收口] only visibleWhen：A 轨 visible 已整体删除，控件谓词只吃快照", () => {
    // 控件声明里不再存在可用的 visible 闭包字段（类型层已删）；以下断言谓词求值纯函数性：
    // film 快照下 pool-only 隐藏（与「传 snapshot 时按 visibleWhen 隐藏/显示」同构，锁定 B 轨唯一入口）
    const list = document.createElement("div");
    renderCapControls(list, [
      btn("pool-only", { visibleWhen: (s) => s["env.waterMode"] === "pool" }),
    ], snap("film"));
    expect(list.querySelector('[data-testid="cap-pool-only"]')).toBeNull();
  });
});

describe("renderCapControls — 复杂 kind testid 覆盖（增量2a 收窄后）", () => {
  it("button/timeline/histogram/preset-thumb/image 都带 cap-<id> testid", () => {
    const list = document.createElement("div");
    renderCapControls(list, [
      { id: "c-btn", kind: "button", labelKey: "c", fallback: "c", button: { action: () => {} }, getValue: () => null, setValue: () => {} },
      { id: "c-time", kind: "timeline", labelKey: "c", fallback: "c", getValue: () => 12, setValue: () => {} },
      { id: "c-hist", kind: "histogram", labelKey: "c", fallback: "c", getValue: () => [1, 2, 3], setValue: () => {} },
      { id: "c-thumb", kind: "preset-thumb", labelKey: "c", fallback: "c", getValue: () => "x", setValue: () => {}, thumb: { size: 40, options: [{ value: "a", label: "a", getThumb: () => null }], activeValue: () => "a", onSelect: () => {} } },
      { id: "c-img", kind: "image", labelKey: "c", fallback: "c", getValue: () => "https://x/y.png", setValue: () => {} },
    ]);
    for (const id of ["c-btn", "c-time", "c-hist", "c-thumb", "c-img"]) {
      expect(list.querySelector(`[data-testid="cap-${id}"]`), `${id} 应有 cap- testid`).not.toBeNull();
    }
  });

  it("image 无内容时跳过（不占位、无 testid）", () => {
    const list = document.createElement("div");
    renderCapControls(list, [
      { id: "c-img-empty", kind: "image", labelKey: "c", fallback: "c", getValue: () => null, setValue: () => {} },
    ]);
    expect(list.querySelector('[data-testid="cap-c-img-empty"]')).toBeNull();
  });
});

describe("renderCapToggle — 整行点击切换（能力自 addToggleRow 下沉，简单件走 CapControlView 直渲）", () => {
  function mkToggle() {
    let val = false;
    const setValue = vi.fn((v: unknown) => { val = Boolean(v); });
    const onChange = vi.fn();
    const view: CapControlView = {
      id: "tg",
      labelKey: "tg",
      fallback: "TG",
      getValue: () => val,
      setValue,
      onChange,
    };
    return { view, setValue, onChange };
  }

  it("点击 label 文本区（.cc-labelbox）翻转开关并触发 setValue + onChange", () => {
    const { view, setValue, onChange } = mkToggle();
    const list = document.createElement("div");
    renderCapToggle(list, view);
    const row = list.querySelector('[data-testid="cap-tg"]') as HTMLElement;
    const labelBox = row.querySelector(".cc-labelbox") as HTMLElement;
    expect(labelBox).not.toBeNull();

    labelBox.click();
    expect(setValue).toHaveBeenCalledWith(true);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("点击 toggle 本体只触发 createHeaderToggle 原生逻辑一次（防双触发）", () => {
    const { view, setValue } = mkToggle();
    const list = document.createElement("div");
    renderCapToggle(list, view);
    const toggle = list.querySelector("label.toggle") as HTMLElement;
    expect(toggle).not.toBeNull();

    toggle.click();
    // createHeaderToggle 自身 handler 翻转一次；row 级监听须跳过 toggle 区域不重复翻转
    expect(setValue).toHaveBeenCalledTimes(1);
    expect(setValue).toHaveBeenCalledWith(true);
  });

  it("连续点击 label 区：状态来回翻转", () => {
    const { view, setValue } = mkToggle();
    const list = document.createElement("div");
    renderCapToggle(list, view);
    const labelBox = list.querySelector(".cc-labelbox") as HTMLElement;

    labelBox.click();
    labelBox.click();
    expect(setValue).toHaveBeenNthCalledWith(1, true);
    expect(setValue).toHaveBeenNthCalledWith(2, false);
  });
});

describe("renderCapSlider — 自绘 cs-bar 结构（能力自 ui-rows addSliderRow 下沉，简单件走 CapControlView 直渲）", () => {
  function mkSlider(extra: Partial<CapControlView> = {}): CapControlView {
    return {
      id: "s",
      labelKey: "s",
      fallback: "S",
      getValue: () => 0.4,
      setValue: () => {},
      slider: { min: 0, max: 1, step: 0.01 },
      ...extra,
    };
  }

  it("渲染 .cs-bar + .cs-fill + .cs-thumb，role=slider + aria 带初始值，fill 宽度=值比例", () => {
    const list = document.createElement("div");
    renderCapSlider(list, mkSlider());
    const row = list.querySelector('[data-testid="cap-s"]') as HTMLElement;
    const bar = row.querySelector(".cs-bar") as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.getAttribute("role")).toBe("slider");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("1");
    expect(bar.getAttribute("aria-valuenow")).toBe("0.4");
    const fill = row.querySelector(".cs-fill") as HTMLElement;
    const thumb = row.querySelector(".cs-thumb") as HTMLElement;
    expect(fill).not.toBeNull();
    expect(thumb).not.toBeNull();
    expect(fill.style.width).toBe("40%");
    expect(thumb.style.left).toBe("40%");
  });

  it("键盘 ←→ 步进：更新值 + setValue + onChange + aria-valuenow", () => {
    let val = 0;
    const setValue = vi.fn((v: unknown) => { val = Number(v); });
    const onChange = vi.fn();
    const list = document.createElement("div");
    renderCapSlider(list, mkSlider({
      getValue: () => val,
      setValue,
      onChange,
      slider: { min: 0, max: 10, step: 1 },
    }));
    const bar = list.querySelector('[data-testid="cap-s"] .cs-bar') as HTMLElement;
    bar.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(val).toBe(1);
    expect(setValue).toHaveBeenCalledWith(1);
    expect(onChange).toHaveBeenCalledWith(1);
    expect(bar.getAttribute("aria-valuenow")).toBe("1");
  });

  it("单击轨道跳转触发 onChange + onCommit（对齐原生 range change 语义）", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const list = document.createElement("div");
    renderCapSlider(list, mkSlider({
      getValue: () => 0,
      setValue: () => {},
      onChange,
      slider: { min: 0, max: 10, step: 1, onCommit },
    }));
    const bar = list.querySelector('[data-testid="cap-s"] .cs-bar') as HTMLElement;
    // mock rect 后 click 50% 位置 → 值 5
    Object.defineProperty(bar, "getBoundingClientRect", {
      value: () => ({ left: 0, width: 200, right: 200, top: 0, bottom: 20, height: 20, x: 0, y: 0 }),
      configurable: true,
    });
    bar.dispatchEvent(new MouseEvent("click", { clientX: 100, bubbles: true }));
    expect(onChange).toHaveBeenCalledWith(5);
    expect(onCommit).toHaveBeenCalledWith(5);
  });

  it("unit='%' 时值显示百分比（formatCapSliderValue 联动）", () => {
    const list = document.createElement("div");
    renderCapSlider(list, mkSlider({
      getValue: () => 0.42,
      slider: { min: 0, max: 1, step: 0.05, unit: "%" },
    }));
    const row = list.querySelector('[data-testid="cap-s"]') as HTMLElement;
    const val = row.querySelector(".cc-head span:last-child") as HTMLElement;
    expect(val.textContent).toBe("42%");
  });
});

// ===== 动态明文标签回退（2026-09 表情界面整列无文字修复回归锁）=====
// morph 面板每行 = kind:"toggle" 节点，表情名只写 node.label（动态数据不进 i18n）。
// nodeControlToView 将 labelKey 置空串、明文装入 fallback；渲染器若只读 labelKey，
// tOf("") 三级回退仍落回裸空 key → label 被写成空串，整列表情只剩开关没有文字。
// 骨骼面板不受影响：它是 sanctioned renderCustom（vrm-bone-ui 直接 textContent = name）。
describe("capLabel — labelKey / fallback 回退分工", () => {
  it("labelKey 非空 → 走 tOf（优先于 fallback 明文）", () => {
    expect(capLabel({ labelKey: "preview.perceptionBreath", fallback: "FB" })).toBe("呼吸");
  });

  it("labelKey 空串 → 直取 fallback 明文（不进 i18n，否则回退成空白）", () => {
    expect(capLabel({ labelKey: "", fallback: "Left Breast Squish Inwards" })).toBe(
      "Left Breast Squish Inwards",
    );
  });
});

describe("renderCapToggle / renderCapSlider — 只声明 fallback 的动态名（表情名）上屏", () => {
  const morphView = (over: Partial<CapControlView> = {}): CapControlView => ({
    id: "morph-哀",
    labelKey: "",
    fallback: "哀",
    getValue: () => false,
    setValue: () => {},
    ...over,
  });

  it("toggle 行 .slide-label 渲染表情名（不为空串）", () => {
    const list = document.createElement("div");
    renderCapToggle(list, morphView());
    const label = list.querySelector('[data-testid="cap-morph-哀"] .slide-label') as HTMLElement;
    expect(label).not.toBeNull();
    expect(label.textContent).toBe("哀");
  });

  it("slider 头部标题与 aria-label 同源取 fallback", () => {
    const list = document.createElement("div");
    renderCapSlider(
      list,
      morphView({ getValue: () => 0.5, slider: { min: 0, max: 1, step: 0.01 } }),
    );
    const row = list.querySelector('[data-testid="cap-morph-哀"]') as HTMLElement;
    expect(row.querySelector(".cc-head .slide-label")?.textContent).toBe("哀");
    expect(row.querySelector(".cs-bar")?.getAttribute("aria-label")).toBe("哀");
  });
});
