// ===== vrm-controls 菜单面板测试（[doc:adr-126-p4-b-1] P5 收尾：VRM model/shot 声明式化）=====
// 覆盖：vrmModelInfoNodes（模型信息字段输出）、vrmShotNodes（current-only 截图按钮——
// VRM 无离屏重建，非 current 角度 no-op 不注入，a400b244 review P2）。

import { describe, it, expect, vi } from "vitest";
import { vrmModelInfoNodes, vrmShotNodes } from "./vrm-controls.ts";
import { findNodeById, nodeIds } from "@/preview-3d/menu/menu-test-helpers.ts";
import type { PreviewActionMenuCtx } from "@/preview-3d/menu/schema/node-types.ts";

// 截图链路（Wails 绑定 SaveScreenshotFile）在 node 测试环境不可用——
// mock saveScreenshot 隔离副作用，只验证 vrmShotNodes 的 action 触发截图调用
vi.mock("./skeleton-render.ts", () => ({
  saveScreenshot: vi.fn().mockResolvedValue(undefined),
}));
import { saveScreenshot as saveScreenshotMock } from "./skeleton-render.ts";

describe("vrmModelInfoNodes（模型信息声明式节点）", () => {
  it("输出名称 + 概览 field，值与 ctx 一致", () => {
    const nodes = vrmModelInfoNodes({ modelName: "test", boneCount: 52, materialCount: 3 });
    // 基础 2 行成员（精确集合，不测顺序）
    expect(nodeIds(nodes).sort()).toEqual(["vrm-model-name", "vrm-model-overview"].sort());
    expect(nodes.every((n) => n.kind === "field")).toBe(true);
    const nameNode = findNodeById(nodes, "vrm-model-name");
    expect(nameNode).toMatchObject({ labelKey: "preview.nameLabel", value: "test" });
    const overviewNode = findNodeById(nodes, "vrm-model-overview");
    expect(overviewNode.value).toBe("52 骨骼 3 材质");
  });

  it("meta 缺失 → 保持基础 2 行 field", () => {
    const nodes = vrmModelInfoNodes({ modelName: "test", boneCount: 52, materialCount: 3 });
    // 成员集合（行数 = 集合大小自然保证）
    expect(nodeIds(nodes).sort()).toEqual(["vrm-model-name", "vrm-model-overview"].sort());
  });

  it("meta 齐全：title≠文件名补内嵌名行 + 作者/授权/版本行", () => {
    const nodes = vrmModelInfoNodes({
      modelName: "test",
      boneCount: 52,
      materialCount: 3,
      meta: { title: "内嵌名", author: "作者A", license: "CC0", version: "1.0" },
    });
    // 6 行成员（精确集合，不测顺序）
    expect(nodeIds(nodes).sort()).toEqual(
      [
        "vrm-model-name",
        "vrm-model-overview",
        "vrm-model-title",
        "vrm-model-author",
        "vrm-model-license",
        "vrm-model-version",
      ].sort(),
    );
    expect(findNodeById(nodes, "vrm-model-title")).toMatchObject({ labelKey: "preview.modelEmbeddedName", value: "内嵌名" });
    expect(findNodeById(nodes, "vrm-model-author")).toMatchObject({ labelKey: "preview.authorLabel", value: "作者A" });
    expect(findNodeById(nodes, "vrm-model-license")).toMatchObject({ labelKey: "preview.modelLicense", value: "CC0" });
    expect(findNodeById(nodes, "vrm-model-version")).toMatchObject({ labelKey: "preview.versionLabel", value: "1.0" });
  });

  it("title 与文件名一致 → 不补内嵌名行（避免重复）；meta 字段空 → 对应行不产", () => {
    const nodes = vrmModelInfoNodes({
      modelName: "test",
      boneCount: 52,
      materialCount: 3,
      meta: { title: "test", author: "", license: "", version: "" },
    });
    expect(nodeIds(nodes).sort()).toEqual(["vrm-model-name", "vrm-model-overview"].sort());
  });
});

describe("vrmShotNodes（current-only 截图按钮）", () => {
  it("screenshot null（无渲染器）→ 不注入按钮", () => {
    expect(vrmShotNodes(null, "/m/a.vrm")).toEqual([]);
  });

  it("只产出 current 按钮（VRM 无离屏重建，其余角度 no-op 不注入）", () => {
    const nodes = vrmShotNodes(() => Promise.resolve("b64"), "/m/a.vrm");
    // 仅 1 成员（精确集合）
    expect(nodeIds(nodes).sort()).toEqual(["vrm-shot-current"].sort());
    const btn = findNodeById(nodes, "vrm-shot-current");
    expect(btn.kind).toBe("button");
    expect(btn.icon).toBe("camera");
  });

  it("action 触发 saveScreenshot：_modelPath 透传 + screenshotFn 第四参", () => {
    const shotFn = () => Promise.resolve("b64");
    const nodes = vrmShotNodes(shotFn, "/m/a.vrm");
    const btn = findNodeById(nodes, "vrm-shot-current");
    btn.action!({} as unknown as PreviewActionMenuCtx); // action 签名吃 PreviewActionMenuCtx（本测试不消费）
    expect(saveScreenshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ _modelPath: "/m/a.vrm" }),
      "current",
      expect.any(Function),
      shotFn,
    );
  });
});
