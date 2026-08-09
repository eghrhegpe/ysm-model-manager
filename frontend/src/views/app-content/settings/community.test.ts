// ===== 设置页初始化测试 =====
// 覆盖 initSettings：
//  - 初始化：版本号填充 / 高级面板渲染 / 链接提示
//  - 路径卡片点击 → SelectDirectory + SaveAppConfig + toast
//  - 游戏目录自动检测：单路径 / 无路径 / 多路径选择器（选择/取消）
//  - 链接模式切换 → SetLinkMode + 自动 relink；relink 无 mcRoot warn / 有实例成功
//  - 高级面板展开、主题卡片点击、镜像源切换、发布页跳转
import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "../../../test-utils/index.ts";
import { initSettings } from "./community.ts";

const {
  busEmit,
  busOn,
  getApp,
  loadResourceRegistry,
  loadTdKeymap,
  initVersionUpdater,
  friendlyError,
} = vi.hoisted(() => ({
  busEmit: vi.fn(),
  busOn: vi.fn(() => () => {}),
  getApp: vi.fn(),
  loadResourceRegistry: vi.fn(() => ({})),
  loadTdKeymap: vi.fn(() => []),
  initVersionUpdater: vi.fn(),
  friendlyError: vi.fn((e: unknown) => String((e as Error)?.message ?? e)),
}));

vi.mock("../../../bus.ts", () => ({ bus: { emit: busEmit, on: busOn } }));
vi.mock("../../../wails/app.ts", () => ({ getApp }));
vi.mock("../../../utils/resource/registry.ts", () => ({ loadResourceRegistry }));
vi.mock("../../../utils/3d/model3d.ts", () => ({ loadTdKeymap }));
vi.mock("../../../features/version-updater.ts", () => ({ initVersionUpdater }));
vi.mock("../../../utils/dom/errors.ts", () => ({ friendlyError }));

function makeRoot(): { root: ShadowRoot; el: HTMLDivElement } {
  const el = document.createElement("div");
  el.innerHTML = `
    <div id="set-mc-path"></div>
    <div id="set-files-root"></div>
    <div id="set-advanced-toggle"></div>
    <div id="set-advanced-panel"></div>
    <div id="set-advanced-grid"></div>
    <div id="stg-files-card"></div>
    <button id="set-mc-detect"></button>
    <div id="theme-picker">
      <div class="theme-card" data-theme="cyber"></div>
      <div class="theme-card" data-theme="dark"></div>
    </div>
    <select id="theme-auto">
      <option value="off">off</option><option value="system">system</option>
    </select>
    <select id="set-mirror">
      <option value="direct">direct</option>
      <option value="jsdelivr">jsdelivr</option>
    </select>
    <div id="mirror-hint-direct"></div><div id="mirror-hint-jsdelivr"></div><div id="mirror-hint-githubapi"></div>
    <select id="set-link-mode">
      <option value="copy">copy</option><option value="hardlink">hardlink</option>
    </select>
    <div id="lm-hint-copy"></div><div id="lm-hint-hardlink"></div><div id="lm-hint-symlink"></div>
    <button id="set-relink"></button>
    <div id="set-version"></div>
    <button id="set-releases"></button>
    <select id="set-lang"></select>
    <select id="set-font-size"></select>
    <select id="set-display-font"></select>
    <select id="set-card-density"></select>
    <select id="set-default-page"></select>
    <select id="set-animations"></select>
    <input id="td-camspeed"><span id="td-camspeed-val"></span>
    <div id="td-keymap-grid"></div>
    <button id="td-keymap-reset"></button>
    <select id="td-rotmode"></select>
    <div id="sz-base"></div><div id="sz-btn-h"></div><div id="sz-space"></div>
  `;
  (el as unknown as { getElementById: (id: string) => HTMLElement | null }).getElementById =
    (id: string) => el.querySelector(`#${id}`);
  return { root: el as unknown as ShadowRoot, el };
}

let appObj: Record<string, ReturnType<typeof vi.fn>>;

function mockApp(overrides: Record<string, unknown> = {}) {
  appObj = {
    LoadAppConfig: vi.fn(() => ({
      filesRoot: "/repo",
      resourcepackRoot: "",
      mcRoot: "",
      linkMode: "copy",
      mirror: "",
    })),
    SaveAppConfig: vi.fn(),
    SelectDirectory: vi.fn(() => "/pick"),
    GetMinecraftPaths: vi.fn(() => []),
    SetLinkMode: vi.fn(),
    SetResourceRoot: vi.fn(),
    ResetResourceRoot: vi.fn(),
    CurrentVersion: vi.fn(() => "v1.2.3"),
    OpenInBrowser: vi.fn(),
    ListVersionInstances: vi.fn(() => []),
    RelinkAllInstanceResources: vi.fn(() => 0),
    SetDownloadMirror: vi.fn(),
    ...overrides,
  };
  getApp.mockResolvedValue(appObj);
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  localStorage.clear();
  loadResourceRegistry.mockResolvedValue({
    ysm: { id: "ysm", name: "模型", icon: "🧊", storageSubDir: "ysm", configField: "YsmRoot" },
  });
  mockApp();
});

describe("initSettings — 初始化", () => {
  it("正常初始化：版本号填充 + 高级面板渲染 + 链接提示", async () => {
    const { root } = makeRoot();
    await initSettings(root);
    expect(root.getElementById("set-version")!.textContent).toBe("v1.2.3");
    const grid = root.getElementById("set-advanced-grid") as HTMLElement;
    expect(grid.textContent).toContain("模型");
    expect((root.getElementById("lm-hint-copy") as HTMLElement).style.display).toBe("block");
  });

  it("路径卡片点击 → SelectDirectory + SaveAppConfig + toast", async () => {
    const saveFn = vi.fn();
    mockApp({ SaveAppConfig: saveFn });
    const { root } = makeRoot();
    await initSettings(root);
    (root.getElementById("set-mc-path") as HTMLElement).click();
    await waitFor(() => saveFn.mock.calls.length > 0);
    // SaveAppConfig(filesRoot, rpRoot, mcRoot, linkMode, theme)
    expect(saveFn.mock.calls[0]![2]).toBe("/pick");
    expect(busEmit).toHaveBeenCalledWith("config:updated");
    expect(busEmit).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ msg: expect.stringContaining("路径已更新") }),
    );
  });
});

describe("initSettings — 游戏目录检测", () => {
  it("单路径 → 直接设置 + toast", async () => {
    const saveFn = vi.fn();
    mockApp({ GetMinecraftPaths: vi.fn(() => ["/mc"]), SaveAppConfig: saveFn });
    const { root } = makeRoot();
    await initSettings(root);
    (root.getElementById("set-mc-detect") as HTMLElement).click();
    await waitFor(() => saveFn.mock.calls.length > 0);
    expect(saveFn.mock.calls[0]![2]).toBe("/mc");
    expect(busEmit).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ msg: expect.stringContaining("/mc") }),
    );
  });

  it("无路径 → warn toast 未找到", async () => {
    const { root } = makeRoot();
    await initSettings(root);
    (root.getElementById("set-mc-detect") as HTMLElement).click();
    await waitFor(() =>
      busEmit.mock.calls.some(
        (c) => c[0] === "toast:show" && String(c[1]?.msg ?? "").includes("未找到"),
      ),
    );
  });

  it("多路径 → 选择器选择第一项后保存；取消则不保存", async () => {
    const saveFn = vi.fn();
    mockApp({
      GetMinecraftPaths: vi.fn(() => ["/mc1", "/mc2"]),
      SaveAppConfig: saveFn,
    });
    const { root } = makeRoot();
    await initSettings(root);
    (root.getElementById("set-mc-detect") as HTMLElement).click();
    await waitFor(() => document.querySelector(".mc-pick-item"));
    (document.querySelector(".mc-pick-item") as HTMLElement).click();
    await waitFor(() => saveFn.mock.calls.length > 0);
    expect(saveFn.mock.calls[0]![2]).toBe("/mc1");

    // 取消
    saveFn.mockClear();
    (root.getElementById("set-mc-detect") as HTMLElement).click();
    await waitFor(() => document.querySelector(".mc-pick-cancel"));
    (document.querySelector(".mc-pick-cancel") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(saveFn).not.toHaveBeenCalled();
  });
});

describe("initSettings — 链接模式与重链接", () => {
  it("链接模式 change → SaveAppConfig + SetLinkMode + toast + 自动 relink", async () => {
    const setLinkFn = vi.fn();
    mockApp({ SetLinkMode: setLinkFn });
    const { root } = makeRoot();
    await initSettings(root);
    const sel = root.getElementById("set-link-mode") as HTMLSelectElement;
    sel.value = "hardlink";
    sel.dispatchEvent(new Event("change"));
    await waitFor(() => setLinkFn.mock.calls.length > 0);
    expect(setLinkFn).toHaveBeenCalledWith("hardlink");
    expect(busEmit).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ msg: expect.stringContaining("hardlink") }),
    );
  });

  it("relink 无 mcRoot → warn toast", async () => {
    const { root } = makeRoot(); // mcRoot 为空
    await initSettings(root);
    (root.getElementById("set-relink") as HTMLElement).click();
    await waitFor(() =>
      busEmit.mock.calls.some(
        (c) => c[0] === "toast:show" && String(c[1]?.msg ?? "").includes("请先设置游戏根目录"),
      ),
    );
  });

  it("relink 有实例 → RelinkAllInstanceResources + 成功 toast", async () => {
    const relinkFn = vi.fn(() => 5);
    mockApp({
      LoadAppConfig: vi.fn(() => ({
        filesRoot: "/repo",
        resourcepackRoot: "",
        mcRoot: "/mc",
        linkMode: "copy",
      })),
      ListVersionInstances: vi.fn(() => [{ Name: "insA", Exists: true }]),
      RelinkAllInstanceResources: relinkFn,
    });
    const { root } = makeRoot();
    await initSettings(root);
    (root.getElementById("set-relink") as HTMLElement).click();
    await waitFor(() => relinkFn.mock.calls.length > 0);
    expect(busEmit).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ msg: expect.stringContaining("5 个文件") }),
    );
  });
});

describe("initSettings — 高级面板/主题/镜像/发布页", () => {
  it("高级面板 toggle → refreshAdvanced + panel 显示", async () => {
    const { root } = makeRoot();
    await initSettings(root);
    const panel = root.getElementById("set-advanced-panel") as HTMLElement;
    (root.getElementById("set-advanced-toggle") as HTMLElement).click();
    await waitFor(() => panel.style.display === "block");
    expect(panel.classList.contains("adv-open")).toBe(true);
    expect((root.getElementById("set-advanced-grid") as HTMLElement).textContent).toContain("模型");
  });

  it("主题卡片点击 → 写 theme + SaveAppConfig 同步", async () => {
    const saveFn = vi.fn();
    mockApp({ SaveAppConfig: saveFn });
    const { root } = makeRoot();
    await initSettings(root);
    const card = root.querySelector('.theme-card[data-theme="dark"]') as HTMLElement;
    card.click();
    expect(localStorage.getItem("theme")).toBe("dark");
    await waitFor(() => saveFn.mock.calls.length > 0);
    expect(saveFn.mock.calls[0]![4]).toBe("dark"); // 第 5 参是 theme
  });

  it("镜像源 change → SetDownloadMirror + toast + hint 切换", async () => {
    const setMirrorFn = vi.fn();
    mockApp({ SetDownloadMirror: setMirrorFn });
    const { root } = makeRoot();
    await initSettings(root);
    const sel = root.getElementById("set-mirror") as HTMLSelectElement;
    sel.value = "jsdelivr";
    sel.dispatchEvent(new Event("change"));
    await waitFor(() => setMirrorFn.mock.calls.length > 0);
    expect(setMirrorFn).toHaveBeenCalledWith("jsdelivr");
    expect(
      (root.getElementById("mirror-hint-jsdelivr") as HTMLElement).style.display,
    ).toBe("block");
  });

  it("发布页按钮 → OpenInBrowser", async () => {
    const { root } = makeRoot();
    await initSettings(root);
    (root.getElementById("set-releases") as HTMLElement).click();
    await waitFor(() => appObj.OpenInBrowser.mock.calls.length > 0);
    expect(appObj.OpenInBrowser).toHaveBeenCalledWith(
      "https://github.com/eghrhegpe/ysm-model-manager/releases",
    );
  });

  it("初始化调用 initVersionUpdater + loadTdKeymap", async () => {
    const { root } = makeRoot();
    await initSettings(root);
    expect(initVersionUpdater).toHaveBeenCalledWith(root);
    expect(loadTdKeymap).toHaveBeenCalled();
  });
});
