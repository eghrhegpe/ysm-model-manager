// ===== app-sync-manager 事件委托层直测（bindDelegatedEvents）=====
// 认知复杂度战役第 4b 批的特征测试前置：此前本函数只被组件级测试间接覆盖
// （.sm-dir 行点击 / sm-push 按钮），分支级空白为——
//   · 命中优先级（按钮 > 状态标签 > dir 行）与「按钮命中即消费」的 stopPropagation 对等性；
//   · 未知 data-action / 按钮无 [data-path] 祖先的静默分支；
//   · 一次性绑定契约：二次 bind 不重绑、unsub 解绑并清 _cbRef（重连可重挂）。
// 直接以事件委托层为被测单元，避免组件级测试把这三条埋在 async 渲染之后。
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

const mocks = vi.hoisted(() => {
  const dispose = vi.fn();
  return {
    dispose,
    bindRoving: vi.fn((_spec: Record<string, unknown>) => ({ dispose })),
  };
});

vi.mock("@/utils/dom/bind-roving.ts", () => ({ bindRoving: mocks.bindRoving }));

import { bindDelegatedEvents, type EventSelf } from "./events.ts";

interface Cb {
  doRender: Mock<() => void>;
  doPerformOp: Mock<(op: "push" | "pull", path: string) => Promise<void>>;
}

function makeCb(): Cb {
  return {
    doRender: vi.fn(),
    doPerformOp: vi.fn(async () => {}),
  };
}

/** 建一个「伪组件根」：真实 DOM 元素 + 事件层需要的少量字段 */
function makeSelf(html = ""): { self: EventSelf; host: HTMLElement } {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  const self = host as unknown as EventSelf;
  self._cbRef = undefined;
  self._clickHandler = null;
  self._keyHandler = null;
  self._keyRoving = null;
  self._dirOpen = {};
  self._statusFilter = "all";
  return { self, host };
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.replaceChildren();
});

describe("bindDelegatedEvents — 一次性绑定与解绑成对", () => {
  it("首次绑定：click/keydown 各挂一次 + bindRoving spec 关键位断言", () => {
    const { self } = makeSelf();
    const addSpy = vi.spyOn(self, "addEventListener");
    const cb = makeCb();
    const unsub = bindDelegatedEvents(self, cb);

    expect(addSpy.mock.calls.filter((c) => c[0] === "click")).toHaveLength(1);
    expect(addSpy.mock.calls.filter((c) => c[0] === "keydown")).toHaveLength(1);
    expect(mocks.bindRoving).toHaveBeenCalledTimes(1);
    const spec = mocks.bindRoving.mock.calls[0][0];
    expect(spec.container).toBe(self);
    expect(spec.itemSelector).toBe(".sm-status-tab");
    expect(spec.preset).toBe("radio");
    expect(spec.cyclic).toBe(true);
    expect(spec.homeEnd).toBe(false); // Home/End 走独立小监听（radiogroup 规范：只移焦点不激活）
    expect(spec.stateAttr).toBeNull(); // 不写 ARIA 位（模板随重渲染迁移）
    unsub();
  });

  it("二次 bind（_init 重入）不重绑监听，但换成新回调", () => {
    const { self, host } = makeSelf(
      '<div class="sm-item sm-dir" data-path="/repo/v"><button class="sm-item-btn" data-action="push">P</button></div>',
    );
    const addSpy = vi.spyOn(self, "addEventListener");
    const cb1 = makeCb();
    bindDelegatedEvents(self, cb1);
    const cb2 = makeCb();
    bindDelegatedEvents(self, cb2);

    expect(addSpy.mock.calls.filter((c) => c[0] === "click")).toHaveLength(1);
    expect(mocks.bindRoving).toHaveBeenCalledTimes(1);
    (host.querySelector(".sm-item-btn") as HTMLElement).click();
    expect(cb2.doPerformOp).toHaveBeenCalledWith("push", "/repo/v");
    expect(cb1.doPerformOp).not.toHaveBeenCalled();
  });

  it("unsub → 解绑 click/keydown + dispose roving + 清 _cbRef（重连可重挂）", () => {
    const { self } = makeSelf();
    const removeSpy = vi.spyOn(self, "removeEventListener");
    const cb = makeCb();
    const unsub = bindDelegatedEvents(self, cb);
    unsub();

    expect(removeSpy.mock.calls.map((c) => c[0]).sort()).toEqual(["click", "keydown"]);
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
    expect(self._cbRef).toBeUndefined();
    expect(self._clickHandler).toBeNull();
    expect(self._keyHandler).toBeNull();
    expect(self._keyRoving).toBeNull();

    // 重连：unsub 后 _cbRef 为空 → 再次 bind 重新挂监听（否则点击全死）
    const cb2 = makeCb();
    bindDelegatedEvents(self, cb2);
    expect(self._clickHandler).not.toBeNull();
    expect(mocks.bindRoving).toHaveBeenCalledTimes(2);
  });
});

describe("bindDelegatedEvents — 命中优先级与消费语义", () => {
  const BTN_HTML =
    '<div class="sm-item sm-dir" data-path="/repo/v">' +
    '<button class="sm-item-btn" data-action="push">P</button>' +
    '<button class="sm-item-btn" data-action="pull">L</button>' +
    '<button class="sm-item-btn" data-action="unknown-op">?</button>' +
    "</div>";

  it("push 按钮 → doPerformOp(push, path) 且 stopPropagation（不冒泡到 document 级监听）", () => {
    const { self, host } = makeSelf(BTN_HTML);
    const cb = makeCb();
    bindDelegatedEvents(self, cb);
    const docSpy = vi.fn();
    document.addEventListener("click", docSpy);
    (host.querySelector('[data-action="push"]') as HTMLElement).click();
    document.removeEventListener("click", docSpy);

    expect(cb.doPerformOp).toHaveBeenCalledWith("push", "/repo/v");
    expect(docSpy).not.toHaveBeenCalled(); // stopPropagation 对等旧 per-button handler
    expect(cb.doRender).not.toHaveBeenCalled();
    expect(self._dirOpen).toEqual({}); // 按钮命中即消费，dir 行不翻转
  });

  it("pull 按钮 → doPerformOp(pull, path)", () => {
    const { self, host } = makeSelf(BTN_HTML);
    const cb = makeCb();
    bindDelegatedEvents(self, cb);
    (host.querySelector('[data-action="pull"]') as HTMLElement).click();
    expect(cb.doPerformOp).toHaveBeenCalledWith("pull", "/repo/v");
  });

  it("未知 data-action → 不派发任何操作，但仍消费事件（不落到 dir 行翻转）", () => {
    const { self, host } = makeSelf(BTN_HTML);
    const cb = makeCb();
    bindDelegatedEvents(self, cb);
    const docSpy = vi.fn();
    document.addEventListener("click", docSpy);
    (host.querySelector('[data-action="unknown-op"]') as HTMLElement).click();
    document.removeEventListener("click", docSpy);

    expect(cb.doPerformOp).not.toHaveBeenCalled();
    expect(cb.doRender).not.toHaveBeenCalled();
    expect(self._dirOpen).toEqual({});
    expect(docSpy).not.toHaveBeenCalled();
  });

  it("按钮无 [data-path] 祖先 → 静默不派发（且不落到 dir 行）", () => {
    const { self, host } = makeSelf(
      '<div class="sm-dir"><button class="sm-item-btn" data-action="push">P</button></div>',
    );
    const cb = makeCb();
    bindDelegatedEvents(self, cb);
    (host.querySelector(".sm-item-btn") as HTMLElement).click();
    expect(cb.doPerformOp).not.toHaveBeenCalled();
    expect(cb.doRender).not.toHaveBeenCalled();
  });

  it("状态标签 → _statusFilter 迁移 + doRender（不 stopPropagation）", () => {
    const { self, host } = makeSelf(
      '<button class="sm-status-tab" data-status="missing">M</button>' +
        '<button class="sm-status-tab">无status</button>',
    );
    const cb = makeCb();
    bindDelegatedEvents(self, cb);
    const docSpy = vi.fn();
    document.addEventListener("click", docSpy);

    (host.querySelector('[data-status="missing"]') as HTMLElement).click();
    expect(self._statusFilter).toBe("missing");
    expect(cb.doRender).toHaveBeenCalledTimes(1);

    // 缺 data-status → 回退 "all"（与模板默认同口径）
    (host.querySelectorAll(".sm-status-tab")[1] as HTMLElement).click();
    expect(self._statusFilter).toBe("all");
    expect(cb.doRender).toHaveBeenCalledTimes(2);

    document.removeEventListener("click", docSpy);
    expect(docSpy).toHaveBeenCalledTimes(2); // 标签分支不截断冒泡
  });

  it("dir 行 → 点击整行翻转展开态 + doRender（含缺 data-path 的空键）", () => {
    const { self, host } = makeSelf(
      '<div class="sm-item sm-dir" data-path="/repo/v">V</div><div class="sm-dir">无名</div>',
    );
    const cb = makeCb();
    bindDelegatedEvents(self, cb);
    (host.querySelector('[data-path="/repo/v"]') as HTMLElement).click();
    expect(self._dirOpen["/repo/v"]).toBe(true);
    expect(cb.doRender).toHaveBeenCalledTimes(1);

    (host.querySelector('[data-path="/repo/v"]') as HTMLElement).click();
    expect(self._dirOpen["/repo/v"]).toBe(false); // 再点折叠（点一次翻转一次，不双翻）

    (host.querySelectorAll(".sm-dir")[1] as HTMLElement).click();
    expect(self._dirOpen[""]).toBe(true); // 缺 data-path → 空串键（原口径）
  });

  it("未命中任何选择器 → 无副作用", () => {
    const { self, host } = makeSelf('<div class="other">x</div>');
    const cb = makeCb();
    bindDelegatedEvents(self, cb);
    (host.querySelector(".other") as HTMLElement).click();
    expect(cb.doPerformOp).not.toHaveBeenCalled();
    expect(cb.doRender).not.toHaveBeenCalled();
  });

  it("事件目标非 Element（合成事件）→ 静默早退不抛", () => {
    const { self } = makeSelf();
    const cb = makeCb();
    const unsub = bindDelegatedEvents(self, cb);
    const ev = new Event("click");
    Object.defineProperty(ev, "target", { value: null });
    expect(() => self.dispatchEvent(ev)).not.toThrow();
    expect(cb.doRender).not.toHaveBeenCalled();
    unsub();
  });
});

describe("bindDelegatedEvents — Home/End 独立小监听（radiogroup 只移焦点不激活）", () => {
  const RADIOS =
    '<div class="sm-status-radios">' +
    '<button class="sm-status-tab" data-status="all">A</button>' +
    '<button class="sm-status-tab" data-status="synced">S</button>' +
    '<button class="sm-status-tab" data-status="missing">M</button>' +
    "</div>";

  it("Home → 焦点落首项；End → 末项；均不激活（doRender 不触发）", () => {
    const { self, host } = makeSelf(RADIOS);
    const cb = makeCb();
    bindDelegatedEvents(self, cb);
    const tabs = [...host.querySelectorAll<HTMLElement>(".sm-status-tab")];

    tabs[1]!.focus();
    const home = new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true });
    tabs[1]!.dispatchEvent(home);
    expect(host.ownerDocument.activeElement).toBe(tabs[0]);
    expect(home.defaultPrevented).toBe(true);

    const end = new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true });
    tabs[0]!.dispatchEvent(end);
    expect(host.ownerDocument.activeElement).toBe(tabs[2]);
    expect(cb.doRender).not.toHaveBeenCalled();
  });

  it("非 Home/End 键 → 不 preventDefault、不动焦点", () => {
    const { self, host } = makeSelf(RADIOS);
    const cb = makeCb();
    bindDelegatedEvents(self, cb);
    const tabs = [...host.querySelectorAll<HTMLElement>(".sm-status-tab")];
    tabs[0]!.focus();
    const ev = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
    tabs[0]!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(host.ownerDocument.activeElement).toBe(tabs[0]);
  });

  it("目标不在 .sm-status-radios 内 → 不接管（不 preventDefault）", () => {
    const { self, host } = makeSelf(`${RADIOS}<button class="sm-status-tab outside" data-status="x">X</button>`);
    const cb = makeCb();
    bindDelegatedEvents(self, cb);
    const outside = host.querySelector(".outside") as HTMLElement;
    outside.focus();
    const ev = new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true });
    outside.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("radio 集合为空 → 静默早退（不抛）", () => {
    const { self, host } = makeSelf('<div class="sm-status-radios"></div>');
    const cb = makeCb();
    bindDelegatedEvents(self, cb);
    const radios = host.querySelector(".sm-status-radios") as HTMLElement;
    const ev = new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true });
    expect(() => radios.dispatchEvent(ev)).not.toThrow();
    expect(ev.defaultPrevented).toBe(true); // preventDefault 在早退之前（原顺序）
  });
});

describe("bindDelegatedEvents — bindRoving spec 的 when/onActivate", () => {
  /** 取最近一次 bindRoving 的 spec */
  function lastSpec(): Record<string, unknown> {
    return mocks.bindRoving.mock.calls.at(-1)![0];
  }

  it("when 门控：radios 内 + 有 _cbRef 才放行；域外/空目标/无回调均让路", () => {
    const { self, host } = makeSelf(
      '<div class="sm-status-radios"><button class="sm-status-tab" data-status="all">A</button></div><div class="out">o</div>',
    );
    const cb = makeCb();
    const unsub = bindDelegatedEvents(self, cb);
    const when = lastSpec().when as (e: KeyboardEvent) => boolean;
    const inside = host.querySelector(".sm-status-tab") as HTMLElement;
    const outside = host.querySelector(".out") as HTMLElement;
    /** when 只读 e.target —— 用最小合成壳直测谓词（真实派发无法回带 target） */
    const evWith = (t: unknown): KeyboardEvent => ({ target: t }) as unknown as KeyboardEvent;

    expect(when(evWith(inside))).toBe(true);
    expect(when(evWith(outside))).toBe(false); // closest 域外
    expect(when(evWith(null))).toBe(false); // 非 Element
    unsub(); // 清 _cbRef → 重连前的空窗期不放行
    expect(when(evWith(inside))).toBe(false);
  });

  it("onActivate：按 data-status 重查新节点 → click（点击委托）+ focus", () => {
    const { self, host } = makeSelf(
      '<div class="sm-status-radios"><button class="sm-status-tab" data-status="all">A</button>' +
        '<button class="sm-status-tab" data-status="missing">M</button></div>',
    );
    const cb = makeCb();
    bindDelegatedEvents(self, cb);
    const onActivate = lastSpec().onActivate as (item: HTMLElement) => void;
    const item = host.querySelector('[data-status="missing"]') as HTMLElement;
    onActivate(item);

    // 激活 = 点目标 → 既有②点击委托（_statusFilter 迁移 + doRender）
    expect(self._statusFilter).toBe("missing");
    expect(cb.doRender).toHaveBeenCalledTimes(1);
    expect(host.ownerDocument.activeElement).toBe(
      host.querySelector('[data-status="missing"]'),
    );
  });
});
