// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from "vitest";

import { createSlideMenu, type SlideMenuView } from "../ui-slide-menu.ts";
import * as focusRestore from "../../utils/dom/focus-restore.ts";

/** 真实场景 menu.root 会被挂进 DOM（preview-menu/core.ts：popup.appendChild(menu.root)）；
 *  未连接的元素 focus() 在 happy-dom 无效（activeElement 停在 BODY）——测试必须挂载。 */
function mountMenu(): ReturnType<typeof createSlideMenu> {
  const h = createSlideMenu();
  document.body.appendChild(h.root);
  return h;
}

// ===================================================================
// 测试辅助：构造视图工厂
// ===================================================================

const makeView = (title: string, initialContent?: string): SlideMenuView => ({
  title,
  render: (list: HTMLElement) => {
    list.innerHTML = "";
    if (initialContent !== undefined) {
      const el = document.createElement("div");
      el.className = "slide-item";
      el.textContent = initialContent;
      list.appendChild(el);
    }
  },
});

// 断言 DOM 结构存在
const expectStructure = (root: HTMLElement) => {
  expect(root.className).toContain("menu-wrapper");
  expect(root.className).toContain("slide-menu");
  const viewport = root.querySelector(".slide-viewport");
  const header = root.querySelector(".slide-header");
  const backBtn = root.querySelector(".slide-back");
  const title = root.querySelector(".slide-title");
  const panel = root.querySelector(".slide-panel");
  const list = root.querySelector(".slide-list");

  expect(viewport).not.toBeNull();
  expect(header).not.toBeNull();
  expect(backBtn).not.toBeNull();
  expect(title).not.toBeNull();
  expect(panel).not.toBeNull();
  expect(list).not.toBeNull();
  expect(list!.className).toContain("render-card");
  // 结构层次
  expect(viewport!.contains(header!)).toBe(true);
  expect(viewport!.contains(panel!)).toBe(true);
  expect(panel!.contains(list!)).toBe(true);
  expect(header!.contains(backBtn!)).toBe(true);
  expect(header!.contains(title!)).toBe(true);
};

describe("createSlideMenu", () => {
  // =========================================================================
  // 1. 基本渲染：DOM 结构
  // =========================================================================

  it("返回的 handle.root 具备 menu-wrapper + slide-menu 类名", () => {
    const h = createSlideMenu();
    expect(h.root).not.toBeNull();
    expect(h.root.className).toContain("menu-wrapper");
    expect(h.root.className).toContain("slide-menu");
  });

  it("渲染出完整 DOM 树：viewport → header / panel → list", () => {
    const h = createSlideMenu();
    expectStructure(h.root);
  });

  it("list 直接挂载在 panel 下，且含 slide-list + render-card 类名", () => {
    const h = createSlideMenu();
    const list = h.root.querySelector(".slide-list")!;
    expect(list.parentElement).toBe(h.root.querySelector(".slide-panel")!);
    expect(list.className).toBe("slide-list render-card");
  });

  it("header 内 back 按钮 + title 顺序排列", () => {
    const h = createSlideMenu();
    const header = h.root.querySelector(".slide-header")!;
    const children = Array.from(header.children);
    expect(children[0].className).toBe("slide-back");
    expect(children[1].className).toBe("slide-title");
  });

  it("根元素设置 tabIndex=-1（不可通过 Tab 聚焦整个菜单卡片）", () => {
    const h = createSlideMenu();
    expect(h.root.tabIndex).toBe(-1);
  });

  it("back 按钮具备 role=button 和 tabIndex=0（键盘可操作）", () => {
    const h = createSlideMenu();
    const backBtn = h.root.querySelector(".slide-back")!;
    expect(backBtn.getAttribute("role")).toBe("button");
    expect((backBtn as HTMLElement).tabIndex).toBe(0);
  });

  it("默认 back 按钮 glyph 为 ✕，title 属性为『关闭』", () => {
    const h = createSlideMenu();
    const backBtn = h.root.querySelector(".slide-back")!;
    expect(backBtn.textContent).toBe("✕");
    expect((backBtn as HTMLElement).title).toBe("关闭");
  });

  it("opts.closeIcon 覆盖默认关闭 glyph", () => {
    const h = createSlideMenu({ closeIcon: "✗" });
    const backBtn = h.root.querySelector(".slide-back")!;
    expect(backBtn.textContent).toBe("✗");
  });

  it("opts.title 写入 slide-title 文本", () => {
    const h = createSlideMenu({ title: "模型信息" });
    const title = h.root.querySelector(".slide-title")!;
    expect(title.textContent).toBe("模型信息");
  });

  it("list 引用暴露到 handle.list，供 legacy 直接操作", () => {
    const h = createSlideMenu();
    expect(h.list).toBe(h.root.querySelector(".slide-list"));
  });

  // =========================================================================
  // 2. 导航：home / navigate / back
  // =========================================================================

  it("home(view) 将视图设为根并渲染", () => {
    const h = createSlideMenu();
    const v = makeView("主菜单", "row-1");
    h.home(v);
    const title = h.root.querySelector(".slide-title")!;
    expect(title.textContent).toBe("主菜单");
    expect(h.list.textContent).toBe("row-1");
  });

  it("navigate(view) 下钻，标题更新，back glyph 变为 ←", () => {
    const h = createSlideMenu();
    h.home(makeView("主菜单"));
    h.navigate(makeView("子菜单", "sub-row"));
    const title = h.root.querySelector(".slide-title")!;
    const backBtn = h.root.querySelector(".slide-back")!;
    expect(title.textContent).toBe("子菜单");
    expect(h.list.textContent).toBe("sub-row");
    expect(backBtn.textContent).toBe("←");
    expect((backBtn as HTMLElement).title).toBe("返回");
  });

  it("back() 从子集返回根，恢复关闭 glyph ✕", () => {
    const h = createSlideMenu();
    h.home(makeView("主菜单", "root-row"));
    h.navigate(makeView("子菜单", "sub-row"));
    h.back();
    const title = h.root.querySelector(".slide-title")!;
    const backBtn = h.root.querySelector(".slide-back")!;
    expect(title.textContent).toBe("主菜单");
    expect(h.list.textContent).toBe("root-row");
    expect(backBtn.textContent).toBe("✕");
    expect((backBtn as HTMLElement).title).toBe("关闭");
  });

  it("根级 back() 触发关闭回调（而非返回）", () => {
    const h = createSlideMenu();
    h.home(makeView("主菜单"));
    const onClose = vi.fn();
    h.setOnClose(onClose);
    h.back();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("点击 back 按钮等效 handle.back()", () => {
    const h = createSlideMenu();
    h.home(makeView("主菜单", "root-row"));
    h.navigate(makeView("子菜单", "sub-row"));
    const backBtn = h.root.querySelector(".slide-back")!;
    (backBtn as HTMLElement).click();
    expect(h.root.querySelector(".slide-title")!.textContent).toBe("主菜单");
    expect(h.list.textContent).toBe("root-row");
  });

  it("Enter 键触发 back", () => {
    const h = createSlideMenu();
    h.home(makeView("主菜单", "root-row"));
    h.navigate(makeView("子菜单"));
    const backBtn = h.root.querySelector(".slide-back")!;
    backBtn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(h.root.querySelector(".slide-title")!.textContent).toBe("主菜单");
  });

  it("Space 键触发 back 并 preventDefault", () => {
    const h = createSlideMenu();
    h.home(makeView("主菜单"));
    h.navigate(makeView("子菜单"));
    const backBtn = h.root.querySelector(".slide-back")!;
    const ev = new KeyboardEvent("keydown", { key: " ", cancelable: true });
    backBtn.dispatchEvent(ev);
    expect(h.root.querySelector(".slide-title")!.textContent).toBe("主菜单");
    expect(ev.defaultPrevented).toBe(true);
  });

  it("其它键不触发 back", () => {
    const h = createSlideMenu();
    h.home(makeView("主菜单"));
    h.navigate(makeView("子菜单"));
    const backBtn = h.root.querySelector(".slide-back")!;
    backBtn.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(h.root.querySelector(".slide-title")!.textContent).toBe("子菜单");
  });

  // =========================================================================
  // 3. onClose 回调
  // =========================================================================

  it("setOnClose 注册回调，根级点击 ✕ 触发", () => {
    const h = createSlideMenu();
    h.home(makeView("主菜单"));
    const onClose = vi.fn();
    h.setOnClose(onClose);
    const backBtn = h.root.querySelector(".slide-back")!;
    (backBtn as HTMLElement).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("setOnClose 覆盖旧回调", () => {
    const h = createSlideMenu();
    h.home(makeView("主菜单"));
    const a = vi.fn();
    const b = vi.fn();
    h.setOnClose(a);
    h.setOnClose(b);
    h.back();
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("未注册 onClose 时根级 back 不报错", () => {
    const h = createSlideMenu();
    h.home(makeView("主菜单"));
    expect(() => h.back()).not.toThrow();
  });

  // =========================================================================
  // 4. reset：清空导航栈
  // =========================================================================

  it("reset() 清空栈，list 不再重新渲染（保留现有内容）", () => {
    const h = createSlideMenu();
    h.home(makeView("主菜单", "row-1"));
    h.navigate(makeView("子菜单", "row-2"));
    expect(h.root.querySelector(".slide-title")!.textContent).toBe("子菜单");
    h.reset();
    // reset 不重渲染，title/list 保留原值
    expect(h.root.querySelector(".slide-title")!.textContent).toBe("子菜单");
    expect(h.list.textContent).toBe("row-2");
  });

  it("reset() 后重新 home 正常工作", () => {
    const h = createSlideMenu();
    h.home(makeView("旧菜单"));
    h.reset();
    h.home(makeView("新菜单", "fresh"));
    expect(h.root.querySelector(".slide-title")!.textContent).toBe("新菜单");
    expect(h.list.textContent).toBe("fresh");
  });

  // =========================================================================
  // 5. dispose：清理 DOM
  // =========================================================================

  it("dispose() 后 root 从父容器移除", () => {
    const h = createSlideMenu();
    const parent = document.createElement("div");
    parent.appendChild(h.root);
    expect(parent.contains(h.root)).toBe(true);
    h.dispose();
    expect(parent.contains(h.root)).toBe(false);
  });

  it("dispose() 后 root 仍可引用但不属于任何父节点", () => {
    const h = createSlideMenu();
    h.home(makeView("测试"));
    h.dispose();
    expect(h.root.parentElement).toBeNull();
  });

  // =========================================================================
  // 6. refresh：重新渲染当前栈顶
  // =========================================================================

  it("refresh() 重新调用当前视图的 render，使内容更新", () => {
    const h = createSlideMenu();
    let counter = 0;
    const view: SlideMenuView = {
      title: "动态视图",
      render: (list: HTMLElement) => {
        list.innerHTML = "";
        const el = document.createElement("div");
        el.className = "slide-item";
        el.textContent = `count=${++counter}`;
        list.appendChild(el);
      },
    };
    h.home(view);
    expect(h.list.textContent).toBe("count=1");
    h.refresh();
    expect(h.list.textContent).toBe("count=2");
    h.refresh();
    expect(h.list.textContent).toBe("count=3");
  });

  it("refresh() 不改变标题（除非视图 title 变了）", () => {
    const h = createSlideMenu();
    const view: SlideMenuView = {
      title: "稳",
      render: (list) => {
        list.innerHTML = "<div>x</div>";
      },
    };
    h.home(view);
    h.refresh();
    expect(h.root.querySelector(".slide-title")!.textContent).toBe("稳");
  });

  it("空栈时 refresh() 不报错", () => {
    const h = createSlideMenu();
    expect(() => h.refresh()).not.toThrow();
  });

  // =========================================================================
  // 7. isShowing / isAtRoot 状态查询
  // =========================================================================

  it("isShowing 在栈顶匹配时返回 true", () => {
    const h = createSlideMenu();
    const v1 = makeView("A");
    const v2 = makeView("B");
    h.home(v1);
    expect(h.isShowing(v1)).toBe(true);
    expect(h.isShowing(v2)).toBe(false);
    h.navigate(v2);
    expect(h.isShowing(v1)).toBe(false);
    expect(h.isShowing(v2)).toBe(true);
  });

  it("isAtRoot 栈深 ≤ 1 时返回 true", () => {
    const h = createSlideMenu();
    expect(h.isAtRoot()).toBe(true); // 空栈
    h.home(makeView("A"));
    expect(h.isAtRoot()).toBe(true); // 根
    h.navigate(makeView("B"));
    expect(h.isAtRoot()).toBe(false);
  });

  // =========================================================================
  // 8. setTitle 直接操作
  // =========================================================================

  it("setTitle 覆盖当前标题栏文字", () => {
    const h = createSlideMenu();
    h.home(makeView("原菜单"));
    expect(h.root.querySelector(".slide-title")!.textContent).toBe("原菜单");
    h.setTitle("新菜单");
    expect(h.root.querySelector(".slide-title")!.textContent).toBe("新菜单");
  });

  // =========================================================================
  // 9. 多层导航：home → navigate → navigate → back → back → home
  // =========================================================================

  it("三层导航 + 返回栈：home→nav→nav→back→back→home 完整流程", () => {
    const h = createSlideMenu();
    const v1 = makeView("一级");
    const v2 = makeView("二级");
    const v3 = makeView("三级");
    const vNew = makeView("新根");

    h.home(v1);
    expect(h.root.querySelector(".slide-title")!.textContent).toBe("一级");
    expect(h.root.querySelector(".slide-back")!.textContent).toBe("✕");
    expect(h.isAtRoot()).toBe(true);

    h.navigate(v2);
    expect(h.root.querySelector(".slide-title")!.textContent).toBe("二级");
    expect(h.root.querySelector(".slide-back")!.textContent).toBe("←");
    expect(h.isAtRoot()).toBe(false);

    h.navigate(v3);
    expect(h.root.querySelector(".slide-title")!.textContent).toBe("三级");
    expect(h.root.querySelector(".slide-back")!.textContent).toBe("←");

    h.back();
    expect(h.root.querySelector(".slide-title")!.textContent).toBe("二级");
    expect(h.isAtRoot()).toBe(false);

    h.back();
    expect(h.root.querySelector(".slide-title")!.textContent).toBe("一级");
    expect(h.root.querySelector(".slide-back")!.textContent).toBe("✕");
    expect(h.isAtRoot()).toBe(true);

    // 再次进入新根（替换原栈）
    h.home(vNew);
    expect(h.root.querySelector(".slide-title")!.textContent).toBe("新根");
    expect(h.root.querySelector(".slide-back")!.textContent).toBe("✕");
    expect(h.isShowing(vNew)).toBe(true);
    expect(h.isShowing(v1)).toBe(false);
  });

  // =========================================================================
  // 10. 向后兼容：不调用 home/navigate 直接操作 list
  // =========================================================================

  it("legacy 直接操作 handle.list 行为不变", () => {
    const h = createSlideMenu();
    // 不调用 home/navigate，直接往 list 里 append
    const row = document.createElement("div");
    row.className = "slide-item";
    row.textContent = "legacy-row";
    h.list.appendChild(row);
    expect(h.list.textContent).toBe("legacy-row");
    // 导航栈为空时 isAtRoot 为 true，back 触发关闭
    const onClose = vi.fn();
    h.setOnClose(onClose);
    h.back();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("不调用 home/navigate 时，title 保持 opts.title 初始值", () => {
    const h = createSlideMenu({ title: "默认标题" });
    expect(h.root.querySelector(".slide-title")!.textContent).toBe("默认标题");
  });
});

// ===================================================================
// 11. 键盘导航（80da4ce0 a11y：↑↓/Home/End/Enter/Space/Escape + roving tabindex）
// ===================================================================
describe("createSlideMenu 键盘导航", () => {
  // 构造带菜单项行的视图：每行一个 .slide-item button 直接子节点
  // （真实 3D 菜单行本身可聚焦；button 保证 happy-dom 下 focus 生效）
  const makeNavView = (titles: string[], title = "nav"): SlideMenuView => ({
    title,
    render: (list: HTMLElement) => {
      list.innerHTML = "";
      titles.forEach((txt) => {
        const row = document.createElement("button");
        row.className = "slide-item";
        row.textContent = txt;
        list.appendChild(row);
      });
    },
  });

  const keyEvent = (key: string, shiftKey = false): KeyboardEvent =>
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, shiftKey });

  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("home 后：roving tabindex 生效（首项 0，其余 -1）", () => {
    const h = mountMenu();
    h.home(makeNavView(["A", "B", "C"]));
    const items = Array.from(h.list.children) as HTMLElement[];
    expect(items.map((el) => el.tabIndex)).toEqual([0, -1, -1]);
  });

  it("ArrowDown：从首项走到次项，tabindex 跟随（roving）", () => {
    const h = mountMenu();
    h.home(makeNavView(["A", "B", "C"]));
    const items = Array.from(h.list.children) as HTMLElement[];
    items[0]!.focus();
    h.list.dispatchEvent(keyEvent("ArrowDown"));
    const after = Array.from(h.list.children) as HTMLElement[];
    expect(after.map((el) => el.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("ArrowDown 在末项 → 循环回首项", () => {
    const h = mountMenu();
    h.home(makeNavView(["A", "B"]));
    const items = Array.from(h.list.children) as HTMLElement[];
    items[1]!.focus();
    h.list.dispatchEvent(keyEvent("ArrowDown"));
    const after = Array.from(h.list.children) as HTMLElement[];
    expect(after.map((el) => el.tabIndex)).toEqual([0, -1]);
  });

  it("ArrowUp 在首项 → 循环到末项", () => {
    const h = mountMenu();
    h.home(makeNavView(["A", "B"]));
    const items = Array.from(h.list.children) as HTMLElement[];
    items[0]!.focus();
    h.list.dispatchEvent(keyEvent("ArrowUp"));
    const after = Array.from(h.list.children) as HTMLElement[];
    expect(after.map((el) => el.tabIndex)).toEqual([-1, 0]);
  });

  it("Home → 首项获得 tabindex 0", () => {
    const h = mountMenu();
    h.home(makeNavView(["A", "B", "C"]));
    const items = Array.from(h.list.children) as HTMLElement[];
    items[2]!.focus();
    h.list.dispatchEvent(keyEvent("Home"));
    expect(items[0]!.tabIndex).toBe(0);
    expect(items[1]!.tabIndex).toBe(-1);
    expect(items[2]!.tabIndex).toBe(-1);
  });

  it("End → 末项获得 tabindex 0", () => {
    const h = mountMenu();
    h.home(makeNavView(["A", "B", "C"]));
    const items = Array.from(h.list.children) as HTMLElement[];
    items[0]!.focus();
    h.list.dispatchEvent(keyEvent("End"));
    expect(items[2]!.tabIndex).toBe(0);
    expect(items[0]!.tabIndex).toBe(-1);
  });

  it("Enter 在聚焦项上 → 触发该项 click", () => {
    const h = mountMenu();
    h.home(makeNavView(["A", "B"]));
    const items = Array.from(h.list.children) as HTMLElement[];
    const clickSpy = vi.fn();
    items[1]!.addEventListener("click", clickSpy);
    items[1]!.focus();
    h.list.dispatchEvent(keyEvent("Enter"));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("Space 在聚焦项上 → 触发该项 click", () => {
    const h = mountMenu();
    h.home(makeNavView(["A", "B"]));
    const items = Array.from(h.list.children) as HTMLElement[];
    const clickSpy = vi.fn();
    items[0]!.addEventListener("click", clickSpy);
    items[0]!.focus();
    h.list.dispatchEvent(keyEvent(" "));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("Escape → 触发 handleBack（根级 = onClose）", () => {
    const h = mountMenu();
    h.home(makeNavView(["A"]));
    const onClose = vi.fn();
    h.setOnClose(onClose);
    h.list.dispatchEvent(keyEvent("Escape"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape 在子级 → 返回上一级（不触发 onClose）", () => {
    const h = mountMenu();
    h.home(makeNavView(["A"], "一级"));
    h.navigate(makeNavView(["B"], "二级"));
    const onClose = vi.fn();
    h.setOnClose(onClose);
    h.list.dispatchEvent(keyEvent("Escape"));
    expect(onClose).not.toHaveBeenCalled();
    expect(h.root.querySelector(".slide-title")!.textContent).toBe("一级");
  });

  it("箭头键 preventDefault（阻止滚动）", () => {
    const h = mountMenu();
    h.home(makeNavView(["A", "B"]));
    const ev = keyEvent("ArrowDown");
    h.list.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});

// ===================================================================
// 12. onShow / onHide：焦点记忆 + 输入阻断栈（80da4ce0 a11y）
// ===================================================================
describe("createSlideMenu onShow/onHide", () => {
  const makeView = (title: string): SlideMenuView => ({
    title,
    render: (list: HTMLElement) => {
      list.innerHTML = "";
      const row = document.createElement("button");
      row.className = "slide-item";
      row.textContent = "row";
      list.appendChild(row);
    },
  });

  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.restoreAllMocks();
    // 清空模块级输入阻断栈残留（上一个测试 push 未 pop 会污染本测试）
    while (focusRestore.isInputBlocked()) focusRestore.popInputBlock("slide-menu");
  });

  it("onShow：push 输入阻断栈（isInputBlocked → true）", () => {
    const pushSpy = vi.spyOn(focusRestore, "pushInputBlock");
    const h = mountMenu();
    h.home(makeView("t"));
    expect(focusRestore.isInputBlocked()).toBe(false);
    h.onShow();
    expect(pushSpy).toHaveBeenCalledWith("slide-menu");
    expect(focusRestore.isInputBlocked()).toBe(true);
  });

  it("onHide：pop 输入阻断栈（isInputBlocked → false）", () => {
    const popSpy = vi.spyOn(focusRestore, "popInputBlock");
    const h = mountMenu();
    h.home(makeView("t"));
    h.onShow();
    expect(focusRestore.isInputBlocked()).toBe(true);
    h.onHide();
    expect(popSpy).toHaveBeenCalledWith("slide-menu");
    expect(focusRestore.isInputBlocked()).toBe(false);
  });

  it("onShow 记住触发元素 → onHide 把焦点还给触发元素", () => {
    const trigger = document.createElement("button");
    trigger.id = "trigger";
    document.body.appendChild(trigger);
    trigger.focus();

    const h = mountMenu();
    h.home(makeView("t"));
    h.onShow();
    // onShow 的 rAF 里把焦点给首项；onHide 应归还
    const el = h.list.querySelector<HTMLElement>(".slide-item")!;
    el.focus();
    h.onHide();
    expect(document.activeElement).toBe(trigger);
  });

  it("onHide({ restoreFocus: false })：归还焦点被跳过", () => {
    const trigger = document.createElement("button");
    trigger.id = "trigger";
    document.body.appendChild(trigger);
    trigger.focus();

    const h = mountMenu();
    h.home(makeView("t"));
    h.onShow();
    const el = h.list.querySelector<HTMLElement>(".slide-item")!;
    el.focus();
    h.onHide({ restoreFocus: false });
    expect(document.activeElement).not.toBe(trigger);
  });

  it("触发元素已离文档 → onHide 静默跳过归还（不抛错）", () => {
    const trigger = document.createElement("button");
    trigger.id = "trigger";
    document.body.appendChild(trigger);
    trigger.focus();

    const h = mountMenu();
    h.home(makeView("t"));
    h.onShow();
    trigger.remove();
    expect(() => h.onHide()).not.toThrow();
  });
});
