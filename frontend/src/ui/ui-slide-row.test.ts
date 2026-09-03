// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  slideRow,
  createTrailingBtn,
  createLeadingBtn,
} from "./ui-slide-row.ts";
import { setControlRegistry } from "./control-registry.ts";

// 每次测试前：清空 body + 断开 control-registry 外部接入（避免 ui-header-toggle 污染）
beforeEach(() => {
  document.body.innerHTML = "";
  setControlRegistry(null);
});

// ===== 辅助 =====

const makeContainer = () => {
  const c = document.createElement("div");
  document.body.appendChild(c);
  return c;
};

const makeOnClick = (): [() => void, boolean[]] => {
  const hits: boolean[] = [];
  const fn = () => hits.push(true);
  return [fn, hits];
};

// ===================================================================
// A. 基础 DOM 结构（非 headerToggle 路径）
// ===================================================================

describe("slideRow 基础结构", () => {
  it("返回 row，且 row 已 append 到传入 container", () => {
    const container = makeContainer();
    const row = slideRow(container, "▶", "播放", false, () => {});
    expect(container.contains(row)).toBe(true);
    expect(row).toBe(container.lastElementChild);
  });

  it("row 具备 slide-item class 与 role=button, tabIndex=0", () => {
    const container = makeContainer();
    const row = slideRow(container, "▶", "播放", false, () => {});
    expect(row.className).toBe("slide-item");
    expect(row.getAttribute("role")).toBe("button");
    expect(row.tabIndex).toBe(0);
  });

  it("focused=true → 追加 slide-focused class", () => {
    const container = makeContainer();
    const row = slideRow(container, "▶", "播放", false, () => {}, "", "", true);
    expect(row.className).toBe("slide-item slide-focused");
  });
});

// ===================================================================
// B. 图标渲染（glyph vs iconify 兜底）
// ===================================================================

describe("图标渲染", () => {
  it("glyph 图标 '▶' → 渲染为 .slide-icon > .cs-icon", () => {
    const container = makeContainer();
    const row = slideRow(container, "▶", "播放", false, () => {});
    const iconSpan = row.querySelector(".slide-icon");
    expect(iconSpan).not.toBeNull();
    const cs = iconSpan!.querySelector(".cs-icon");
    expect(cs).not.toBeNull();
    expect(cs!.textContent).toBe("▶");
  });

  it("iconify 风格名 'lucide:settings-2' → 走兜底 .cs-icon-fallback，文本为 label 首字", () => {
    const container = makeContainer();
    const row = slideRow(container, "lucide:settings-2", "播放", false, () => {});
    const iconSpan = row.querySelector(".slide-icon");
    expect(iconSpan).not.toBeNull();
    const fb = iconSpan!.querySelector(".cs-icon-fallback");
    expect(fb).not.toBeNull();
    expect(fb!.textContent).toBe("播");
  });

  it("label 为空字符串 → 兜底文本为 '?'", () => {
    const container = makeContainer();
    const row = slideRow(container, "lucide:x", "", false, () => {});
    const fb = row.querySelector(".cs-icon-fallback");
    expect(fb!.textContent).toBe("?");
  });

  it("iconFactory → 直接调用并挂到 .slide-icon 内", () => {
    const factory = vi.fn(() => {
      const el = document.createElement("span");
      el.className = "custom-icon";
      el.textContent = "★";
      return el;
    });
    const container = makeContainer();
    const row = slideRow(
      container,
      "▶",
      "播放",
      false,
      () => {},
      "",
      "",
      false,
      undefined,
      { iconFactory: factory },
    );
    expect(factory).toHaveBeenCalledTimes(1);
    const iconSpan = row.querySelector(".slide-icon");
    expect(iconSpan!.contains(factory.mock.results[0].value)).toBe(true);
  });

  it("iconFactory 返回 null → 不追加子节点", () => {
    const factory = () => (null as unknown as HTMLElement);
    const container = makeContainer();
    const row = slideRow(
      container,
      "▶",
      "播放",
      false,
      () => {},
      "",
      "",
      false,
      undefined,
      { iconFactory: factory },
    );
    const iconSpan = row.querySelector(".slide-icon");
    expect(iconSpan!.children.length).toBe(0);
  });
});

// ===================================================================
// C. leading 行为区（radio 等指示）
// ===================================================================

describe("leading 行为区", () => {
  it("extra.leading → 渲染 .slide-lead-btn，且不再渲染 .slide-icon", () => {
    const container = makeContainer();
    const row = slideRow(
      container,
      "▶",
      "播放",
      false,
      () => {},
      "",
      "",
      false,
      undefined,
      { leading: { icon: "•", onClick: vi.fn() } },
    );
    const leadBtn = row.querySelector(".slide-lead-btn");
    expect(leadBtn).not.toBeNull();
    // 无 icon 占位
    expect(row.querySelector(".slide-icon")).toBeNull();
  });

  it("leading 点击触发 onClick 且不冒泡", () => {
    const container = makeContainer();
    const leadClick = vi.fn();
    const rowClick = vi.fn();
    const row = slideRow(
      container,
      "▶",
      "播放",
      false,
      rowClick,
      "",
      "",
      false,
      undefined,
      { leading: { icon: "•", onClick: leadClick } },
    );

    (row.querySelector(".slide-lead-btn") as HTMLElement).click();
    expect(leadClick).toHaveBeenCalledTimes(1);
    expect(rowClick).not.toHaveBeenCalled();
  });
});

// ===================================================================
// D. hideIcon：完全隐藏左侧图标占位
// ===================================================================

describe("hideIcon", () => {
  it("hideIcon=true 且不传 leading → 不渲染 .slide-icon 也不渲染 .slide-lead-btn", () => {
    const container = makeContainer();
    const row = slideRow(
      container,
      "▶",
      "字段名",
      false,
      () => {},
      "",
      "",
      false,
      undefined,
      { hideIcon: true, rightLabel: "字段值" },
    );
    expect(row.querySelector(".slide-icon")).toBeNull();
    expect(row.querySelector(".slide-lead-btn")).toBeNull();
  });
});

// ===================================================================
// E. rightLabel（key-value 布局）
// ===================================================================

describe("rightLabel", () => {
  it("extra.rightLabel → 渲染 .field-label + .field-value", () => {
    const container = makeContainer();
    const row = slideRow(
      container,
      "▶",
      "名称",
      false,
      () => {},
      "",
      "",
      false,
      undefined,
      { rightLabel: "value" },
    );
    expect(row.querySelector(".field-label")!.textContent).toBe("名称");
    expect(row.querySelector(".field-value")!.textContent).toBe("value");
    // 注意：field-label 同时挂 .slide-label 类（源码：'slide-label field-label'）
    expect(row.querySelector(".slide-label.field-label")).not.toBeNull();
  });

  it("rightLabel=undefined → 走普通 slide-label 分支", () => {
    const container = makeContainer();
    const row = slideRow(container, "▶", "播放", false, () => {});
    expect(row.querySelector(".slide-label")!.textContent).toBe("播放");
    expect(row.querySelector(".field-value")).toBeNull();
  });
});

// ===================================================================
// F. variant：danger / accent
// ===================================================================

describe("variant", () => {
  it("variant='danger' → slide-label 追加 danger-text", () => {
    const container = makeContainer();
    const row = slideRow(
      container,
      "▶",
      "危险",
      false,
      () => {},
      "",
      "",
      false,
      undefined,
      { variant: "danger" },
    );
    const label = row.querySelector(".slide-label")!;
    expect(label.className).toContain("slide-label");
    expect(label.className).toContain("danger-text");
  });

  it("variant='accent' → slide-label 追加 accent-text", () => {
    const container = makeContainer();
    const row = slideRow(
      container,
      "▶",
      "高亮",
      false,
      () => {},
      "",
      "",
      false,
      undefined,
      { variant: "accent" },
    );
    expect(row.querySelector(".slide-label")!.className).toContain("accent-text");
  });

  it("variant='default'（默认）→ 仅 slide-label", () => {
    const container = makeContainer();
    const row = slideRow(container, "▶", "播放", false, () => {});
    expect(row.querySelector(".slide-label")!.className).toBe("slide-label");
  });
});

// ===================================================================
// G. wrapLabel / inlineSub
// ===================================================================

describe("标签修饰", () => {
  it("wrapLabel=true → slide-label 追加 wrap-2", () => {
    const container = makeContainer();
    const row = slideRow(
      container,
      "▶",
      "极长的文件名.ysm",
      false,
      () => {},
      "",
      "",
      false,
      undefined,
      { wrapLabel: true },
    );
    expect(row.querySelector(".slide-label")!.className).toContain("wrap-2");
  });

  it("sublabel → 渲染 .slide-sublabel", () => {
    const container = makeContainer();
    const row = slideRow(container, "▶", "播放", false, () => {}, "副标题");
    expect(row.querySelector(".slide-sublabel")!.textContent).toBe("副标题");
  });

  it("inlineSub=true → .slide-sublabel 追加 slide-sublabel-inline", () => {
    const container = makeContainer();
    const row = slideRow(
      container,
      "▶",
      "播放",
      false,
      () => {},
      "副标题",
      "",
      false,
      undefined,
      { inlineSub: true },
    );
    const sub = row.querySelector(".slide-sublabel")!;
    expect(sub.className).toContain("slide-sublabel-inline");
  });
});

// ===================================================================
// H. trailing 行为区 与 hasArrow 互斥
// ===================================================================

describe("trailing 与箭头", () => {
  it("hasArrow=true 且无 trailing → 渲染 .slide-arrow '>'", () => {
    const container = makeContainer();
    const row = slideRow(container, "▶", "进入", true, () => {});
    const arrow = row.querySelector(".slide-arrow");
    expect(arrow).not.toBeNull();
    expect(arrow!.textContent).toBe(">");
  });

  it("extra.trailing 传入 → 渲染 .slide-add-btn，且不渲染 > 箭头", () => {
    const container = makeContainer();
    const row = slideRow(
      container,
      "▶",
      "播放",
      true,
      () => {},
      "",
      "",
      false,
      undefined,
      { trailing: { icon: "✕", onClick: vi.fn() } },
    );
    const tBtn = row.querySelector(".slide-add-btn");
    expect(tBtn).not.toBeNull();
    expect(row.querySelector(".slide-arrow")).toBeNull();
  });

  it("trailing.danger=true → 追加 slide-act-danger", () => {
    const container = makeContainer();
    const row = slideRow(
      container,
      "▶",
      "删除",
      false,
      () => {},
      "",
      "",
      false,
      undefined,
      { trailing: { icon: "✕", danger: true, onClick: vi.fn() } },
    );
    expect(row.querySelector(".slide-add-btn")!.className).toContain("slide-act-danger");
  });

  it("trailing 点击触发 onClick 且不冒泡到整行", () => {
    const container = makeContainer();
    const trailClick = vi.fn();
    const rowClick = vi.fn();
    const row = slideRow(
      container,
      "▶",
      "播放",
      false,
      rowClick,
      "",
      "",
      false,
      undefined,
      { trailing: { icon: "✕", onClick: trailClick } },
    );

    (row.querySelector(".slide-add-btn") as HTMLElement).click();
    expect(trailClick).toHaveBeenCalledTimes(1);
    expect(rowClick).not.toHaveBeenCalled();
  });
});

// ===================================================================
// I. click：选中文字时不触发 onClick
// ===================================================================

describe("整行 click", () => {
  it("点击 row → 触发 onClick", () => {
    const container = makeContainer();
    const [fn, hits] = makeOnClick();
    const row = slideRow(container, "▶", "播放", false, fn);
    row.click();
    expect(hits.length).toBe(1);
  });

  it("点击 row 有文字选中时不触发 onClick（getSelection().toString() 非空）", () => {
    const container = makeContainer();
    const [fn, hits] = makeOnClick();
    const row = slideRow(container, "▶", "播放", false, fn);

    // 用 spy 让 getSelection 返回非空
    const selSpy = vi.spyOn(window, "getSelection").mockReturnValueOnce({
      toString: () => "选中的文字",
    } as Selection);
    row.click();
    selSpy.mockRestore();
    expect(hits.length).toBe(0);
  });
});

// ===================================================================
// J. data-testid 测试钩子
// ===================================================================

describe("testId 测试钩子", () => {
  it("extra.testId → row 设置 data-testid 属性", () => {
    const container = makeContainer();
    const row = slideRow(
      container,
      "▶",
      "播放",
      false,
      () => {},
      "",
      "",
      false,
      undefined,
      { testId: "row-play" },
    );
    expect(row.getAttribute("data-testid")).toBe("row-play");
  });

  it("未传 testId → 不设置 data-testid", () => {
    const container = makeContainer();
    const row = slideRow(container, "▶", "播放", false, () => {});
    expect(row.getAttribute("data-testid")).toBeNull();
  });
});

// ===================================================================
// K. headerToggle 路径：可折叠头部
// ===================================================================

describe("headerToggle 路径", () => {
  it("传入 headerToggle → 使用 collapsible-header class", () => {
    const container = makeContainer();
    const onChange = vi.fn();
    const row = slideRow(
      container,
      "▶",
      "分组",
      true,
      () => {},
      "",
      "",
      false,
      { value: false, onChange },
    );
    expect(row.className).toBe("collapsible-header");
    expect(row.getAttribute("role")).toBe("button");
    expect(row.tabIndex).toBe(0);
  });

  it("headerToggle 路径：图标渲染为 .collapsible-icon > .cs-icon", () => {
    const container = makeContainer();
    const row = slideRow(
      container,
      "▶",
      "分组",
      false,
      () => {},
      "",
      "",
      false,
      { value: false, onChange: vi.fn() },
    );
    const iconSpan = row.querySelector(".collapsible-icon");
    expect(iconSpan).not.toBeNull();
    expect(iconSpan!.querySelector(".cs-icon")!.textContent).toBe("▶");
  });

  it("headerToggle + iconify 名 → 兜底 .cs-icon-fallback", () => {
    const container = makeContainer();
    const row = slideRow(
      container,
      "lucide:folder",
      "分组",
      false,
      () => {},
      "",
      "",
      false,
      { value: false, onChange: vi.fn() },
    );
    const fb = row.querySelector(".cs-icon-fallback");
    expect(fb!.textContent).toBe("分");
  });

  it("headerToggle 路径：label 渲染为 .collapsible-label", () => {
    const container = makeContainer();
    const row = slideRow(
      container,
      "▶",
      "分组标题",
      false,
      () => {},
      "",
      "",
      false,
      { value: false, onChange: vi.fn() },
    );
    expect(row.querySelector(".collapsible-label")!.textContent).toBe("分组标题");
  });

  it("headerToggle + sublabel → 追加 .slide-sublabel", () => {
    const container = makeContainer();
    const row = slideRow(
      container,
      "▶",
      "分组",
      false,
      () => {},
      "3 项",
      "",
      false,
      { value: false, onChange: vi.fn() },
    );
    expect(row.querySelector(".slide-sublabel")!.textContent).toBe("3 项");
  });

  it("headerToggle 无 sublabel → 不渲染 slide-sublabel", () => {
    const container = makeContainer();
    const row = slideRow(
      container,
      "▶",
      "分组",
      false,
      () => {},
      "",
      "",
      false,
      { value: false, onChange: vi.fn() },
    );
    expect(row.querySelector(".slide-sublabel")).toBeNull();
  });

  it("headerToggle + hasArrow → 追加 .collapsible-arrow '▾'", () => {
    const container = makeContainer();
    const row = slideRow(
      container,
      "▶",
      "分组",
      true,
      () => {},
      "",
      "",
      false,
      { value: false, onChange: vi.fn() },
    );
    const arrow = row.querySelector(".collapsible-arrow");
    expect(arrow).not.toBeNull();
    expect(arrow!.textContent).toBe("▾");
  });

  it("headerToggle + hasArrow=false → 不渲染箭头", () => {
    const container = makeContainer();
    const row = slideRow(
      container,
      "▶",
      "分组",
      false,
      () => {},
      "",
      "",
      false,
      { value: false, onChange: vi.fn() },
    );
    expect(row.querySelector(".collapsible-arrow")).toBeNull();
  });

  it("headerToggle 内部渲染 .toggle.header-toggle label", () => {
    const container = makeContainer();
    const row = slideRow(
      container,
      "▶",
      "分组",
      false,
      () => {},
      "",
      "",
      false,
      { value: false, onChange: vi.fn() },
    );
    const toggle = row.querySelector(".header-toggle");
    expect(toggle).not.toBeNull();
    expect(toggle!.tagName.toLowerCase()).toBe("label");
  });

  it("headerToggle 点击 row → 触发 onClick", () => {
    const container = makeContainer();
    const [fn, hits] = makeOnClick();
    const row = slideRow(
      container,
      "▶",
      "分组",
      false,
      fn,
      "",
      "",
      false,
      { value: false, onChange: vi.fn() },
    );
    row.click();
    expect(hits.length).toBe(1);
  });

  it("headerToggle 有文字选中 → 不触发 onClick", () => {
    const container = makeContainer();
    const [fn, hits] = makeOnClick();
    const row = slideRow(
      container,
      "▶",
      "分组",
      false,
      fn,
      "",
      "",
      false,
      { value: false, onChange: vi.fn() },
    );
    const selSpy2 = vi.spyOn(window, "getSelection").mockReturnValueOnce({
      toString: () => "sel",
    } as Selection);
    row.click();
    selSpy2.mockRestore();
    expect(hits.length).toBe(0);
  });

  it("headerToggle + testId → row 同时带 data-testid", () => {
    const container = makeContainer();
    const row = slideRow(
      container,
      "▶",
      "分组",
      false,
      () => {},
      "",
      "",
      false,
      { value: false, onChange: vi.fn() },
      { testId: "row-header-group" },
    );
    expect(row.getAttribute("data-testid")).toBe("row-header-group");
    expect(row.className).toBe("collapsible-header");
  });
});

// ===================================================================
// L. createTrailingBtn / createLeadingBtn 工厂
// ===================================================================

describe("createTrailingBtn", () => {
  it("返回 span.slide-add-btn", () => {
    const btn = createTrailingBtn({ icon: "✕", onClick: vi.fn() });
    expect(btn.tagName.toLowerCase()).toBe("span");
    expect(btn.className).toBe("slide-add-btn");
  });

  it("glyph 图标 → buildActionBtn 直接走 textContent（不经 createIcon，无 .cs-icon 子节点）", () => {
    const btn = createTrailingBtn({ icon: "✕", onClick: vi.fn() });
    // buildActionBtn 仅当 icon 含 ':' 才走 createIcon；纯字形直接设 textContent
    expect(btn.querySelector(".cs-icon")).toBeNull();
    expect(btn.textContent).toBe("✕");
  });

  it("iconify 风格名 → 走文本兜底（无 cs-icon 子节点）", () => {
    const btn = createTrailingBtn({
      icon: "lucide:settings-2",
      onClick: vi.fn(),
    });
    expect(btn.querySelector(".cs-icon")).toBeNull();
    expect(btn.textContent).toBe("lucide:settings-2");
  });

  it("danger=true → 追加 slide-act-danger class", () => {
    const btn = createTrailingBtn({ icon: "✕", danger: true, onClick: vi.fn() });
    expect(btn.className).toBe("slide-add-btn slide-act-danger");
  });

  it("title 写入 btn.title", () => {
    const btn = createTrailingBtn({ icon: "✕", title: "删除", onClick: vi.fn() });
    expect(btn.title).toBe("删除");
  });

  it("未传 title → btn.title 为空字符串", () => {
    const btn = createTrailingBtn({ icon: "✕", onClick: vi.fn() });
    expect(btn.title).toBe("");
  });

  it("click 调用 act.onClick 并 stopPropagation", () => {
    const onClick = vi.fn();
    const btn = createTrailingBtn({ icon: "✕", onClick });
    const ev = new MouseEvent("click", { bubbles: true });
    btn.dispatchEvent(ev);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(ev.cancelBubble).toBe(true);
  });
});

describe("createLeadingBtn", () => {
  it("返回 span.slide-lead-btn", () => {
    const btn = createLeadingBtn({ icon: "•", onClick: vi.fn() });
    expect(btn.tagName.toLowerCase()).toBe("span");
    expect(btn.className).toBe("slide-lead-btn");
  });

  it("danger=true → 追加 slide-act-danger", () => {
    const btn = createLeadingBtn({ icon: "•", danger: true, onClick: vi.fn() });
    expect(btn.className).toBe("slide-lead-btn slide-act-danger");
  });

  it("click 调用 act.onClick", () => {
    const onClick = vi.fn();
    const btn = createLeadingBtn({ icon: "•", onClick });
    btn.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});