// ===== 设置页初始化测试 =====
// 覆盖 initSettings：
//  - 初始化：版本号填充 / 高级面板渲染 / 链接提示
//  - 路径卡片点击 → SelectDirectory + SaveAppConfig + toast
//  - 游戏目录自动检测：单路径 / 无路径 / 多路径选择器（选择/取消）
//  - 链接模式切换 → SetLinkMode + 自动 relink；relink 无 mcRoot warn / 有实例成功
//  - 高级面板展开、主题卡片点击、镜像源切换、发布页跳转
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { waitFor } from "../../../test-utils/index.ts";
import { initSettings } from "./init.ts";

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
  busOn: vi.fn((_event: string, _fn: (p: unknown) => void) => () => {}),
  getApp: vi.fn(),
  loadResourceRegistry: vi.fn(() => ({})),
  // 模拟真实 loadTdKeymap（utils/3d/keymap.ts）：从 localStorage 读取并合并默认键位——
  // 固定返回 [] 会让 JSON.stringify 丢弃数组额外属性，键位保存/冲突分支无法正确断言
  loadTdKeymap: vi.fn(() => {
    const base: Record<string, string> = {
      forward: "KeyW",
      back: "KeyS",
      left: "KeyA",
      right: "KeyD",
      up: "Space",
      down: "ShiftLeft",
    };
    try {
      const raw = localStorage.getItem("td-keymap");
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, string>;
        Object.keys(base).forEach((k) => {
          if (typeof parsed[k] === "string" && parsed[k]) base[k] = parsed[k];
        });
      }
    } catch {
      /* 解析失败回退默认 */
    }
    return base;
  }),
  initVersionUpdater: vi.fn(),
  friendlyError: vi.fn((e: unknown) => String((e as Error)?.message ?? e)),
}));

vi.mock("../../../bus.ts", () => ({ bus: { emit: busEmit, on: busOn } }));
vi.mock("../../../backend/app.ts", () => ({ getApp }));
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
    <button id="set-launcher-detect"></button>
    <div id="theme-picker">
      <div class="theme-card" data-theme="cyber"></div>
      <div class="theme-card" data-theme="dark"></div>
    </div>
    <select id="theme-auto">
      <option value="off">off</option><option value="system">system</option><option value="time">time</option>
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
    <select id="set-font-size">
      <option value="small">small</option><option value="normal">normal</option><option value="large">large</option>
    </select>
    <select id="set-display-font">
      <option value="kaiti">kaiti</option><option value="system">system</option>
    </select>
    <select id="set-card-density">
      <option value="compact">compact</option><option value="spacious">spacious</option>
    </select>
    <select id="set-default-page">
      <option value="repository">repository</option><option value="instances">instances</option>
    </select>
    <select id="set-animations"></select>
    <input type="checkbox" id="set-fbx-worker">
    <input type="checkbox" id="set-mmd-worker">
    <input id="td-camspeed"><span id="td-camspeed-val"></span>
    <div id="td-keymap-grid"></div>
    <button id="td-keymap-reset"></button>
    <select id="td-rotmode">
      <option value="orbit">orbit</option><option value="free">free</option>
    </select>
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
    DetectLauncherInstances: vi.fn(() => []),
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

/** 挂载 theme:change bus 监听 spy（theme.ts 经 bus.emit("theme:change") 调用，直接断言） */
function themeChangeSpy(): ReturnType<typeof vi.fn> {
  return vi.fn();
}

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
  it("选择 PCL 实例 → 保存游戏根目录并将 custom 设为 YSM 默认下载目录", async () => {
    const saveFn = vi.fn();
    const setRootFn = vi.fn();
    mockApp({
      SaveAppConfig: saveFn,
      SetResourceRoot: setRootFn,
      DetectLauncherInstances: vi.fn(() => [{
        launcher: "PCL",
        name: "Fabric 1.20.1",
        gameVersion: "1.20.1",
        gameRoot: "/pcl/.minecraft",
        gameDir: "/pcl/.minecraft/versions/Fabric 1.20.1",
        customDir: "/pcl/.minecraft/versions/Fabric 1.20.1/config/yes_steve_model/custom",
        exists: true,
      }]),
    });
    const { root } = makeRoot();
    await initSettings(root);
    (root.getElementById("set-launcher-detect") as HTMLElement).click();
    await waitFor(() => document.querySelector(".launcher-pick-item"));
    (document.querySelector(".launcher-pick-item") as HTMLElement).click();
    await waitFor(() => setRootFn.mock.calls.length > 0);
    expect(saveFn.mock.calls.at(-1)?.[2]).toBe("/pcl/.minecraft");
    expect(setRootFn).toHaveBeenCalledWith(
      "ysm",
      "/pcl/.minecraft/versions/Fabric 1.20.1/config/yes_steve_model/custom",
    );
  });

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

describe("initSettings — 主题自动切换（theme.ts）", () => {
  it("auto 切 system → theme:change bus + theme 落盘 + 卡片取消选中", async () => {
    const spy = themeChangeSpy();
    busOn.mockImplementation((event: string, fn: (p: unknown) => void) => {
      if (event === "theme:change") busEmit.mockImplementation(() => {});
      return () => {};
    });
    const { root } = makeRoot();
    await initSettings(root);
    const sel = root.getElementById("theme-auto") as HTMLSelectElement;
    sel.value = "system";
    sel.dispatchEvent(new Event("change"));
    expect(busEmit).toHaveBeenCalledWith("theme:change", { name: "system" });
    expect(localStorage.getItem("theme")).toBe("system");
    expect(localStorage.getItem("theme-auto")).toBe("system");
    expect(root.querySelectorAll(".theme-card.active").length).toBe(0);
  });

  it("auto 切 time → 写入实际时间段主题（warm/cyber）而非非法值 time", async () => {
    themeChangeSpy();
    const { root } = makeRoot();
    await initSettings(root);
    const sel = root.getElementById("theme-auto") as HTMLSelectElement;
    sel.value = "time";
    sel.dispatchEvent(new Event("change"));
    const theme = localStorage.getItem("theme");
    expect(theme === "warm" || theme === "cyber").toBe(true);
    expect(localStorage.getItem("theme-auto")).toBe("time");
  });

  it("auto 切 off → 不覆盖当前主题", async () => {
    themeChangeSpy();
    localStorage.setItem("theme", "cyber");
    const { root } = makeRoot();
    await initSettings(root);
    const sel = root.getElementById("theme-auto") as HTMLSelectElement;
    sel.value = "off";
    sel.dispatchEvent(new Event("change"));
    expect(localStorage.getItem("theme")).toBe("cyber");
  });

  it("持久化 theme-auto=system 初始化 → theme:change bus 发射 system", async () => {
    themeChangeSpy();
    localStorage.setItem("theme-auto", "system");
    const { root } = makeRoot();
    await initSettings(root);
    expect(busEmit).toHaveBeenCalledWith("theme:change", { name: "system" });
  });
});

describe("initSettings — UI 偏好（ui-prefs.ts）", () => {
  it("字号 change → --fs-scale 更新 + toast", async () => {
    const { root } = makeRoot();
    await initSettings(root);
    const sel = root.getElementById("set-font-size") as HTMLSelectElement;
    sel.value = "large";
    sel.dispatchEvent(new Event("change"));
    expect(document.documentElement.style.getPropertyValue("--fs-scale")).toBe("2px");
    expect(busEmit).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ msg: expect.stringContaining("字号已更新") }),
    );
  });

  it("动画关/开 → .no-animations class 切换", async () => {
    const { root } = makeRoot();
    await initSettings(root);
    const input = root.getElementById("set-animations") as HTMLInputElement;
    input.checked = false;
    input.dispatchEvent(new Event("change"));
    expect(document.documentElement.classList.contains("no-animations")).toBe(true);
    expect(localStorage.getItem("ui-animations")).toBe("off");
    input.checked = true;
    input.dispatchEvent(new Event("change"));
    expect(document.documentElement.classList.contains("no-animations")).toBe(false);
    expect(localStorage.getItem("ui-animations")).toBe("on");
  });

  it("卡片密度 change → --card-padding 更新", async () => {
    const { root } = makeRoot();
    await initSettings(root);
    const sel = root.getElementById("set-card-density") as HTMLSelectElement;
    sel.value = "spacious";
    sel.dispatchEvent(new Event("change"));
    expect(document.documentElement.style.getPropertyValue("--card-padding")).toBe("10px 14px");
    expect(localStorage.getItem("ui-card-density")).toBe("spacious");
  });
});

describe("initSettings — 3D 解析 worker 开关（worker-prefs.ts）", () => {
  it("默认（未配置）→ 两个 worker 开关均不选中", async () => {
    const { root } = makeRoot();
    await initSettings(root);
    expect((root.getElementById("set-fbx-worker") as HTMLInputElement).checked).toBe(false);
    expect((root.getElementById("set-mmd-worker") as HTMLInputElement).checked).toBe(false);
  });

  it("localStorage 预置 =1 → 初始化选中对应开关", async () => {
    localStorage.setItem("fbx-worker", "1");
    localStorage.setItem("mmd-pmx-worker", "1");
    const { root } = makeRoot();
    await initSettings(root);
    expect((root.getElementById("set-fbx-worker") as HTMLInputElement).checked).toBe(true);
    expect((root.getElementById("set-mmd-worker") as HTMLInputElement).checked).toBe(true);
  });

  it("FBX 开关开 → fbx-worker=1 + toast", async () => {
    const { root } = makeRoot();
    await initSettings(root);
    const input = root.getElementById("set-fbx-worker") as HTMLInputElement;
    input.checked = true;
    input.dispatchEvent(new Event("change"));
    expect(localStorage.getItem("fbx-worker")).toBe("1");
    expect(busEmit).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ msg: expect.stringContaining("已开启") }),
    );
  });

  it("MMD 开关开/关 → mmd-pmx-worker=1 / 0", async () => {
    const { root } = makeRoot();
    await initSettings(root);
    const input = root.getElementById("set-mmd-worker") as HTMLInputElement;
    input.checked = true;
    input.dispatchEvent(new Event("change"));
    expect(localStorage.getItem("mmd-pmx-worker")).toBe("1");
    input.checked = false;
    input.dispatchEvent(new Event("change"));
    expect(localStorage.getItem("mmd-pmx-worker")).toBe("0");
  });
});

describe("initSettings — 3D 键位（keymap.ts）", () => {
  it("捕获按键 → 写入 td-keymap + 成功 toast", async () => {
    const { root } = makeRoot();
    await initSettings(root);
    const grid = root.getElementById("td-keymap-grid") as HTMLElement;
    const firstBtn = grid.querySelector("button") as HTMLElement; // 前移
    firstBtn.click();
    expect(firstBtn.textContent).toContain("按键");
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyB" }));
    const saved = JSON.parse(localStorage.getItem("td-keymap") || "{}") as Record<string, string>;
    expect(saved.forward).toBe("KeyB");
    expect(busEmit).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ msg: expect.stringContaining("前移") }),
    );
  });

  it("Escape 取消捕获 → 不保存", async () => {
    const { root } = makeRoot();
    await initSettings(root);
    const grid = root.getElementById("td-keymap-grid") as HTMLElement;
    (grid.querySelector("button") as HTMLElement).click();
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
    expect(localStorage.getItem("td-keymap")).toBeNull();
  });

  it("键位冲突 → warn toast 且不覆盖已有绑定", async () => {
    localStorage.setItem(
      "td-keymap",
      JSON.stringify({
        forward: "KeyW",
        back: "KeyS",
        left: "KeyA",
        right: "KeyD",
        up: "Space",
        down: "ShiftLeft",
      }),
    );
    const { root } = makeRoot();
    await initSettings(root);
    const grid = root.getElementById("td-keymap-grid") as HTMLElement;
    (grid.querySelector("button") as HTMLElement).click(); // 前移
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyS" })); // KeyS 已被「后移」占用
    expect(busEmit).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ msg: expect.stringContaining("已被") }),
    );
    // 冲突不落盘：已有绑定保持不变
    const saved = JSON.parse(localStorage.getItem("td-keymap") || "{}") as Record<string, string>;
    expect(saved.forward).toBe("KeyW");
    expect(saved.back).toBe("KeyS");
  });

  it("设置页卸载后捕获自动放弃 → 无残留全局 keydown 劫持", async () => {
    const { root } = makeRoot();
    await initSettings(root);
    const grid = root.getElementById("td-keymap-grid") as HTMLElement;
    (grid.querySelector("button") as HTMLElement).click();
    grid.remove(); // 模拟设置页卸载
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyB" }));
    expect(localStorage.getItem("td-keymap")).toBeNull();
    expect(
      busEmit.mock.calls.some((c) => c[0] === "toast:show" && String(c[1]?.msg ?? "").includes("前移")),
    ).toBe(false);
  });

  it("恢复默认 → 清除 td-keymap + toast", async () => {
    localStorage.setItem("td-keymap", JSON.stringify({ forward: "KeyB" }));
    const { root } = makeRoot();
    await initSettings(root);
    (root.getElementById("td-keymap-reset") as HTMLElement).click();
    expect(localStorage.getItem("td-keymap")).toBeNull();
    expect(busEmit).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ msg: expect.stringContaining("已恢复默认键位") }),
    );
  });

  it("相机速度 input → 预览值 + 落盘", async () => {
    const { root } = makeRoot();
    await initSettings(root);
    const input = root.getElementById("td-camspeed") as HTMLInputElement;
    input.value = "50";
    input.dispatchEvent(new Event("input"));
    expect((root.getElementById("td-camspeed-val") as HTMLElement).textContent).toBe("50");
    expect(localStorage.getItem("td-cam-speed")).toBe("50");
  });

  it("旋转模式 change → 落盘", async () => {
    const { root } = makeRoot();
    await initSettings(root);
    const sel = root.getElementById("td-rotmode") as HTMLSelectElement;
    sel.value = "free";
    sel.dispatchEvent(new Event("change"));
    expect(localStorage.getItem("td-rot-mode")).toBe("free");
  });
});

describe("initSettings — 错误路径与降级", () => {
  it("CurrentVersion 失败 → 版本号显示 —（无无限加载态）", async () => {
    mockApp({ CurrentVersion: vi.fn(() => Promise.reject(new Error("ver boom"))) });
    const { root } = makeRoot();
    await initSettings(root);
    expect((root.getElementById("set-version") as HTMLElement).textContent).toBe("—");
  });

  it("SetDownloadMirror 失败 → 错误 toast（有出口）", async () => {
    mockApp({ SetDownloadMirror: vi.fn(() => Promise.reject(new Error("mirror boom"))) });
    const { root } = makeRoot();
    await initSettings(root);
    const sel = root.getElementById("set-mirror") as HTMLSelectElement;
    sel.value = "jsdelivr";
    sel.dispatchEvent(new Event("change"));
    await waitFor(() =>
      busEmit.mock.calls.some(
        (c) => c[0] === "toast:show" && String(c[1]?.msg ?? "").includes("mirror boom"),
      ),
    );
  });

  it("链接模式切换失败 → 错误 toast（不静默）", async () => {
    mockApp({ SetLinkMode: vi.fn(() => Promise.reject(new Error("link boom"))) });
    const { root } = makeRoot();
    await initSettings(root);
    const sel = root.getElementById("set-link-mode") as HTMLSelectElement;
    sel.value = "hardlink";
    sel.dispatchEvent(new Event("change"));
    await waitFor(() =>
      busEmit.mock.calls.some(
        (c) => c[0] === "toast:show" && String(c[1]?.msg ?? "").includes("link boom"),
      ),
    );
  });

  it("路径保存失败 → 错误 toast（有出口）", async () => {
    mockApp({ SaveAppConfig: vi.fn(() => Promise.reject(new Error("save boom"))) });
    const { root } = makeRoot();
    await initSettings(root);
    (root.getElementById("set-mc-path") as HTMLElement).click();
    await waitFor(() =>
      busEmit.mock.calls.some(
        (c) => c[0] === "toast:show" && String(c[1]?.msg ?? "").includes("save boom"),
      ),
    );
  });

  it("relink 实例部分失败 → 失败数提示", async () => {
    mockApp({
      LoadAppConfig: vi.fn(() => ({
        filesRoot: "/repo",
        resourcepackRoot: "",
        mcRoot: "/mc",
        linkMode: "copy",
      })),
      ListVersionInstances: vi.fn(() => [
        { Name: "insA", Exists: true },
        { Name: "insB", Exists: true },
      ]),
      RelinkAllInstanceResources: vi.fn(() => {
        throw new Error("relink boom");
      }),
    });
    const { root } = makeRoot();
    await initSettings(root);
    (root.getElementById("set-relink") as HTMLElement).click();
    await waitFor(() =>
      busEmit.mock.calls.some(
        (c) => c[0] === "toast:show" && String(c[1]?.msg ?? "").includes("2 个整合包重新链接失败"),
      ),
    );
  });

  it("检测进行中重复点击 → 防连点（仅一次 GetMinecraftPaths）", async () => {
    const getPaths = vi.fn(() => new Promise(() => {})); // 永不 resolve，模拟检测进行中
    mockApp({ GetMinecraftPaths: getPaths });
    const { root } = makeRoot();
    await initSettings(root);
    const btn = root.getElementById("set-mc-detect") as HTMLElement;
    btn.click();
    btn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(getPaths).toHaveBeenCalledTimes(1);
  });
});

describe("initSettings — 高级面板路径设置/重置", () => {
  it("点击路径文字 → SetResourceRoot + toast + 重渲染出重置按钮", async () => {
    const setRootFn = vi.fn();
    mockApp({ SetResourceRoot: setRootFn });
    const { root } = makeRoot();
    await initSettings(root);
    const grid = root.getElementById("set-advanced-grid") as HTMLElement;
    (grid.querySelector(".stg-path-picker") as HTMLElement).click();
    await waitFor(() => setRootFn.mock.calls.length > 0);
    expect(setRootFn).toHaveBeenCalledWith("ysm", "/pick");
    await waitFor(() => root.querySelector(".stg-adv-reset"));
    expect(busEmit).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ msg: expect.stringContaining("路径已设置") }),
    );
  });

  it("重置 → ResetResourceRoot + 卡片刷新 + toast", async () => {
    const resetFn = vi.fn();
    mockApp({ SetResourceRoot: vi.fn(), ResetResourceRoot: resetFn });
    const { root } = makeRoot();
    await initSettings(root);
    const grid = root.getElementById("set-advanced-grid") as HTMLElement;
    (grid.querySelector(".stg-path-picker") as HTMLElement).click();
    await waitFor(() => root.querySelector(".stg-adv-reset"));
    (root.querySelector(".stg-adv-reset") as HTMLElement).click();
    await waitFor(() => resetFn.mock.calls.length > 0);
    expect(resetFn).toHaveBeenCalledWith("ysm");
    expect(busEmit).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ msg: expect.stringContaining("已恢复默认") }),
    );
  });
});

describe("initSettings — 扫描提示气泡", () => {
  it("hover 显示气泡并列出路径，移出移除", async () => {
    mockApp({ GetMinecraftPaths: vi.fn(() => ["/mc1", "/mc2"]) });
    const { root } = makeRoot();
    await initSettings(root);
    const btn = root.getElementById("set-mc-detect") as HTMLElement;
    btn.dispatchEvent(new Event("pointerenter"));
    await waitFor(() => document.getElementById("mc-scan-tooltip"));
    const tip = document.getElementById("mc-scan-tooltip") as HTMLElement;
    expect(tip.textContent).toContain("/mc1");
    btn.dispatchEvent(new Event("pointerleave"));
    expect(document.getElementById("mc-scan-tooltip")).toBeNull();
  });

  it("await 期间移出 → 不残留气泡（竞态修复）", async () => {
    let resolvePaths: (v: string[]) => void = () => {};
    mockApp({
      GetMinecraftPaths: vi.fn(() => new Promise<string[]>((r) => (resolvePaths = r))),
    });
    const { root } = makeRoot();
    await initSettings(root);
    const btn = root.getElementById("set-mc-detect") as HTMLElement;
    btn.dispatchEvent(new Event("pointerenter"));
    btn.dispatchEvent(new Event("pointerleave")); // GetMinecraftPaths 完成前移出
    resolvePaths(["/mc1", "/mc2"]);
    await new Promise((r) => setTimeout(r, 0));
    expect(document.getElementById("mc-scan-tooltip")).toBeNull();
  });
});
