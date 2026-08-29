// ===== ysm-controls 菜单面板测试（[doc:adr-126-p4-b-2] 截图面板声明式化）=====
// 覆盖：ysmShotNodes（声明式节点结构）、fillYsmShotPanel（命令式行为，向后兼容）。
// 模型面板 fillYsmModelPanel / fill3DPanel 在 skeleton.test.ts / skeleton-fill-panel scope 覆盖。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ysmShotNodes, fillYsmShotPanel, type YsmControlsContext } from "./ysm-controls.ts";

// 截图链路（Wails 绑定 SaveScreenshotFile）在 node 测试环境不可用——
// mock saveScreenshot 隔离副作用，只验证 ysmShotNodes 的 action 触发截图调用
vi.mock("./skeleton-render.ts", () => ({
  saveScreenshot: vi.fn().mockResolvedValue(undefined),
}));
import { saveScreenshot as saveScreenshotMock } from "./skeleton-render.ts";

// registerYsmModelSchema 的 schema 组装委托给 skeleton-fill-panel（重 DOM 逻辑，
// 已由 skeleton-fill-panel 自身测试覆盖）——此处 mock 掉，只验证注册与订阅接线
vi.mock("./skeleton-fill-panel.ts", () => ({
  buildYsmModelSchema: vi.fn(() => []),
}));
import { buildYsmModelSchema } from "./skeleton-fill-panel.ts";
import { registerYsmModelSchema } from "./ysm-controls.ts";
import {
  YSM_MODEL_SCHEMA_ID,
  hasSchema,
  getSchema,
  resetSchemas,
} from "../../utils/3d/adapters/schema-registry.ts";
import {
  setStateValue,
  getStateValue,
  resetSettingsListeners,
  resetActiveComponent,
} from "../../utils/3d/state/preview-state.ts";

function makeCtx(overrides: Partial<YsmControlsContext> = {}): YsmControlsContext {
  return {
    model: {
      boneCount: 0,
      cubeCount: 0,
      texWidth: 0,
      texHeight: 0,
      bones: [],
      _modelPath: "/m/a.ysm",
      textures: null,
    },
    texIdx: 0,
    texArr: [],
    spec: {} as never,
    handle: {
      showModelGroup: vi.fn(),
      getModelGroupCount: () => 1,
      setBoneVisible: vi.fn(),
      toggleBone: vi.fn(),
      getBoneList: () => [],
      onBoneSelect: null,
      _boneDetailEl: null,
    },
    screenshot: () => Promise.resolve("b64"),
    ...overrides,
  } as YsmControlsContext;
}

describe("ysmShotNodes（P4-B-2 声明式节点）", () => {
  it("产出 6 个 button 节点（ys m- 前缀 id），legacyTestId 兼容旧 e2e", () => {
    const nodes = ysmShotNodes(makeCtx());
    expect(nodes.length).toBe(6);
    expect(nodes.map((n) => n.id)).toEqual([
      "ysm-shot-current", "ysm-shot-front", "ysm-shot-45", "ysm-shot-side", "ysm-shot-back45", "ysm-shot-all",
    ]);
    expect(nodes.every((n) => n.kind === "button")).toBe(true);
    expect(nodes[0].legacyTestId).toBe("shot-current");
    expect(nodes[0].icon).toBe("📷");
  });

  it("screenshot 未定义（undefined，ctx 可选字段）时仍产出 6 按钮（面板常驻，走 fallback）", () => {
    // YSM 与 MMD 不同：screenshot 是 ctx 可选字段，缺失时面板不消失（saveScreenshot fallback）
    const nodes = ysmShotNodes(makeCtx({ screenshot: undefined }));
    expect(nodes.length).toBe(6);
  });

  it("action 触发截图调用（saveScreenshot 被 mock，fire-and-forget）", async () => {
    const nodes = ysmShotNodes(makeCtx());
    const action = nodes[0].action!;
    const actionCtx = { toast: vi.fn(), closeAllOverlays: vi.fn() };
    // action 是 fire-and-forget（void saveShot），内部 async 链路——等 microtask 冲刷后断言
    action(actionCtx);
    await vi.waitFor(() => {
      expect(saveScreenshotMock).toHaveBeenCalled();
    });
  });
});

describe("fillYsmShotPanel（命令式，向后兼容）", () => {
  it("渲染 6 个截图按钮，testid = shot-<key>", () => {
    const list = document.createElement("div");
    fillYsmShotPanel(list, makeCtx());
    expect(list.querySelectorAll('[data-testid^="shot-"]').length).toBe(6);
    expect(list.querySelector('[data-testid="shot-current"]')).not.toBeNull();
  });

  it("点击按钮触发 saveShot（saveScreenshot 以 model + 角度 key 被调）", async () => {
    const list = document.createElement("div");
    const ctx = makeCtx();
    fillYsmShotPanel(list, ctx);
    const btn = list.querySelector('[data-testid="shot-front"]') as HTMLElement;
    expect(btn).not.toBeNull();
    btn.click();
    await vi.waitFor(() => {
      expect(saveScreenshotMock).toHaveBeenCalled();
    });
    expect(saveScreenshotMock).toHaveBeenCalledWith(
      ctx.model,
      "front",
      expect.any(Function),
      expect.any(Function),
    );
  });
});

describe("registerYsmModelSchema（P5 受控注册 + ui.activeComponent 订阅）", () => {
  beforeEach(() => {
    resetSchemas();
    resetSettingsListeners();
    resetActiveComponent();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetSchemas();
    resetSettingsListeners();
    resetActiveComponent();
  });

  it("注册 YSM_MODEL_SCHEMA_ID builder；调用 builder 时以 ctx + 状态快照委托 buildYsmModelSchema", () => {
    const ctx = makeCtx();
    const off = registerYsmModelSchema(ctx);
    expect(typeof off).toBe("function");
    expect(hasSchema(YSM_MODEL_SCHEMA_ID)).toBe(true);
    const builder = getSchema(YSM_MODEL_SCHEMA_ID)!;
    expect(builder).toBeDefined();
    const snap = { "ui.activeComponent": 0 } as never;
    builder(snap);
    expect(buildYsmModelSchema).toHaveBeenCalledTimes(1);
    expect(buildYsmModelSchema).toHaveBeenCalledWith(
      { model: ctx.model, spec: ctx.spec, texArr: ctx.texArr },
      snap,
    );
    off();
  });

  it("ui.activeComponent 变更 → showModelGroup(新值)；其他路径变更不触发；off() 退订后不再触发", () => {
    const ctx = makeCtx();
    const showModelGroup = ctx.handle.showModelGroup as ReturnType<typeof vi.fn>;
    const off = registerYsmModelSchema(ctx);
    // 非 ui.activeComponent 路径变更：订阅回调被通知但不触发副作用（单一消费点）
    setStateValue("render.maxFps", 60);
    expect(showModelGroup).not.toHaveBeenCalled();
    setStateValue("ui.activeComponent", 2);
    expect(showModelGroup).toHaveBeenCalledTimes(1);
    expect(showModelGroup).toHaveBeenCalledWith(2);
    // 状态层读回与写入一致（写读一致契约）
    expect(getStateValue("ui.activeComponent")).toBe(2);
    off();
    setStateValue("ui.activeComponent", 3);
    expect(showModelGroup).toHaveBeenCalledTimes(1);
  });
});
