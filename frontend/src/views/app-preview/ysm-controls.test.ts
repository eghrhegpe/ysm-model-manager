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
  makeYsmModelSchemaId,
  hasSchema,
  getSchema,
  resetSchemas,
} from "../../utils/3d/adapters/schema-registry.ts";
import {
  resetSettingsListeners,
  resetActiveComponent,
  type PreviewSnapshot,
} from "../../utils/3d/state/preview-state.ts";
import type { Spec3D } from "../../utils/3d/model3d.ts";

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
    spec: {} as unknown as Spec3D,
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

describe("registerYsmModelSchema（P5 受控注册 + B2 per-scene 会话态）", () => {
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

  it("注册 builder；调用 builder 时以 ctx + 状态快照委托 buildYsmModelSchema（缺省 sessionId → 旧全局 key 兼容）", () => {
    const ctx = makeCtx();
    const off = registerYsmModelSchema(ctx);
    expect(typeof off).toBe("function");
    expect(hasSchema(YSM_MODEL_SCHEMA_ID)).toBe(true);
    const builder = getSchema(YSM_MODEL_SCHEMA_ID)!;
    expect(builder).toBeDefined();
    const snap = { "ui.activeComponent": 0 } as unknown as PreviewSnapshot;
    builder(snap);
    expect(buildYsmModelSchema).toHaveBeenCalledTimes(1);
    expect(buildYsmModelSchema).toHaveBeenCalledWith(
      { model: ctx.model, spec: ctx.spec, texArr: ctx.texArr },
      snap,
      expect.objectContaining({ get: expect.any(Function), set: expect.any(Function) }),
    );
    off();
  });

  it("传 sessionId → 注册到 per-scene key（ysm-model-{sessionId}），不占旧全局键", () => {
    const ctx = makeCtx();
    const off = registerYsmModelSchema(ctx, "m1");
    expect(typeof off).toBe("function");
    // per-scene key 注册；旧全局键不被本次注册占用
    expect(hasSchema(makeYsmModelSchemaId("m1"))).toBe(true);
    expect(hasSchema(YSM_MODEL_SCHEMA_ID)).toBe(false);
    expect(getSchema(makeYsmModelSchemaId("m1"))).toBeTypeOf("function");
    off();
    // dispose 后 per-scene key 精准注销
    expect(hasSchema(makeYsmModelSchemaId("m1"))).toBe(false);
  });

  it("[Bug A 端到端] YSM/maid 同框 schema 隔离：两个 sessionId 的 builder 都活着，互不覆盖", () => {
    const ctxA = makeCtx();
    const ctxB = makeCtx();
    // 先后注册（模拟 YSM + maid 同台，旧实现第二次会静默覆盖第一次的 builder 闭包）
    const offA = registerYsmModelSchema(ctxA, "m1");
    const offB = registerYsmModelSchema(ctxB, "m2");
    expect(hasSchema(makeYsmModelSchemaId("m1"))).toBe(true);
    expect(hasSchema(makeYsmModelSchemaId("m2"))).toBe(true);
    // 两个 builder 都活着——各自 getSchema 取到各自闭包
    const builderA = getSchema(makeYsmModelSchemaId("m1"))!;
    const builderB = getSchema(makeYsmModelSchemaId("m2"))!;
    expect(builderA).toBeDefined();
    expect(builderB).toBeDefined();
    expect(builderA).not.toBe(builderB);
    // 各自构建时拿自己的 ctx（不串数据）
    builderA({} as unknown as PreviewSnapshot);
    expect(buildYsmModelSchema).toHaveBeenLastCalledWith(
      { model: ctxA.model, spec: ctxA.spec, texArr: ctxA.texArr },
      expect.anything(),
      expect.anything(),
    );
    builderB({} as unknown as PreviewSnapshot);
    expect(buildYsmModelSchema).toHaveBeenLastCalledWith(
      { model: ctxB.model, spec: ctxB.spec, texArr: ctxB.texArr },
      expect.anything(),
      expect.anything(),
    );
    // 注销 A 不影响 B（dispose 精准清理）
    offA();
    expect(hasSchema(makeYsmModelSchemaId("m1"))).toBe(false);
    expect(hasSchema(makeYsmModelSchemaId("m2"))).toBe(true);
    offB();
  });

  it("[Bug B] activeComponent per-scene 会话态：set 闭包 → showModelGroup；两场景互不串扰", () => {
    // B2 后组件选择不再走全局状态层——registerYsmModelSchema 持 per-scene `_local` 闭包，
    // 经 sessionActiveComponent 第三参交给 buildYsmModelSchema（select get/set 读写它），
    // set 触发 showModelGroup（单一消费点）。两场景各自闭包隔离，互不串扰。
    const ctxA = makeCtx();
    const ctxB = makeCtx();
    const showA = ctxA.handle.showModelGroup as ReturnType<typeof vi.fn>;
    const showB = ctxB.handle.showModelGroup as ReturnType<typeof vi.fn>;
    // 捕获每个注册实例传给 buildYsmModelSchema 的会话态闭包（mock 返回 []，节点产出在
    // skeleton-fill-panel.test.ts 覆盖——此处只验证 registerYsmModelSchema 的接线）。
    // 注意 builder 惰性：注册后须调用 builder 才触发 buildYsmModelSchema。
    const offA = registerYsmModelSchema(ctxA, "m1");
    const offB = registerYsmModelSchema(ctxB, "m2");
    getSchema(makeYsmModelSchemaId("m1"))!({} as unknown as PreviewSnapshot);
    getSchema(makeYsmModelSchemaId("m2"))!({} as unknown as PreviewSnapshot);
    const calledA = vi.mocked(buildYsmModelSchema).mock.calls[0]![2]!;
    const calledB = vi.mocked(buildYsmModelSchema).mock.calls[1]![2]!;
    expect(calledA).not.toBe(calledB); // per-scene：各自独立闭包
    // 场景 A 组件 select set → A 的 showModelGroup，B 不触发（不串扰）
    calledA.set!(2);
    expect(showA).toHaveBeenCalledWith(2);
    expect(showB).not.toHaveBeenCalled();
    // 场景 B 独立读写自己的会话态
    expect(calledB.get!()).toBe(-1);
    calledB.set!(0);
    expect(showB).toHaveBeenCalledWith(0);
    expect(showA).toHaveBeenCalledTimes(1); // A 不受 B 影响
    offA();
    offB();
  });
});
