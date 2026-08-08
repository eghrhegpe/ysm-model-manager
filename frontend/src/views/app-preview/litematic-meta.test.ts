// ===== showLitematic 测试 =====
// 覆盖：litematic/nbt/schematic 三种路径、解析失败、材料列表、3D tab、Tab 切换、代际守卫
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mocks } = vi.hoisted(() => {
  const mocks = {
    ReadLitematicMeta: vi.fn(),
    ReadNbtStructure: vi.fn(),
    ReadSchematic: vi.fn(),
    createLitematic3D: vi.fn(),
  };
  return { mocks };
});

vi.mock("../../wails/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    ReadLitematicMeta: mocks.ReadLitematicMeta,
    ReadNbtStructure: mocks.ReadNbtStructure,
    ReadSchematic: mocks.ReadSchematic,
  }),
}));

vi.mock("./litematic-3d.ts", () => ({
  createLitematic3D: mocks.createLitematic3D,
  cleanupVoxel3D: vi.fn(),
}));

import type { PreviewCtx } from "./utils.ts";
import { showLitematic, invalidateLitematicPreview } from "./litematic-meta.ts";

let root: ShadowRoot;
let ctx: PreviewCtx;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  root = document.createElement("div").attachShadow({ mode: "open" });
  ctx = {
    _root: root,
    _loadPreviewImage: vi.fn().mockResolvedValue(null),
    decodeYsmViaWasm: vi.fn(),
    _decodeYsmViaWasm: vi.fn(),
    _appendDebug: vi.fn(),
  };
  mocks.ReadLitematicMeta.mockResolvedValue(
    JSON.stringify({
      name: "建筑",
      author: "作者A",
      version: 6,
      minecraftDataVersion: 3700,
      description: "测试蓝图",
      timeCreated: Date.parse("2026-01-02T03:04:00Z"),
      totalBlocks: 1234,
      totalVolume: 5000,
      regionCount: 1,
      entityCount: 2,
      blockStats: [
        { name: "minecraft:stone", count: 100 },
        { name: "custom_block", count: 50 },
      ],
      enclosingSize: [16, 8, 4],
      previewImage: "data:image/png;base64,x",
    }),
  );
});

afterEach(() => {
  document.body.innerHTML = "";
});

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

describe("showLitematic", () => {
  it("litematic 路径 → 渲染详情 + 材料列表 + 预览图", async () => {
    await showLitematic(ctx, "/mc/a.litematic");
    await flush();

    expect(mocks.ReadLitematicMeta).toHaveBeenCalledWith("/mc/a.litematic");
    const detail = root.getElementById("preview-detail")!.innerHTML;
    expect(detail).toContain("建筑");
    expect(detail).toContain("作者A");
    expect(detail).toContain("1,234");
    expect(detail).toContain("16 × 8 × 4");
    expect(detail).toContain("Litematica v6");
    expect(detail).toContain("data:image/png");

    const material = root.getElementById("preview-material")!.innerHTML;
    expect(material).toContain("stone");
    expect(material).toContain("custom_block");
  });

  it("nbt 路径 → ReadNbtStructure；无 size/blockCount 报错", async () => {
    mocks.ReadNbtStructure.mockResolvedValue(
      JSON.stringify({ size: [1, 1, 1], blockCount: 1 }),
    );
    await showLitematic(ctx, "/mc/a.nbt");
    await flush();
    expect(mocks.ReadNbtStructure).toHaveBeenCalledWith("/mc/a.nbt");
    expect(root.getElementById("preview-detail")!.innerHTML).toContain("1");

    // 无 size/blockCount → 失败分支
    mocks.ReadNbtStructure.mockResolvedValue('{"foo":1}');
    await showLitematic(ctx, "/mc/b.nbt");
    await flush();
    expect(root.getElementById("preview-detail")!.innerHTML).toContain("读取失败");
  });

  it("schematic 路径 → ReadSchematic", async () => {
    mocks.ReadSchematic.mockResolvedValue(
      JSON.stringify({ size: [2, 2, 2], blockCount: 8 }),
    );
    await showLitematic(ctx, "/mc/c.schematic");
    await flush();
    expect(mocks.ReadSchematic).toHaveBeenCalledWith("/mc/c.schematic");
    expect(root.getElementById("preview-detail")!.innerHTML).toContain("8");
  });

  it("空材料 → 无方块数据占位", async () => {
    mocks.ReadLitematicMeta.mockResolvedValue(JSON.stringify({ name: "x", totalBlocks: 0 }));
    await showLitematic(ctx, "/mc/a.litematic");
    await flush();
    expect(root.getElementById("preview-material")!.innerHTML).toContain("无方块数据");
  });

  it("3D tab 按钮 → createLitematic3D（带对应 voxel 函数名）", async () => {
    mocks.createLitematic3D.mockResolvedValue(undefined);
    await showLitematic(ctx, "/mc/a.litematic");
    await flush();

    const btn = root.getElementById("btn-lt-3d-tab") as HTMLButtonElement;
    btn.click();
    await flush();
    await flush();
    expect(mocks.createLitematic3D).toHaveBeenCalledWith(
      "/mc/a.litematic",
      "GetLitematicVoxelData",
    );
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe("🎨 3D");
  });

  it("Tab 切换更新 localStorage 与显示状态", async () => {
    await showLitematic(ctx, "/mc/a.litematic");
    await flush();

    const materialBtn = root.querySelector('[data-tab="material"]') as HTMLElement;
    materialBtn.click();
    expect(localStorage.getItem("lt_previewTab")).toBe("material");
    expect(root.getElementById("preview-detail")!.style.display).toBe("none");
    expect(root.getElementById("preview-material")!.style.display).toBe("");
  });

  it("代际守卫：解析后代际已推进则不写 DOM", async () => {
    let resolveMeta: (v: string) => void = () => {};
    mocks.ReadLitematicMeta.mockImplementation(
      () => new Promise<string>((r) => { resolveMeta = r; }),
    );
    const p = showLitematic(ctx, "/mc/a.litematic");
    await flush(); // 让 getApp() resolve、ReadLitematicMeta 被调用并捕获 resolve 句柄
    invalidateLitematicPreview(); // 模拟切换其他模型
    resolveMeta(JSON.stringify({ name: "迟到", totalBlocks: 1 }));
    await p;
    await flush();

    // detail 仍为占位（未被迟到结果覆盖）
    expect(root.getElementById("preview-detail")!.innerHTML).not.toContain("迟到");
  });
});
