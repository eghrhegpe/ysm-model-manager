// ===== sidebar 渲染层测试 =====
// 覆盖：renderVersionCards 空/非空、instanceCardHeaderHTML 各 chips 分支（真实实现——
// mock 用 spy 包装真实 instanceCardHeaderHTML，既记录调用又产出真实 HTML，修复此前
// 「注释声称覆盖 chips 分支、实际整模块被替换」的假覆盖）
import { describe, it, expect, vi, beforeEach } from "vitest";

const { instanceCardHeaderHTMLMock } = vi.hoisted(() => ({ instanceCardHeaderHTMLMock: vi.fn() }));

vi.mock("./tpl.ts", async () => {
  const actual = await vi.importActual<typeof import("./tpl.ts")>("./tpl.ts");
  instanceCardHeaderHTMLMock.mockImplementation(actual.instanceCardHeaderHTML);
  return { ...actual, instanceCardHeaderHTML: instanceCardHeaderHTMLMock };
});

// isolate:false 共享 mock 引用 + shuffle 打乱用例顺序：mock 调用记录跨用例累积
// （「空实例」排到「非空实例」后 → not.toHaveBeenCalled 失真），每用例清一次
beforeEach(() => {
  instanceCardHeaderHTMLMock.mockClear();
});

import { renderVersionCards, renderLoadError } from "./render.ts";
import { instanceCardHeaderHTML } from "./tpl.ts";
import type { SidebarInstance } from "./data.ts";

function instance(over: Partial<SidebarInstance>): SidebarInstance {
  return {
    name: "整合包",
    dir: "/mc/instances/x",
    exists: true,
    hasMod: true,
    status: "complete",
    synced: 2,
    missing: 1,
    extra: 0,
    disabled: 0,
    rtype: "ysm",
    ...over,
  };
}

describe("renderVersionCards", () => {
  it("空实例 → 显示未找到提示，不调用 instanceCardHeaderHTML", () => {
    const container = document.createElement("div");
    renderVersionCards(container, []);
    expect(container.innerHTML).toContain("未找到匹配的整合包");
    expect(instanceCardHeaderHTML).not.toHaveBeenCalled();
  });

  it("非空实例 → 生成 instance-card 卡片，传递全部字段与 idx", () => {
    const container = document.createElement("div");
    renderVersionCards(container, [
      instance({ name: "P1", synced: 3, missing: 2, extra: 1, disabled: 2, status: "missing", hasMod: false, rtype: "pack" }),
      instance({ name: "P2" }),
    ]);

    const cards = Array.from(container.querySelectorAll<HTMLElement>(".instance-card"));
    expect(cards).toHaveLength(2);
    expect(cards[0].dataset.idx).toBe("0");
    expect(cards[1].dataset.idx).toBe("1");
    // P1 修复：卡片同时以 data-name 携带实例名——拖拽 drop 等跨渲染消费者按名称
    // 解析目标（数组下标在 sidebar 重载/实例增删后会静默指向错误的包）
    expect(cards[0].dataset.name).toBe("P1");
    expect(cards[1].dataset.name).toBe("P2");
    expect(cards[0].style.animationDelay).toBe("0ms");
    expect(cards[1].style.animationDelay).toBe("40ms");
    // 对象入参断言（2026-10-14 签名收编）：比原位置断言更抗参数顺序变动——
    // 位置断言在加/删字段时会「静默错位」，对象断言直接按名核对。
    expect(instanceCardHeaderHTML).toHaveBeenNthCalledWith(1, {
      name: "P1",
      synced: 3,
      missing: 2,
      extra: 1,
      disabled: 2,
      idx: 0,
      hasMod: false,
      rtype: "pack",
    });
    expect(instanceCardHeaderHTML).toHaveBeenNthCalledWith(2, {
      name: "P2",
      synced: 2,
      missing: 1,
      extra: 0,
      disabled: 0,
      idx: 1,
      hasMod: true,
      rtype: "ysm",
    });
  });

  // 2026-10 修复的回归锁（「卡卡」直因）：入场延迟原为 idx*40ms **无封顶**，而
  // .instance-card 的 animation 用 `both` 填充 → 延迟期间卡片停在 from 态（透明/位移），
  // 50 个包 = 第 50 张等 2 秒才出现；且每次 stats:refresh 都整列表重建 → 反复「下半屏空着」。
  // 现走共享原语 stagger()（与站点卡片同口径，300ms 封顶）。
  it("入场延迟带封顶（stagger）：尾部卡片不再等 N*40ms 才可见", () => {
    const container = document.createElement("div");
    const many = Array.from({ length: 30 }, (_, i) => instance({ name: `P${i}` }));
    renderVersionCards(container, many);
    const cards = Array.from(container.querySelectorAll<HTMLElement>(".instance-card"));
    expect(cards).toHaveLength(30);
    // 头部仍保持阶梯节奏（不破坏「瀑布流」观感）
    expect(cards[1].style.animationDelay).toBe("40ms");
    expect(cards[2].style.animationDelay).toBe("80ms");
    // 尾部必须封顶：旧实现这里是 1160ms（29*40），下半屏要等一秒多才可见
    expect(parseInt(cards[29].style.animationDelay, 10)).toBeLessThanOrEqual(320);
    // 封顶值单调不减（视觉顺序稳定）
    const delays = cards.map((c) => parseInt(c.style.animationDelay, 10));
    for (let i = 1; i < delays.length; i++) expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]);
  });

  // 注：批量插入（DocumentFragment 一次落位）**不设机制断言**——实测两条环境口径都无区分度：
  // ① happy-dom 把 fragment 插入展开成每子节点一条 childList 记录（MutationObserver 两条路径都得 30 条 1）；
  // ② 其 `appendChild` 是共享函数对象，`vi.spyOn` 的 `mock.instances` 对 fragment/容器的调用一律记成容器
  //    （31 次全判「落在容器上」）。可观测行为（卡片数/idx/延迟）已由上方用例锁死，此处不留假锁。
});

describe("instanceCardHeaderHTML 徽章 chips（真实实现）", () => {
  it("synced>0 → green 标签；extra>0 → orange 标签（title 语义锚点 = 面板既有文案）", () => {
    const html = instanceCardHeaderHTML({ name: "P", synced: 3, missing: 0, extra: 2 });
    expect(html).toContain(
      '<span class="tag green" data-role="synced-count" title="已同步">3</span>',
    );
    expect(html).toContain(
      '<span class="tag orange" data-role="extra-count" title="可拉取">2</span>',
    );
  });

  it("missing>0 && hasMod → red 标签（title=待推送）", () => {
    const html = instanceCardHeaderHTML({ name: "P", synced: 0, missing: 5, extra: 0, idx: 0, hasMod: true });
    expect(html).toContain(
      '<span class="tag red" data-role="missing-count" title="待推送">5</span>',
    );
  });

  it("missing>0 && !hasMod → 不显示 red 标签，改显 noMods 灰标签（带 rtype 标签）", () => {
    const html = instanceCardHeaderHTML({ name: "P", synced: 0, missing: 5, extra: 0, idx: 0, hasMod: false, rtype: "ysm" });
    expect(html).not.toContain('class="tag red"');
    expect(html).toContain('<span class="tag gray" data-role="no-mods">无YSM</span>');
  });

  it("rtype 无展示配置 → noMods 灰标签回落为 rtype 原始 id", () => {
    const html = instanceCardHeaderHTML({ name: "P", synced: 0, missing: 5, extra: 0, idx: 0, hasMod: false, rtype: "custom-type" });
    expect(html).toContain('<span class="tag gray" data-role="no-mods">无custom-type</span>');
  });

  it("MMD 子类型（场景模型）无模组 → 统一显示 无MMD，不显 无场景模型", () => {
    const html = instanceCardHeaderHTML({ name: "P", synced: 0, missing: 5, extra: 0, idx: 0, hasMod: false, rtype: "SceneModel" });
    expect(html).toContain('<span class="tag gray" data-role="no-mods">无MMD</span>');
    expect(html).not.toContain("无场景模型");
  });

  it("vrm 虽在 mmd 组但保持独立 VRM 标签", () => {
    const html = instanceCardHeaderHTML({ name: "P", synced: 0, missing: 5, extra: 0, idx: 0, hasMod: false, rtype: "vrm" });
    expect(html).toContain('<span class="tag gray" data-role="no-mods">无VRM</span>');
  });

  it("hasMod && 全零 → 显 success SVG 标签（带 data-role + 完全同步 title，不再裸显 0）", () => {
    const html = instanceCardHeaderHTML({ name: "P", synced: 0, missing: 0, extra: 0 });
    expect(html).toContain('<span class="tag" data-role="all-synced" title="完全同步">');
    expect(html).toContain('<svg class="ws-icon"'); // emoji 字形被设计令牌闸拦，走 SVG 体系
    expect(html).not.toContain(">0</span>");
  });

  // 2026-10 锐评 P0-1：disabled 维度显形（全禁用包此前漏显「完全同步 ✓」）
  it("disabled>0 → 灰「已禁用 N」标签（title 复用面板既有 key，零新增 i18n）", () => {
    const html = instanceCardHeaderHTML({ name: "P", synced: 0, missing: 0, extra: 0, disabled: 4 });
    expect(html).toContain('<span class="tag gray" data-role="disabled-count" title="已禁用">4</span>');
  });

  it("disabled>0 && 全零 → 不显 all-synced ✓（全禁用包不得误标「完全同步」）", () => {
    const html = instanceCardHeaderHTML({ name: "P", synced: 0, missing: 0, extra: 0, disabled: 3 });
    expect(html).not.toContain('data-role="all-synced"');
    expect(html).not.toContain("完全同步");
  });

  it("synced>0 && disabled>0 → 绿「已同步」与灰「已禁用」并存（有启用亦有禁用）", () => {
    const html = instanceCardHeaderHTML({ name: "P", synced: 2, missing: 0, extra: 0, disabled: 1 });
    expect(html).toContain('<span class="tag green" data-role="synced-count" title="已同步">2</span>');
    expect(html).toContain('<span class="tag gray" data-role="disabled-count" title="已禁用">1</span>');
  });

  it("状态计数以 data-role 落 DOM，且 📦 收口为可定位的 .pkg-icon / .instance-card-pkg-count", () => {
    const html = instanceCardHeaderHTML({ name: "P", synced: 2, missing: 5, extra: 1, idx: 0, hasMod: true });
    expect(html).toContain('data-role="synced-count"');
    expect(html).toContain('data-role="missing-count"');
    expect(html).toContain('data-role="extra-count"');
    // ADR-238：包图标由 emoji 📦 改走 SVG（pkg-icon 容器内是 SVG）
    expect(html).toMatch(/<span class="pkg-icon" aria-hidden="true"><svg class="ws-icon"/);
    expect(html).toContain('<span class="instance-card-pkg-count">');
  });

  it("hasMod && 非全零 → 不显 '0' 标签", () => {
    const html = instanceCardHeaderHTML({ name: "P", synced: 1, missing: 0, extra: 0 });
    expect(html).not.toContain('<span class="tag">0</span>');
  });

  it("!hasMod && 全零 → 灰标签优先于 '0' 标签", () => {
    const html = instanceCardHeaderHTML({ name: "P", synced: 0, missing: 0, extra: 0, idx: 0, hasMod: false });
    expect(html).toContain('<span class="tag gray"');
    expect(html).not.toContain('<span class="tag">0</span>');
    expect(html).not.toContain('class="tag red"');
  });

  it("name 经 esc 转义（防 XSS）", () => {
    const html = instanceCardHeaderHTML({ name: '<script>alert(1)</script>', synced: 1, missing: 0, extra: 0 });
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("data-idx 透传（卡片展开/安装按钮定位用）", () => {
    const html = instanceCardHeaderHTML({ name: "P", synced: 0, missing: 0, extra: 0, idx: 7 });
    expect(html).toContain('data-idx="7"');
  });
});

// P0 修复回归锁（2026-10）：加载失败态必须与空列表态**可区分**——原失败走
// renderVersionCards([]) 渲染成「未找到匹配的整合包 + 配目录按钮」，用户以为
// 真没装包。renderLoadError 只服务失败：错误文案 + role=alert + 重试入口。
describe("renderLoadError（失败态与空态分流）", () => {
  it("渲染加载失败文案（非空态文案）+ role=alert + 重试按钮", () => {
    const container = document.createElement("div");
    renderLoadError(container, () => {});

    expect(container.querySelector("[role='alert']")).not.toBeNull();
    expect(container.innerHTML).toContain("加载失败");
    // 不得混入空态文案（误导用户「没装整合包」）
    expect(container.innerHTML).not.toContain("未找到匹配的整合包");
    expect(container.querySelector("[data-sidebar-retry]")).not.toBeNull();
    // 失败态不是 option 列表：摘掉 listbox role（ADR-308 D2 同口径）
    expect(container.hasAttribute("role")).toBe(false);
  });

  it("点击重试 → 回调 onRetry 被调用", () => {
    const container = document.createElement("div");
    const onRetry = vi.fn();
    renderLoadError(container, onRetry);

    (container.querySelector("[data-sidebar-retry]") as HTMLElement).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("cleanup 后点击重试不再触发回调", () => {
    const container = document.createElement("div");
    const onRetry = vi.fn();
    const cleanup = renderLoadError(container, onRetry);
    cleanup();

    (container.querySelector("[data-sidebar-retry]") as HTMLElement).click();
    expect(onRetry).not.toHaveBeenCalled();
  });
});
