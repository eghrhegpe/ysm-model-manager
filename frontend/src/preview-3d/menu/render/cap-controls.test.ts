// preview-menu-cap-controls.test.ts — 能力控件通用渲染器测试。
// 分两层：
//   · 简单控件渲染器（renderCapToggle/renderCapSlider/formatCapSliderValue）吃统一 CapControlView，
//     由 node 路径（render.ts 的 spec→view 适配器）直供——[增量2a] controls 通道已收窄为复杂件专用，
//     简单件不再经 renderCapControls，故本组直调渲染器。formatCapSliderValue 是纯函数（无 DOM 依赖），
//     node 环境直接测四分支：h（钟点 → HH:MM）/ %（百分比）/ 带单位（拼接）/ 无单位（toFixed2）；
//     该函数由 renderCapSlider 与 renderEnvLevel 摘要行共用——防两端分叉回归。
//   · 复杂控件走 renderCapControls（image/timeline/histogram/preset-thumb；button 已迁节点原生 kind），测分组显隐与 testid。
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
import type { LocaleKey } from "@/core/i18n/t.ts";

function makeSlider(unit?: string): CapControlView {
  return {
    id: "t",
    labelKey: "t" as LocaleKey,
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

describe("renderCapSlider — hint 槽位（[P1-2] 动态 getHint / 静态 hintKey 回退）", () => {
  it("动态 getHint 渲染于 label 右侧；无 hint 时零占位（display:none，不挤 head 布局）", () => {
    const host = document.createElement("div");
    renderCapSlider(host, { ...makeSlider("m"), getHint: () => "实际生效 0.06 m" });
    const hint = host.querySelector(".cc-hint") as HTMLElement;
    expect(hint.textContent).toBe("实际生效 0.06 m");
    expect(hint.style.display, "有 hint 时须可见").not.toBe("none");

    const host2 = document.createElement("div");
    renderCapSlider(host2, makeSlider("m"));
    const h2 = host2.querySelector(".cc-hint") as HTMLElement;
    expect(h2.textContent).toBe("");
    expect(h2.style.display, "无 hint 的滑杆不占位").toBe("none");
  });

  it("拖动后 hint 取**钳后新值**：刷新在 setValue 之后（否则滞后一步显示上一拍）", () => {
    const host = document.createElement("div");
    let effective = 0.06;
    const view: CapControlView = {
      ...makeSlider("m"),
      getValue: () => 0.06,
      setValue: (n) => {
        effective = Math.min(Number(n), 0.15); // 模拟 cap 侧 effectiveWaveHeight 钳制
      },
      getHint: () => `实际生效 ${effective.toFixed(2)} m`,
    };
    renderCapSlider(host, view);
    expect(host.querySelector(".cc-hint")!.textContent).toBe("实际生效 0.06 m");
    const bar = host.querySelector(".cs-bar") as HTMLElement;
    bar.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(
      host.querySelector(".cc-hint")!.textContent,
      "hint 须反映 setValue 后的新状态（钳到 0.15，而非滑杆原值 1.00）",
    ).toBe("实际生效 0.15 m");
  });
});

// 复杂件 helper：renderCapControls 通道现仅承载复杂 kind（button 已迁节点原生 kind，
// rmAppendButton 按钮臂），用 timeline 作显隐/testid 探针
// （timeline 恒渲染行 + cap- testid，不受 getValue 影响；image 空值会跳过故不适合探针）。
function probe(id: string, extra: Partial<PreviewControlDef> = {}): PreviewControlDef {
  return {
    id,
    kind: "timeline",
    labelKey: id as LocaleKey,
    fallback: id,
    getValue: () => 12,
    setValue: () => {},
    ...extra,
  };
}

describe("renderCapControls — visibleWhen B 轨谓词", () => {
  const snap = (mode: "film" | "pool"): PreviewSnapshot =>
    ({ "cap.waterMode": mode } as unknown as PreviewSnapshot);

  it("传 snapshot 时按 visibleWhen 隐藏/显示", () => {
    const list = document.createElement("div");
    renderCapControls(list, [
      probe("film-only", { visibleWhen: (s) => s["cap.waterMode"] === "film" }),
      probe("pool-only", { visibleWhen: (s) => s["cap.waterMode"] === "pool" }),
    ], snap("film"));
    expect(list.querySelector('[data-testid="cap-film-only"]')).not.toBeNull();
    expect(list.querySelector('[data-testid="cap-pool-only"]')).toBeNull();
    const list2 = document.createElement("div");
    renderCapControls(list2, [
      probe("film-only", { visibleWhen: (s) => s["cap.waterMode"] === "film" }),
      probe("pool-only", { visibleWhen: (s) => s["cap.waterMode"] === "pool" }),
    ], snap("pool"));
    expect(list2.querySelector('[data-testid="cap-film-only"]')).toBeNull();
    expect(list2.querySelector('[data-testid="cap-pool-only"]')).not.toBeNull();
  });

  it("无 snapshot 时 visibleWhen 被忽略，控件正常渲染（纯 B 轨容错：早期调用/DOM 冒烟不判藏）", () => {
    const list = document.createElement("div");
    renderCapControls(list, [probe("x", { visibleWhen: () => false })]);
    expect(list.querySelector('[data-testid="cap-x"]')).not.toBeNull();
  });

  it("[铁律收口] only visibleWhen：A 轨 visible 已整体删除，控件谓词只吃快照", () => {
    // 控件声明里不再存在可用的 visible 闭包字段（类型层已删）；以下断言谓词求值纯函数性：
    // film 快照下 pool-only 隐藏（与「传 snapshot 时按 visibleWhen 隐藏/显示」同构，锁定 B 轨唯一入口）
    const list = document.createElement("div");
    renderCapControls(list, [
      probe("pool-only", { visibleWhen: (s) => s["cap.waterMode"] === "pool" }),
    ], snap("film"));
    expect(list.querySelector('[data-testid="cap-pool-only"]')).toBeNull();
  });
});

describe("renderCapControls — 复杂 kind testid 覆盖（增量2a 收窄后）", () => {
  it("timeline/histogram/preset-thumb/image 都带 cap-<id> testid（button 已迁节点原生 kind）", () => {
    const list = document.createElement("div");
    renderCapControls(list, [
      { id: "c-time", kind: "timeline", labelKey: "c" as LocaleKey, fallback: "c", getValue: () => 12, setValue: () => {} },
      { id: "c-hist", kind: "histogram", labelKey: "c" as LocaleKey, fallback: "c", getValue: () => [1, 2, 3], setValue: () => {} },
      { id: "c-thumb", kind: "preset-thumb", labelKey: "c" as LocaleKey, fallback: "c", getValue: () => "x", setValue: () => {}, thumb: { size: 40, options: [{ value: "a", label: "a", getThumb: () => null }], activeValue: () => "a", onSelect: () => {} } },
      { id: "c-img", kind: "image", labelKey: "c" as LocaleKey, fallback: "c", getValue: () => "https://x/y.png", setValue: () => {} },
    ]);
    for (const id of ["c-time", "c-hist", "c-thumb", "c-img"]) {
      expect(list.querySelector(`[data-testid="cap-${id}"]`), `${id} 应有 cap- testid`).not.toBeNull();
    }
  });

  it("image 无内容时跳过（不占位、无 testid）", () => {
    const list = document.createElement("div");
    renderCapControls(list, [
      { id: "c-img-empty", kind: "image", labelKey: "c" as LocaleKey, fallback: "c", getValue: () => null, setValue: () => {} },
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
      labelKey: "tg" as LocaleKey,
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
      labelKey: "s" as LocaleKey,
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
    expect(capLabel({ labelKey: "" as LocaleKey, fallback: "Left Breast Squish Inwards" })).toBe(
      "Left Breast Squish Inwards",
    );
  });
});

describe("renderCapToggle / renderCapSlider — 只声明 fallback 的动态名（表情名）上屏", () => {
  const morphView = (over: Partial<CapControlView> = {}): CapControlView => ({
    id: "morph-哀",
    labelKey: "" as LocaleKey,
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

// ===== [2026-10 锐评 P1-3] 控件级 disabled 通道（button 专属 → 通用） =====
// 背景：后处理子开关在总开关关闭时写入无可见效果（composer 未建/未参与每帧），
// 原实现照常可点 → 「开了没反应」。修复 = 灰化 + 阻断交互 + title 说明原因，
// 而非惰性建 composer（那会重开 ADR-299 关掉的默认路径过载）。
describe("[锐评 P1-3] 控件级 disabled 通道", () => {
  function view(over: Partial<CapControlView> = {}): CapControlView {
    return {
      id: "t",
      labelKey: "t" as LocaleKey,
      fallback: "t",
      getValue: () => 0.5,
      setValue: () => {},
      slider: { min: 0, max: 1, step: 0.01 },
      ...over,
    };
  }

  it("disabled() 为 true → 行标注 aria-disabled/data-disabled 并阻断指针交互", () => {
    const list = document.createElement("div");
    renderCapToggle(list, view({ disabled: () => true }));
    const row = list.querySelector('[data-testid="cap-t"]') as HTMLElement;
    expect(row.getAttribute("aria-disabled")).toBe("true");
    expect(row.dataset.disabled).toBe("true");
    expect(row.classList.contains("cc-disabled")).toBe(true);
    expect(row.style.pointerEvents).toBe("none");
  });

  it("disabled() 为 false → 不标注禁用态（不得误灰化）", () => {
    const list = document.createElement("div");
    renderCapToggle(list, view({ disabled: () => false }));
    const row = list.querySelector('[data-testid="cap-t"]') as HTMLElement;
    expect(row.getAttribute("aria-disabled")).toBeNull();
    expect(row.classList.contains("cc-disabled")).toBe(false);
    expect(row.style.pointerEvents).not.toBe("none");
  });

  it("未声明 disabled → 保持可交互（既有节点行为不变）", () => {
    const list = document.createElement("div");
    renderCapToggle(list, view());
    const row = list.querySelector('[data-testid="cap-t"]') as HTMLElement;
    expect(row.getAttribute("aria-disabled")).toBeNull();
  });

  it("slider 禁用：cs-bar 标 aria-disabled 且移出 Tab 序", () => {
    const list = document.createElement("div");
    renderCapSlider(list, view({ disabled: () => true }));
    const bar = list.querySelector(".cs-bar") as HTMLElement;
    expect(bar.getAttribute("aria-disabled")).toBe("true");
    expect(bar.tabIndex).toBe(-1);
  });

  it("禁用原因经 title 暴露（四臂一致，含无 hint 槽位的 slider）", () => {
    const list = document.createElement("div");
    renderCapSlider(list, view({ disabled: () => true }));
    const row = list.querySelector('[data-testid="cap-t"]') as HTMLElement;
    expect(row.title.length).toBeGreaterThan(0);
  });
});
