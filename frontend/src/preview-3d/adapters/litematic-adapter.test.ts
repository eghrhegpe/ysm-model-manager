// ===== litematic-adapter 容器内多模型测试（ADR-132 遗留 1）=====
// 覆盖：buildLitematicScene 多候选 select 注入、切换重建、单候选退化 null、
// 裸文件（无 containerPath）零回归、containerPath 下 voxelCall 变体。
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";
import type { PreviewBuildCtx, PreviewScene } from "./mount-preview-core.ts";

vi.mock("../screenshot.ts", () => ({
  screenshotFromRenderer: vi.fn(() => Promise.resolve("screenshot-url")),
}));
// frustum-cull 模块级注册表：测试环境空实现（真模块可跑，但避免跨用例 state 串扰）
vi.mock("../frustum-cull.ts", () => ({
  registerModelRoot: vi.fn(),
  unregisterModelRoot: vi.fn(),
}));
vi.mock("../load-trace.ts", () => ({
  recordLoadTrace: vi.fn(),
}));

import { buildLitematicScene } from "./litematic-adapter.ts";

const VALID_JSON = {
  groups: [{ positions: [[1, 2, 3], [4, 5, 6]], color: "#ff0000" }],
  size: [16, 16, 16],
  truncated: false,
  maxBlocks: 200000,
};

function makeCtx() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  return {
    scene, camera,
    controls: {
      target: new THREE.Vector3(), minDistance: 1, maxDistance: 100,
      update: vi.fn(),
    },
    viewContainer: document.createElement("div"),
    loadingEl: document.createElement("div"),
    overlay: document.createElement("div"),
    menu: { setAdapterItems: vi.fn(), openPanel: vi.fn(), refreshDock: vi.fn(), dispose: vi.fn() },
    renderer: { domElement: document.createElement("div") } as unknown as THREE.WebGLRenderer,
    cameraControls: { setOrbit: vi.fn(), setSpeed: vi.fn() },
  } as unknown as PreviewBuildCtx;
}

/** 分层切片 schema builder 取节点（menuItems 含 slice panel 节点 + select） */
function menuNodes(preview: PreviewScene): NonNullable<PreviewScene["menuItems"]> {
  return preview.menuItems ?? [];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildLitematicScene 裸文件回归（无 containerPath）", () => {
  it("voxelCall 收到裸路径，menuItems 无 multi-model select（单模型）", async () => {
    const voxelCall = vi.fn().mockResolvedValue(VALID_JSON);
    const ctx = makeCtx();
    const preview = await buildLitematicScene(ctx, "/lib/a.litematic", voxelCall);
    expect(voxelCall).toHaveBeenCalledWith("/lib/a.litematic");
    const nodes = menuNodes(preview);
    expect(nodes.some((n) => n.id === "litematic-model-select")).toBe(false);
    // 切片面板仍在
    expect(nodes.some((n) => n.id === "slice")).toBe(true);
    preview.dispose();
  });
});

describe("buildLitematicScene 容器内多模型（ADR-132）", () => {
  it("modelEntries 多候选 → menuItems 含 litematic-model-select 节点（kind:select，options 含全部 entry）", async () => {
    const voxelCall = vi.fn().mockResolvedValue(VALID_JSON);
    const ctx = makeCtx();
    const preview = await buildLitematicScene(ctx, "builds/a.nbt", voxelCall, {
      containerPath: "/lib/blueprint.zip",
      modelEntries: ["builds/a.nbt", "builds/b.litematic"],
      entryExt: ".nbt",
    });
    // 容器内 voxelCall 已由视图壳注入——此处测试直接传 containerPath 场景的调用形态由
    // litematic-3d 测试覆盖；本测试验证 build 消费 modelEntries 注入 select
    const sel = menuNodes(preview).find((n) => n.id === "litematic-model-select");
    expect(sel).toBeDefined();
    expect(sel!.kind).toBe("select");
    expect(sel!.control?.options?.map((o) => o.value)).toEqual(["builds/a.nbt", "builds/b.litematic"]);
    // activeId 闭包 = build 入参 path（当前 entry）
    expect(sel!.control?.get?.(undefined)).toBe("builds/a.nbt");
    preview.dispose();
  });

  it("build 非首 entry → get 返回该 entry（activeId 闭包）", async () => {
    const voxelCall = vi.fn().mockResolvedValue(VALID_JSON);
    const ctx = makeCtx();
    const preview = await buildLitematicScene(ctx, "builds/b.litematic", voxelCall, {
      containerPath: "/lib/blueprint.zip",
      modelEntries: ["builds/a.nbt", "builds/b.litematic"],
      entryExt: ".litematic",
    });
    const sel = menuNodes(preview).find((n) => n.id === "litematic-model-select");
    expect(sel!.control?.get?.(undefined)).toBe("builds/b.litematic");
    preview.dispose();
  });

  it("modelEntries 单候选 → 无 select 节点（无选择语义）", async () => {
    const voxelCall = vi.fn().mockResolvedValue(VALID_JSON);
    const ctx = makeCtx();
    const preview = await buildLitematicScene(ctx, "builds/a.nbt", voxelCall, {
      containerPath: "/lib/blueprint.zip",
      modelEntries: ["builds/a.nbt"],
      entryExt: ".nbt",
    });
    expect(menuNodes(preview).some((n) => n.id === "litematic-model-select")).toBe(false);
    preview.dispose();
  });

  it("select set → ctx.switchTo(entryPath) 触发重建", async () => {
    const voxelCall = vi.fn().mockResolvedValue(VALID_JSON);
    const switchTo = vi.fn(() => Promise.resolve());
    const ctx = makeCtx() as unknown as PreviewBuildCtx & { switchTo: (p: string) => Promise<void> };
    ctx.switchTo = switchTo;
    const preview = await buildLitematicScene(ctx, "builds/a.nbt", voxelCall, {
      containerPath: "/lib/blueprint.zip",
      modelEntries: ["builds/a.nbt", "builds/b.litematic"],
      entryExt: ".nbt",
    });
    const sel = menuNodes(preview).find((n) => n.id === "litematic-model-select")!;
    sel.control!.set!("builds/b.litematic");
    expect(switchTo).toHaveBeenCalledWith("builds/b.litematic");
    preview.dispose();
  });

  it("modelEntries 空 → 无 select（空容器退化）", async () => {
    const voxelCall = vi.fn().mockResolvedValue(VALID_JSON);
    const ctx = makeCtx();
    const preview = await buildLitematicScene(ctx, "builds/a.nbt", voxelCall, {
      containerPath: "/lib/blueprint.zip",
      modelEntries: [],
      entryExt: ".nbt",
    });
    expect(menuNodes(preview).some((n) => n.id === "litematic-model-select")).toBe(false);
    preview.dispose();
  });
});

describe("buildLitematicScene 错误/空数据路径（回归）", () => {
  it("voxelCall 返回 null（error 通道）→ earlyResult（loadingEl 显示空态，无 dispose 崩溃）", async () => {
    const voxelCall = vi.fn().mockResolvedValue(null);
    const ctx = makeCtx();
    const result = await buildLitematicScene(ctx, "/x.nbt", voxelCall);
    expect(result.dispose).toBeDefined();
    expect(ctx.loadingEl.textContent).toContain("⚠️");
  });

  it("空 groups → earlyResult（voxelEmpty）", async () => {
    const voxelCall = vi.fn().mockResolvedValue({ groups: [], size: [10, 10, 10] });
    const ctx = makeCtx();
    const result = await buildLitematicScene(ctx, "/empty.litematic", voxelCall);
    expect(result.dispose).toBeDefined();
  });
});

// ===== loadingEl 语义契约（防 0a0e4bd3 → b18a647c 回归）=====
// 契约 1：voxelCall 抛错时 buildLitematicScene 必须抛错（不能吞掉返回空壳）
//         —— mount3D 的 catch 依赖此异常触发 showLoadFailure(loadingEl, e)
// 契约 2：voxelCall 抛错时 loadingEl 必须保留（不能 remove）
//         —— showLoadFailure 复用 loadingEl 渲染失败占位
// 契约 3：成功时 loadingEl 必须被 remove（适配器自行清理）
// 契约 4：空数据/null 时 loadingEl 必须保留并显示提示
//         —— 适配器自己处理「软失败」，不抛错给 mount3D
describe("loadingEl 语义契约", () => {
  it("voxelCall 抛错 → buildLitematicScene 必须抛错（不能吞掉返回空壳）", async () => {
    const voxelCall = vi.fn().mockRejectedValue(new Error("RPC timeout"));
    const ctx = makeCtx();
    await expect(buildLitematicScene(ctx, "/broken.nbt", voxelCall)).rejects.toThrow("RPC timeout");
  });

  it("voxelCall 抛错 → loadingEl 必须保留（showLoadFailure 的渲染载体）", async () => {
    const voxelCall = vi.fn().mockRejectedValue(new Error("RPC timeout"));
    const ctx = makeCtx();
    document.body.appendChild(ctx.loadingEl);
    // 显式断言抛错（rejects），不用 try/catch——bare catch 会吞掉 expect.fail 的
    // AssertionError，适配器「吞错返回空壳」的回归会让本测试假绿
    await expect(buildLitematicScene(ctx, "/broken.nbt", voxelCall)).rejects.toThrow("RPC timeout");
    // loadingEl 不应被 remove（parentNode 仍在）
    expect(ctx.loadingEl.parentNode).not.toBeNull();
    document.body.removeChild(ctx.loadingEl);
  });

  it("成功 → loadingEl 必须被 remove（适配器自行清理）", async () => {
    const voxelCall = vi.fn().mockResolvedValue(VALID_JSON);
    const ctx = makeCtx();
    document.body.appendChild(ctx.loadingEl);
    const preview = await buildLitematicScene(ctx, "/valid.litematic", voxelCall);
    expect(ctx.loadingEl.parentNode).toBeNull();
    preview.dispose();
  });

  it("voxelCall 返回 null → loadingEl 必须保留并显示空态提示", async () => {
    const voxelCall = vi.fn().mockResolvedValue(null);
    const ctx = makeCtx();
    document.body.appendChild(ctx.loadingEl);
    const result = await buildLitematicScene(ctx, "/null.nbt", voxelCall);
    expect(ctx.loadingEl.parentNode).not.toBeNull();
    expect(ctx.loadingEl.textContent).toContain("⚠️");
    result.dispose();
    document.body.removeChild(ctx.loadingEl);
  });
});
