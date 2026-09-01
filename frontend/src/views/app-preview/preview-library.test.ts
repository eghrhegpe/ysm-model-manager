// ===== preview-library 测试：_openers 注册表一致性 =====
// 审核 P3：验证所有 preview="3d" 的资源类型要么有 3D opener，要么在显式豁免列表中。
// 各 createXxx3D 包装器在模块加载时 registerReRoute，测试通过 import 触发注册。
//
// ADR-111 更新：opener 现在使用 variants preview keys（如 "mmd", "vrm", "mmd-scene"）
// 而不是资源类型 ID。测试需要理解 variants 路由机制。

import { describe, it, expect, vi } from "vitest";
import { ALL_RESOURCE_TYPES, NO_3D_TYPES, RESOURCE_TYPE_LABELS } from "../../utils/resource/types.ts";
import { getRegisteredRoutes, scanModelsByType } from "./preview-library.ts";
import resourceTypesJson from "#root/resource_types.json";

// 阻断 Wails runtime 加载链（scanModelsByType 内部 getApp()）——mock 提供绑定
const { getAppMock } = vi.hoisted(() => ({ getAppMock: vi.fn() }));
vi.mock("../../backend/app.ts", () => ({ getApp: getAppMock }));

// 触发注册（import 即有 side effect：模块加载时调用 registerReRoute）
import "./ysm-3d.ts";
import "./mmd-3d.ts";
import "./vrm-3d.ts";
import "./pack-3d.ts";
import "./litematic-3d.ts"; // 投影/蓝图已注册 opener
import "./scene-3d.ts"; // 场景模型已注册 opener (mmd-scene)
import "./maid-3d.ts"; // 车万女仆已注册 opener (maid-model)
import "./fbx-3d.ts"; // FBX 已注册 opener (fbx)

// 从 resource_types.json 提取所有 variants preview keys
const allPreviewKeys = new Set<string>();
for (const rt of resourceTypesJson.resourceTypes) {
  if (rt.variants) {
    for (const v of rt.variants) {
      allPreviewKeys.add(v.preview);
    }
  }
}

describe("preview-library _openers 注册表一致性", () => {
  it("所有 preview='3d' 的类型要么有 3D opener，要么在 NO_3D_TYPES 豁免列表中", () => {
    const registered = new Set(getRegisteredRoutes());
    // 派生：preview 字段 !== "3d" 的类型即为需豁免的集合（单一事实来源）
    const need3d = new Set(ALL_RESOURCE_TYPES.filter((id) => !NO_3D_TYPES.has(id)));
    const missing: string[] = [];

    for (const rtype of need3d) {
      // ADR-111：检查类型本身或其 variants preview keys 是否有 opener
      const rt = resourceTypesJson.resourceTypes.find((t: any) => t.id === rtype);
      const hasVariants = rt?.variants && rt.variants.length > 0;

      if (hasVariants) {
        // 有 variants：检查所有 preview keys 是否都有 opener
        const previewKeys = rt.variants.map((v: any) => v.preview);
        const allCovered = previewKeys.every((key: string) => registered.has(key));
        if (!allCovered) {
          missing.push(rtype);
        }
      } else {
        // 无 variants：检查类型 ID 本身是否有 opener
        if (!registered.has(rtype)) {
          missing.push(rtype);
        }
      }
    }

    expect(missing, `preview=3d 但缺少 3D opener 的类型: ${missing.join(", ")}`).toEqual([]);
  });

  it("已注册的 opener 类型全部在已知资源类型列表或 variants preview keys 中", () => {
    const known = new Set(ALL_RESOURCE_TYPES);
    const registered = getRegisteredRoutes();
    // ADR-111：opener 现在使用 variants preview keys，需要同时检查资源类型 ID 和 preview keys
    const unknown = registered.filter((t) => !known.has(t) && !allPreviewKeys.has(t));

    expect(unknown, `已注册但不在已知类型列表或 preview keys 中的类型: ${unknown.join(", ")}`).toEqual([]);
  });

  it("preview=none 的类型不应注册 3D opener", () => {
    const registered = new Set(getRegisteredRoutes());
    // mmd-shader 是 preview=none 的唯一类型，绝对不应有 3D opener
    const absolutelyNo3d = ALL_RESOURCE_TYPES.filter(
      (id) => NO_3D_TYPES.has(id) && id !== "resourcepack" && id !== "shaderpack",
    );
    const overlap = absolutelyNo3d.filter((t) => registered.has(t));

    expect(overlap, `preview=none 但注册了 3D opener 的类型: ${overlap.join(", ")}`).toEqual([]);
  });
});

describe("scanModelsByType — 预览键反解后到达 Go 绑定（批次6 P3）", () => {
  function mockBindings() {
    const mocks = {
      GetRepoRoot: vi.fn().mockResolvedValue("/repo"),
      ScanModelEntriesFiltered: vi.fn().mockResolvedValue([
        { Path: "/repo/a.pmx" },
        { Path: "/repo/b.pmx" },
      ]),
    };
    getAppMock.mockResolvedValue(mocks);
    return mocks;
  }

  it("mmd 预览键 → 反解为 EntityPlayer 再调用 GetRepoRoot/ScanModelEntriesFiltered", async () => {
    const { GetRepoRoot, ScanModelEntriesFiltered } = mockBindings();
    const paths = await scanModelsByType("mmd");
    // 反解后的真实 rtype 到达 Go 绑定（扩展名白名单过滤的关键——不反解会查空仓库）
    expect(GetRepoRoot).toHaveBeenCalledWith("EntityPlayer");
    expect(ScanModelEntriesFiltered).toHaveBeenCalledWith("/repo", "EntityPlayer", "", "角色模型");
    expect(paths).toEqual(["/repo/a.pmx", "/repo/b.pmx"]);
  });

  it("已是真实 rtype 的键（fbx）原样透传，不误反解", async () => {
    const { GetRepoRoot, ScanModelEntriesFiltered } = mockBindings();
    await scanModelsByType("fbx");
    expect(GetRepoRoot).toHaveBeenCalledWith("fbx");
    // label 取 RESOURCE_TYPE_LABELS["fbx"] 的真实值（注册表驱动，勿硬编码简写）
    expect(ScanModelEntriesFiltered).toHaveBeenCalledWith(
      "/repo",
      "fbx",
      "",
      RESOURCE_TYPE_LABELS["fbx"] || "fbx",
    );
  });

  it("根目录为空 → 提前返回空列表，不调扫描", async () => {
    const { GetRepoRoot, ScanModelEntriesFiltered } = mockBindings();
    GetRepoRoot.mockResolvedValue("");
    const paths = await scanModelsByType("mmd");
    expect(paths).toEqual([]);
    expect(ScanModelEntriesFiltered).not.toHaveBeenCalled();
  });

  it("绑定抛错 → 静默返回空列表（不抛给 3D 预览）", async () => {
    getAppMock.mockResolvedValue({
      GetRepoRoot: vi.fn().mockRejectedValue(new Error("boom")),
      ScanModelEntriesFiltered: vi.fn(),
    });
    const paths = await scanModelsByType("mmd");
    expect(paths).toEqual([]);
  });
});
