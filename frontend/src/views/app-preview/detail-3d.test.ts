// ===== 3D 入口卡测试（detail-3d.ts）=====
// detail.test.ts 已覆盖 showVrmMeta/showMmdPreview 基础路径；本文件聚焦四个未测入口卡
// （FBX / Scene / Morph / Stage）+ showVrmMeta 的 meta 分支补全（限制徽章 / 参考链接 /
// 缩略图 / esc 转义 / 过期守卫），按 2D 详情卡同构范式（makeCtx + vi.hoisted mock）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MockInstance } from "vitest";
import { bus } from "@/bus";
import { previewCSS } from "./css.ts";
import type { PreviewCtx } from "./utils.ts";
import { createLoadGuard } from "@/utils/async/load-guard.ts";
import type { LoadGuard } from "@/utils/async/load-guard.ts";

const {
  getAppMock,
  vrmMetaMock,
  createVrm3DMock,
  createFbx3DMock,
  createScene3DMock,
  openModel3DFullscreenMock,
  resolveMmdSiblingsMock,
  resolveFbxSiblingsMock,
  resolveSceneSiblingsMock,
  resolveMorphSiblingsMock,
  resolveStageSiblingsMock,
} = vi.hoisted(() => ({
  getAppMock: vi.fn(),
  vrmMetaMock: vi.fn(),
  createVrm3DMock: vi.fn(),
  createFbx3DMock: vi.fn(),
  createScene3DMock: vi.fn(),
  openModel3DFullscreenMock: vi.fn(),
  resolveMmdSiblingsMock: vi.fn(),
  resolveFbxSiblingsMock: vi.fn(),
  resolveSceneSiblingsMock: vi.fn(),
  resolveMorphSiblingsMock: vi.fn(),
  resolveStageSiblingsMock: vi.fn(),
}));

vi.mock("@/backend/app.ts", () => ({ getApp: getAppMock }));
vi.mock("@/preview-3d/adapters/vrm/vrm-adapter.ts", () => ({
  readVrmMeta: vrmMetaMock,
}));
// ADR-072 薄包装 + siblings 解析器全部 mock，阻断 3D 渲染管线 import 链
vi.mock("./vrm-3d.ts", () => ({ createVrm3D: createVrm3DMock }));
vi.mock("./fbx-3d.ts", () => ({ createFbx3D: createFbx3DMock }));
vi.mock("./scene-3d.ts", () => ({ createScene3D: createScene3DMock }));
// ADR-253 D2：详情卡 FAB 改走统一路由入口（openModel3DFullscreen），不再直调 createXxx3D
vi.mock("./preview-library.ts", () => ({ openModel3DFullscreen: openModel3DFullscreenMock }));
vi.mock("./siblings.ts", () => ({
  resolveMmdSiblings: resolveMmdSiblingsMock,
  resolveFbxSiblings: resolveFbxSiblingsMock,
  resolveSceneSiblings: resolveSceneSiblingsMock,
  resolveMorphSiblings: resolveMorphSiblingsMock,
  resolveStageSiblings: resolveStageSiblingsMock,
}));

import {
  showVrmMeta,
  showMmdPreview,
  showFbxPreview,
  showScenePreview,
  showMorphPreview,
  showStagePreview,
} from "./detail-3d.ts";

function makeCtx(detailGen?: LoadGuard): PreviewCtx {
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  return {
    root,
    loadPreviewImage: vi.fn().mockResolvedValue(null),
    unsubs: [],
    decodeYsmViaWasm: vi.fn(),
    appendDebug: vi.fn(),
    dragAbortCtrl: null,
    active3DClose: null,
    getPrefer3D: vi.fn().mockReturnValue(false),
    setPrefer3D: vi.fn(),
    // 跨入口卡互相作废的场景须传同一 guard（生产 = 同一 AppPreview 实例同一 ctx，
    // commit 058b6c82f 起 detailGen 为实例属性注入，不再有模块级隐式共享）
    detailGen: detailGen ?? createLoadGuard(),
  };
}

let emitSpy: MockInstance;

beforeEach(() => {
  vi.clearAllMocks();
  getAppMock.mockResolvedValue({
    ReadFileBytes: vi.fn().mockResolvedValue(null),
  });
  resolveMmdSiblingsMock.mockResolvedValue([]);
  resolveFbxSiblingsMock.mockResolvedValue([]);
  resolveSceneSiblingsMock.mockResolvedValue([]);
  resolveMorphSiblingsMock.mockResolvedValue([]);
  resolveStageSiblingsMock.mockResolvedValue([]);
  emitSpy = vi.spyOn(bus, "emit");
});

afterEach(() => {
  emitSpy.mockRestore();
});

/** 按事件名过滤 bus.emit 调用，取 payload 列表 */
function emitted(name: string): unknown[] {
  return emitSpy.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);
}

describe("showVrmMeta 分支补全", () => {
  it("完整 meta + 限制徽章 + 缩略图 + 参考链接 → 全量渲染", async () => {
    vrmMetaMock.mockResolvedValue({
      name: "测试模型",
      authors: ["作者A", "", "作者B"],
      version: "1.0",
      license: "CC_BY",
      contact: "contact@example.com",
      thumbnail: "data:image/png;base64,AAA",
      restrictions: {
        reference: "https://x.com/a?b=1",
        commercial: true,
        allowedUser: "everyone",
        sexual: false,
      },
    });
    const ctx = makeCtx();
    await showVrmMeta(ctx, "/repo/avatar.vrm");
    const html = ctx.root.innerHTML;
    // 缩略图
    expect(html).toContain('<img src="data:image/png;base64,AAA"');
    // authors.filter(Boolean) 过滤空串
    expect(html).toContain("作者A、作者B");
    expect(html).toContain("版本: 1.0");
    expect(html).toContain("contact@example.com");
    expect(html).toContain("CC_BY");
    // 参考链接（refBadge）
    expect(html).toContain("https://x.com/a?b=1");
    // 四枚限制徽章 + 值符号：商用✅ / 用户✅ / 性❌ / 暴力(undefined)→—
    expect(html).toContain("商用");
    expect(html).toContain("用户");
    expect(html).toContain("性");
    expect(html).toContain("暴力");
    expect(html).toContain("✅");
    expect(html).toContain("❌");
    expect(html).toContain("—");
  });

  it("meta 只有 name（无 authors）→ 仍走完整卡，作者行不渲染", async () => {
    vrmMetaMock.mockResolvedValue({ name: "仅名称模型", authors: [] });
    const ctx = makeCtx();
    await showVrmMeta(ctx, "/repo/x.vrm");
    const html = ctx.root.innerHTML;
    expect(html).toContain("仅名称模型");
    // 卡片本体已渲染（非解析占位）
    expect(html).toContain("preview-content");
    expect(html).not.toContain("正在解析模型文件");
    expect(html).not.toContain("<img");
    // ADR-253 D7：详情卡 3D 入口 FAB（#btn-vrm-3d）已删除，3D 统一走左下角 nav-fab
    expect(html).not.toContain("btn-vrm-3d");
  });

  it("meta 无缩略图 → 不渲染 img；restrictions 无 reference → 无参考行", async () => {
    vrmMetaMock.mockResolvedValue({
      name: "模型",
      authors: ["A"],
      restrictions: { commercial: undefined, allowedUser: "restricted" },
    });
    const ctx = makeCtx();
    await showVrmMeta(ctx, "/repo/y.vrm");
    const html = ctx.root.innerHTML;
    expect(html).not.toContain("<img");
    expect(html).not.toContain("📎");
    // ADR-238：徽章图标由 emoji 改走 SVG（users 图标），断言形态而非具体路径
    expect(html).toContain('<svg class="ws-icon"');
  });

  it("authors 含 HTML → esc 转义，不注入原始标签", async () => {
    vrmMetaMock.mockResolvedValue({
      name: "安全模型",
      authors: ["<b>evil</b>"],
    });
    const ctx = makeCtx();
    await showVrmMeta(ctx, "/repo/esc.vrm");
    const html = ctx.root.innerHTML;
    expect(html).toContain("&lt;b&gt;evil&lt;/b&gt;");
    expect(html).not.toContain("<b>evil</b>");
  });

  it("await 期间被 showMmdPreview invalidate（成功回包）→ 过期守卫静默返回，不覆盖占位", async () => {
    let release!: (v: unknown) => void;
    vrmMetaMock.mockImplementation(
      () =>
        new Promise((res) => {
          release = res;
        }),
    );
    const sharedGen = createLoadGuard();
    const ctx1 = makeCtx(sharedGen);
    const p1 = showVrmMeta(ctx1, "/repo/slow.vrm");
    // 并发的 MMD 入口卡共用同一 detailGen（生产 = 同一 AppPreview 实例）
    const ctx2 = makeCtx(sharedGen);
    await showMmdPreview(ctx2, "/repo/other.pmx");
    release({ name: "迟到模型", authors: ["A"] });
    await p1;
    // ctx1 仍停留在解析占位，迟到 meta 不回写
    expect(ctx1.root.innerHTML).toContain("正在解析模型文件");
    expect(ctx1.root.innerHTML).not.toContain("迟到模型");
  });

  it("await 期间被 invalidate（错误回包）→ 同样静默，不渲染错误占位", async () => {
    let reject!: (e: unknown) => void;
    vrmMetaMock.mockImplementation(
      () =>
        new Promise((_, rej) => {
          reject = rej;
        }),
    );
    const sharedGen = createLoadGuard();
    const ctx1 = makeCtx(sharedGen);
    const p1 = showVrmMeta(ctx1, "/repo/slow2.vrm");
    const ctx2 = makeCtx(sharedGen);
    await showMmdPreview(ctx2, "/repo/other2.pmx");
    reject(new Error("late boom"));
    await p1;
    expect(ctx1.root.innerHTML).toContain("正在解析模型文件");
    expect(ctx1.root.innerHTML).not.toContain("读取失败");
  });
});

describe("showFbxPreview FBX 入口卡", () => {
  it("默认标签 + 文件名（siblings 由 3D 入口按 rtype 自算兜底，ADR-253 D2）", async () => {
    const ctx = makeCtx();
    await showFbxPreview(ctx, "/repo/dance.fbx");
    const html = ctx.root.innerHTML;
    expect(html).toContain("FBX 模型/动画");
    expect(html).toContain("dance.fbx");
    // ADR-253 D7：FBX 详情卡 FAB（#btn-fbx-3d）已删除
  });

  it("自定义 opts → 使用传入图标与标签", async () => {
    const ctx = makeCtx();
    await showFbxPreview(ctx, "/repo/motion.fbx", {
      icon: "🦴",
      label: "FBX 动画",
    });
    expect(ctx.root.innerHTML).toContain("🦴 FBX 动画");
  });
});

describe("showScenePreview 场景 MMD 入口卡", () => {
  it("SceneModel 徽章 + 场景模型标签 + 文件名（ADR-253 D2/D7）", async () => {
    const ctx = makeCtx();
    await showScenePreview(ctx, "/repo/scene/main.pmx");
    const html = ctx.root.innerHTML;
    expect(html).toContain("SceneModel");
    expect(html).toContain("场景模型");
    expect(html).toContain("main.pmx");
    // ADR-253 D7：场景卡 FAB（#btn-scene-3d）已删除
  });
});

describe("showMorphPreview CustomMorph 入口卡", () => {
  it("兄弟列表渲染 + 当前项高亮 + 计数行；点击项 → model:select(CustomMorph)", async () => {
    resolveMorphSiblingsMock.mockResolvedValue([
      "/repo/morphs/a.vpd",
      "/repo/morphs/b.vpd",
    ]);
    const ctx = makeCtx();
    await showMorphPreview(ctx, "/repo/morphs/a.vpd");
    const html = ctx.root.innerHTML;
    expect(html).toContain("CustomMorph");
    expect(html).toContain("全部 2 个表情姿势");
    const items = ctx.root.querySelectorAll<HTMLElement>(".morph-item");
    expect(items.length).toBe(2);
    // 当前 path 高亮（修复后走 .active class：内联 style 既表达不了 :hover，
    // 又因缺分号把 font-weight 并进非法声明整体丢弃）
    expect(items[0].classList.contains("active")).toBe(true);
    expect(items[1].classList.contains("active")).toBe(false);
    // hover/高亮规则本体在 shared previewCSS（CSS 收口 91b90c87d 迁出内联 <style>，
    // adoptedStyleSheets 不进 innerHTML——改查样式表本体，语义等价）
    expect(previewCSS).toContain(".morph-item:hover");
    expect(previewCSS).toContain(".morph-item.active");
    // 点击兄弟项 → 带 rtype 的 model:select
    items[1].click();
    expect(emitted("model:select")).toEqual([
      { path: "/repo/morphs/b.vpd", isDir: false, rtype: "CustomMorph" },
    ]);
  });

  it("空兄弟列表 → 渲染暂无提示", async () => {
    resolveMorphSiblingsMock.mockResolvedValue([]);
    const ctx = makeCtx();
    await showMorphPreview(ctx, "/repo/morphs/a.vpd");
    expect(ctx.root.innerHTML).toContain("暂无其他表情姿势");
    expect(ctx.root.querySelectorAll(".morph-item").length).toBe(0);
  });

  it("兄弟列表加载失败 → 不阻断，列表区降级为空", async () => {
    resolveMorphSiblingsMock.mockRejectedValue(new Error("scan fail"));
    const ctx = makeCtx();
    await showMorphPreview(ctx, "/repo/morphs/a.vpd");
    expect(ctx.root.querySelectorAll(".morph-item").length).toBe(0);
  });
});

describe("showStagePreview StageAnim 入口卡", () => {
  it("内容按 kind 分组统计 + 逐项渲染；点击项 → model:select(StageAnim)", async () => {
    resolveStageSiblingsMock.mockResolvedValue([
      { path: "/repo/stage/x/run.vmd", kind: "vmd" },
      { path: "/repo/stage/x/cam.vmd", kind: "vmd" },
      { path: "/repo/stage/x/bgm.mp3", kind: "audio" },
      { path: "/repo/stage/x/stage_config.json", kind: "config" },
    ]);
    const ctx = makeCtx();
    await showStagePreview(ctx, "/repo/stage/x");
    const html = ctx.root.innerHTML;
    expect(html).toContain("StageAnim");
    // 计数行：2 动作 / 1 音频 / 1 配置
    expect(html).toContain("包含: 2 动作 / 1 音频 / 1 配置");
    const items = ctx.root.querySelectorAll<HTMLElement>(".stage-item");
    expect(items.length).toBe(4);
    items[2].click(); // 音频项
    expect(emitted("model:select")).toEqual([
      { path: "/repo/stage/x/bgm.mp3", isDir: false, rtype: "StageAnim" },
    ]);
  });

  it("空舞台包 → 渲染空态提示", async () => {
    resolveStageSiblingsMock.mockResolvedValue([]);
    const ctx = makeCtx();
    await showStagePreview(ctx, "/repo/stage/empty");
    expect(ctx.root.innerHTML).toContain("舞台包为空或目录不存在");
    expect(ctx.root.querySelectorAll(".stage-item").length).toBe(0);
  });
});
