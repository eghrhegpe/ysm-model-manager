// ===== community 仓库页事件编排集成测试（G-1 — ADR-035 / Design.md §19.1）=====
// 样板模式：断言基于 data-testid 稳定钩子（gh-* 前缀）+ bus 事件流 + queue mock；
// 渲染/筛选/大小策略等纯函数已单独测（render.test / download-tasks.test），本文件只验证编排层。
// 命名：编排/委托链路 → .integration.（§19.2；被测 events.ts 非 Web Component，不属 .component.）
import { describe, it, expect, vi, beforeEach } from "vitest";
import { bus } from "@/bus";

// mock 下载队列（编排层委托点；enqueue 等由 download-queue.test 覆盖，这里只验证委托）
const queueMock = vi.hoisted(() => ({
  isDownloading: vi.fn(() => false),
  enqueue: vi.fn(async () => {}),
  cancel: vi.fn(async () => {}),
  destroy: vi.fn(),
}));

// mock bindings（阻断 Wails runtime 加载链）
vi.mock("@/backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({ OpenInBrowser: vi.fn() }),
}));
vi.mock("./download-queue.ts", () => ({
  createDownloadQueue: () => queueMock,
}));
vi.mock("@/utils/dom/modal-confirm.ts", () => ({
  modalConfirm: vi.fn().mockResolvedValue(true),
}));

import { getApp } from "@/backend/app.ts";
import { t } from "@/core/i18n/t.ts";
import { bindRepoEvents, type RepoEventsContext } from "./events.ts";
import { type WorkshopModel } from "./render.ts";
import { fireClick, fireInput } from "@/test-utils/events.ts";
import {
  DOWNLOAD_CONFIRM_BYTES,
  DOWNLOAD_REJECT_BYTES,
} from "./download-tasks.ts";

const models: WorkshopModel[] = [
  { name: "角色A.ysm", path: "repo/角色A.ysm", size: 1024 },
  { name: "角色B.ysm", path: "repo/角色B.ysm", size: DOWNLOAD_CONFIRM_BYTES + 1 },
  { name: "角色C.ysm", path: "repo/角色C.ysm", size: DOWNLOAD_REJECT_BYTES + 1 },
];

function makeSr(ms: WorkshopModel[] = models): {
  sr: HTMLElement;
  ctx: RepoEventsContext;
} {
  const sr = document.createElement("div");
  sr.innerHTML = `
    <button class="gh-back-repo" data-testid="gh-back">← 返回</button>
    <input id="gh-repo-srch" class="gh-search" data-testid="gh-srch">
    <button class="gh-toggle-missing" data-testid="gh-toggle">📁 仅显示缺失</button>
    <div id="gh-repo-list" data-testid="gh-list"></div>
    <button class="gh-dl-selected" data-testid="gh-dl-selected" disabled>⬇️ 下载选中 (0)</button>
    <label class="gh-select-all" data-testid="gh-select-all"><input type="checkbox"> 全选</label>
  `;
  document.body.appendChild(sr);
  const ctx: RepoEventsContext = {
    esc: (s) => s,
    models: ms,
    dlPrefix: "https://dl/",
    repo: "repo",
    source: "src",
    showRepoModels: vi.fn(),
    backToSite: vi.fn(),
    localMap: new Map(), // 全空 → 全部缺失 → 渲染 checkbox + 下载按钮
  };
  return { sr, ctx };
}

/** 挂载并渲染初始列表 */
function mount(ms: WorkshopModel[] = models): {
  sr: HTMLElement;
  ctx: RepoEventsContext;
  handle: ReturnType<typeof bindRepoEvents>;
} {
  const { sr, ctx } = makeSr(ms);
  const handle = bindRepoEvents(sr, ctx);
  // renderList 内部经虚拟列表写入 #gh-repo-list（jsdom 零高度 → 自动全量回退）
  handle.renderList();
  return { sr, ctx, handle };
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("community 仓库页事件编排（G-1 样板）", () => {
  it("1. renderList 渲染全部缺失行，各带下载按钮与 data-testid", () => {
    const { sr } = mount();
    const list = sr.querySelector('[data-testid="gh-list"]')!;
    expect(list.querySelectorAll('[data-testid="gh-row"]').length).toBe(3);
    expect(
      list.querySelectorAll('[data-testid="gh-dl"]').length,
    ).toBe(3);
    expect(list.querySelector('[data-testid="gh-dl"]')?.getAttribute("data-url")).toBe(
      "https://dl/repo/角色A.ysm",
    );
  });

  it("2. 搜索过滤 → 列表重渲染为命中行", () => {
    const { sr } = mount();
    const srch = sr.querySelector('[data-testid="gh-srch"]') as HTMLInputElement;
    fireInput(srch, "角色A");
    const list = sr.querySelector('[data-testid="gh-list"]')!;
    expect(list.querySelectorAll('[data-testid="gh-row"]').length).toBe(1);
    expect(list.querySelector('[data-testid="gh-name"]')?.textContent).toContain("角色A");
  });

  it("3. 仅显示缺失切换 → 按钮文案翻转 + active", () => {
    const { sr } = mount();
    const toggle = sr.querySelector('[data-testid="gh-toggle"]') as HTMLElement;
    fireClick(toggle);
    expect(toggle.textContent).toContain("显示全部");
    expect(toggle.classList.contains("active")).toBe(true);
    fireClick(toggle);
    expect(toggle.textContent).toContain("仅显示缺失");
    expect(toggle.classList.contains("active")).toBe(false);
  });

  it("4. 勾选行复选框 → 下载按钮计数与 enabled", () => {
    const { sr } = mount();
    const cb = sr.querySelector('[data-testid="gh-cb"]') as HTMLInputElement;
    cb.checked = true;
    cb.dispatchEvent(new Event("change", { bubbles: true }));
    const btn = sr.querySelector('[data-testid="gh-dl-selected"]') as HTMLButtonElement;
    expect(btn.textContent).toContain("1");
    expect(btn.disabled).toBe(false);
    cb.checked = false;
    cb.dispatchEvent(new Event("change", { bubbles: true }));
    expect((sr.querySelector('[data-testid="gh-dl-selected"]') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("5. 全选 → 全部勾选计数 3；取消全选 → 0", () => {
    const { sr } = mount();
    const all = sr.querySelector('[data-testid="gh-select-all"] input') as HTMLInputElement;
    all.checked = true;
    all.dispatchEvent(new Event("change", { bubbles: true }));
    expect(sr.querySelectorAll('[data-testid="gh-cb"]:checked').length).toBe(3);
    expect((sr.querySelector('[data-testid="gh-dl-selected"]') as HTMLButtonElement).textContent).toContain("3");
    all.checked = false;
    all.dispatchEvent(new Event("change", { bubbles: true }));
    expect(sr.querySelectorAll('[data-testid="gh-cb"]:checked').length).toBe(0);
  });

  it("6. 下载选中 → enqueue 收到按选中集构建的任务", async () => {
    const { sr } = mount();
    const cb = sr.querySelector('[data-testid="gh-cb"]') as HTMLInputElement;
    cb.checked = true;
    cb.dispatchEvent(new Event("change", { bubbles: true }));
    fireClick(sr.querySelector('[data-testid="gh-dl-selected"]') as HTMLElement);
    await vi.waitFor(() => expect(queueMock.enqueue).toHaveBeenCalledTimes(1));
    expect(queueMock.enqueue).toHaveBeenCalledWith([
      { url: "https://dl/repo/角色A.ysm", saveDir: "", name: "角色A.ysm", size: 1024 },
    ]);
  });

  it("7. 单文件 ok 下载（≤4MB）直接 enqueue 并勾选同步", async () => {
    const { sr } = mount();
    const btn = sr.querySelector(
      '[data-testid="gh-dl"][data-name="角色A.ysm"]',
    ) as HTMLElement;
    await fireClick(btn);
    await vi.waitFor(() => expect(queueMock.enqueue).toHaveBeenCalledTimes(1));
    expect(
      (sr.querySelector('[data-testid="gh-cb"]') as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("8. 单文件 confirm 下载（4–10MB）先弹确认再 enqueue", async () => {
    const { sr } = mount();
    const btn = sr.querySelector(
      '[data-testid="gh-dl"][data-name="角色B.ysm"]',
    ) as HTMLElement;
    await fireClick(btn);
    await vi.waitFor(() => expect(queueMock.enqueue).toHaveBeenCalledTimes(1));
    expect(queueMock.enqueue).toHaveBeenCalledWith([
      expect.objectContaining({ name: "角色B.ysm", size: DOWNLOAD_CONFIRM_BYTES + 1 }),
    ]);
  });

  it("9. 单文件 reject（>10MB）→ toast 提示且不 enqueue", async () => {
    const toastSpy = vi.fn();
    const unsub = bus.on("toast:show", toastSpy);
    const { sr } = mount();
    const btn = sr.querySelector(
      '[data-testid="gh-dl"][data-name="角色C.ysm"]',
    ) as HTMLElement;
    await fireClick(btn);
    expect(toastSpy).toHaveBeenCalled();
    expect(toastSpy.mock.calls[0][0].msg).toContain("超过 10MB");
    expect(queueMock.enqueue).not.toHaveBeenCalled();
    unsub();
  });

  it("10. 右键模型行 → ctx:show（type workshop，携带模型细节）；裸发 menu:show 已杀灭（ADR-208 D3）", () => {
    const ctxSpy = vi.fn();
    const ctxUnsub = bus.on("ctx:show", ctxSpy);
    const menuSpy = vi.fn();
    const menuUnsub = bus.on("menu:show", menuSpy);
    const { sr } = mount();
    const row = sr.querySelector('[data-testid="gh-row"][data-name="角色A.ysm"]') as HTMLElement;
    row.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, clientX: 1, clientY: 2 }),
    );
    expect(ctxSpy).toHaveBeenCalledTimes(1);
    const payload = ctxSpy.mock.calls[0][0];
    expect(payload.type).toBe("workshop");
    expect(payload.workshop).toMatchObject({ name: "角色A.ysm", path: "repo/角色A.ysm", size: 1024 });
    // 幽灵菜单回归防线：社区域不得再绕过 menu-defs 单一事实源裸发 menu:show
    expect(menuSpy).not.toHaveBeenCalled();
    ctxUnsub();
    menuUnsub();
  });

  it("11. B站搜索按钮 → OpenInBrowser（作者提取）", async () => {
    const authorModels: WorkshopModel[] = [
      { name: "[作者]角色A.ysm", path: "repo/x.ysm", size: 1024 },
    ];
    const { sr } = mount(authorModels);
    const searchBtn = sr.querySelector('[data-testid="gh-search-bili"]') as HTMLElement;
    await fireClick(searchBtn);
    const app = await getApp();
    expect(app.OpenInBrowser).toHaveBeenCalledTimes(1);
    expect(vi.mocked(app.OpenInBrowser).mock.calls[0][0]).toContain("search.bilibili.com");
    expect(vi.mocked(app.OpenInBrowser).mock.calls[0][0]).toContain(encodeURIComponent("作者"));
  });

  it("12. cleanup → 取消队列 + 监听移除（再点返回不再触发）", async () => {
    const { sr, ctx, handle } = mount();
    await handle.cleanup();
    expect(queueMock.cancel).toHaveBeenCalled();
    expect(queueMock.destroy).toHaveBeenCalled();
    fireClick(sr.querySelector('[data-testid="gh-back"]') as HTMLElement);
    expect(ctx.backToSite).not.toHaveBeenCalled();
  });

  it("13. 下载选中 + 队列下载中 → i18n 守卫 toast（workshop.downloading），不 enqueue", async () => {
    queueMock.isDownloading.mockReturnValueOnce(true);
    const { sr } = mount();
    const cb = sr.querySelector('[data-testid="gh-cb"]') as HTMLInputElement;
    cb.checked = true;
    cb.dispatchEvent(new Event("change", { bubbles: true }));
    const toastSpy = vi.fn();
    const unsub = bus.on("toast:show", toastSpy);
    fireClick(sr.querySelector('[data-testid="gh-dl-selected"]') as HTMLElement);
    await vi.waitFor(() => expect(toastSpy).toHaveBeenCalledTimes(1));
    unsub();
    // 精确匹配 i18n 键渲染（防硬编码中文串回归，ADR-208 D4）
    expect(toastSpy.mock.calls[0][0].msg).toBe(t("workshop.downloading"));
    expect(queueMock.enqueue).not.toHaveBeenCalled();
  });
});
