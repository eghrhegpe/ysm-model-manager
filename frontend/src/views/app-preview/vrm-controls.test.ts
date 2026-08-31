// ===== vrm-controls 菜单面板测试（[doc:adr-126-p4-b-1] P5 收尾：VRM model/shot 声明式化）=====
// 覆盖：vrmModelInfoNodes（模型信息字段输出）、vrmShotNodes（current-only 截图按钮——
// VRM 无离屏重建，非 current 角度 no-op 不注入，a400b244 review P2）。

import { describe, it, expect, vi } from "vitest";
import { vrmModelInfoNodes, vrmShotNodes } from "./vrm-controls.ts";
import type { PreviewActionMenuCtx } from "../../features/preview-3d/menu/node-types.ts";

// 截图链路（Wails 绑定 SaveScreenshotFile）在 node 测试环境不可用——
// mock saveScreenshot 隔离副作用，只验证 vrmShotNodes 的 action 触发截图调用
vi.mock("./skeleton-render.ts", () => ({
  saveScreenshot: vi.fn().mockResolvedValue(undefined),
}));
import { saveScreenshot as saveScreenshotMock } from "./skeleton-render.ts";

describe("vrmModelInfoNodes（模型信息声明式节点）", () => {
  it("输出名称 + 概览 field，值与 ctx 一致", () => {
    const nodes = vrmModelInfoNodes({ modelName: "test", boneCount: 52, materialCount: 3 });
    expect(nodes.map((n) => n.id)).toEqual(["vrm-model-name", "vrm-model-overview"]);
    expect(nodes.every((n) => n.kind === "field")).toBe(true);
    expect(nodes[0]).toMatchObject({ labelKey: "preview.nameLabel", value: "test" });
    expect(nodes[1].value).toBe("52 骨骼 3 材质");
  });
});

describe("vrmShotNodes（current-only 截图按钮）", () => {
  it("screenshot null（无渲染器）→ 不注入按钮", () => {
    expect(vrmShotNodes(null, "/m/a.vrm")).toEqual([]);
  });

  it("只产出 current 按钮（VRM 无离屏重建，其余角度 no-op 不注入）", () => {
    const nodes = vrmShotNodes(() => Promise.resolve("b64"), "/m/a.vrm");
    expect(nodes.map((n) => n.id)).toEqual(["vrm-shot-current"]);
    expect(nodes[0].kind).toBe("button");
    expect(nodes[0].icon).toBe("📷");
    expect(nodes[0].legacyTestId).toBe("shot-current");
  });

  it("action 触发 saveScreenshot：_modelPath 透传 + screenshotFn 第四参", () => {
    const shotFn = () => Promise.resolve("b64");
    const nodes = vrmShotNodes(shotFn, "/m/a.vrm");
    nodes[0].action!({} as unknown as PreviewActionMenuCtx); // action 签名吃 PreviewActionMenuCtx（本测试不消费）
    expect(saveScreenshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ _modelPath: "/m/a.vrm" }),
      "current",
      expect.any(Function),
      shotFn,
    );
  });
});
