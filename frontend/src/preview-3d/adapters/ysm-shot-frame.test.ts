// @vitest-environment node
// ===== ysm-shot-frame 适配器编排契约测试 =====
// renderModelShotFrame = YSM 离屏多角度截图编排（ADR-270-d6）：取预览灯光
// → buildYsmShotRenderArgs 组装实参 → renderMultiAngle 离屏渲染 → 按视角 key 匹配
// name 取 base64。视图测试（skeleton-render.test）走自己的 inline saveScreenshot 路径，
// 从不触碰本适配器——「key 匹配 / null 兜底」这段编排零覆盖。本测试 mock 三个依赖
// 模块，把编排契约钉死：实参接力正确、key 命中取 base64、未命中/失败回 null。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderModelShotFrame } from "./ysm-shot-frame.ts";
import type { YsmShotModel } from "./ysm-preview-pipeline.ts";

const mocks = vi.hoisted(() => ({
  toScreenshotLights: vi.fn(),
  buildYsmShotRenderArgs: vi.fn(),
  renderMultiAngle: vi.fn(),
}));

vi.mock("@/preview-3d/screenshot/screenshot-lights.ts", () => ({
  toScreenshotLights: mocks.toScreenshotLights,
}));
vi.mock("./ysm-preview-pipeline.ts", () => ({
  buildYsmShotRenderArgs: mocks.buildYsmShotRenderArgs,
}));
vi.mock("@/preview-3d/screenshot/screenshot-render.ts", () => ({
  renderMultiAngle: mocks.renderMultiAngle,
}));

const model: YsmShotModel = {
  texture: "t0",
  _modelPath: "/repo/m.ysm",
};

const lights = { output: { toneMapping: 1, exposure: 1, outputColorSpace: "srgb" } } as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.toScreenshotLights.mockReturnValue(lights);
  mocks.buildYsmShotRenderArgs.mockReturnValue({ texUrls: ["t0"], options: {} });
});

describe("renderModelShotFrame — 编排契约", () => {
  it("命中视角 key：返回该帧 base64（find by name 匹配）", async () => {
    mocks.renderMultiAngle.mockResolvedValue([
      { name: "front", base64: "b64-front" },
      { name: "45", base64: "b64-45" },
    ]);
    await expect(renderModelShotFrame(model, "45")).resolves.toBe("b64-45");
    await expect(renderModelShotFrame(model, "front")).resolves.toBe("b64-front");
  });

  it("视角 key 未命中（渲染器改名/缺帧）→ null（不取错帧）", async () => {
    mocks.renderMultiAngle.mockResolvedValue([{ name: "side", base64: "b64-side" }]);
    await expect(renderModelShotFrame(model, "back45")).resolves.toBeNull();
  });

  it("renderMultiAngle 返回 null（渲染失败）→ null", async () => {
    mocks.renderMultiAngle.mockResolvedValue(null);
    await expect(renderModelShotFrame(model, "front")).resolves.toBeNull();
  });

  it("实参接力：size=512 + 预览灯光进组装；组装的 texUrls/options 原样进离屏渲染", async () => {
    const texUrls = ["t0", "t1"];
    const options = { size: 512, lights, decodeYsm: expect.any(Function) } as never;
    mocks.buildYsmShotRenderArgs.mockReturnValue({ texUrls, options });
    mocks.renderMultiAngle.mockResolvedValue([{ name: "front", base64: "x" }]);
    await renderModelShotFrame(model, "front");
    expect(mocks.toScreenshotLights).toHaveBeenCalledTimes(1);
    expect(mocks.buildYsmShotRenderArgs).toHaveBeenCalledWith(model, { size: 512, lights });
    expect(mocks.renderMultiAngle).toHaveBeenCalledWith("/repo/m.ysm", texUrls, options);
  });

  it("预览灯光缺失（null）→ 组装不带 lights（底座回退标准灯语义）", async () => {
    mocks.toScreenshotLights.mockReturnValue(null);
    mocks.renderMultiAngle.mockResolvedValue(null);
    await renderModelShotFrame(model, "front");
    expect(mocks.buildYsmShotRenderArgs).toHaveBeenCalledWith(model, { size: 512 });
  });
});