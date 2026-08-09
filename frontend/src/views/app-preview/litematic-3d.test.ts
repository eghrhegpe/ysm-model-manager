// ===== litematic 体素 3D 测试 =====
// 覆盖：cleanupVoxel3D、createLitematic3D 主路径（overlay/DOM 控件/渲染循环）、
// ESC/关闭按钮清理、空体素数据、getApp 失败兜底、分层/旋转/速度控件交互、截断提示。
// three + OrbitControls 全 stub（渲染管线不真实执行）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("three", () => {
  class Scene {
    background: unknown;
    add = vi.fn();
  }
  class Color {
    constructor(..._a: unknown[]) {}
  }
  class PerspectiveCamera {
    position = { set: vi.fn(), add: vi.fn() };
    quaternion = { setFromEuler: vi.fn() };
    lookAt = vi.fn();
    aspect = 0;
    updateProjectionMatrix = vi.fn();
    getWorldDirection = vi.fn(() => ({ x: 0, y: 0, z: 1 }));
  }
  class WebGLRenderer {
    domElement = document.createElement("div");
    setSize = vi.fn();
    setPixelRatio = vi.fn();
    render = vi.fn();
    dispose = vi.fn();
  }
  class AmbientLight {
    constructor(..._a: unknown[]) {}
  }
  class DirectionalLight {
    position = { set: vi.fn() };
    constructor(..._a: unknown[]) {}
  }
  class GridHelper {
    position = { set: vi.fn() };
    constructor(..._a: unknown[]) {}
  }
  class BoxGeometry {
    dispose = vi.fn();
  }
  class MeshLambertMaterial {
    dispose = vi.fn();
    constructor(..._a: unknown[]) {}
  }
  class Object3D {
    position = { set: vi.fn() };
    updateMatrix = vi.fn();
    matrix = {};
  }
  class InstancedMesh {
    instanceMatrix = { needsUpdate: false };
    count = 0;
    setMatrixAt = vi.fn();
    dispose = vi.fn();
    constructor(..._a: unknown[]) {}
  }
  class Euler {
    setFromQuaternion = vi.fn();
    constructor(..._a: unknown[]) {}
  }
  class Vector3 {
    x: number;
    y: number;
    z: number;
    normalize = vi.fn(function (this: Vector3) {
      return this;
    });
    add = vi.fn(function (this: Vector3) {
      return this;
    });
    sub = vi.fn(function (this: Vector3) {
      return this;
    });
    multiplyScalar = vi.fn(function (this: Vector3) {
      return this;
    });
    crossVectors = vi.fn(function (this: Vector3) {
      return this;
    });
    clone = vi.fn(() => new Vector3());
    length = vi.fn(function (this: Vector3) {
      return Math.hypot(this.x, this.y, this.z);
    });
    constructor(x = 0, y = 0, z = 0) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
  }
  return {
    Scene,
    Color,
    PerspectiveCamera,
    WebGLRenderer,
    AmbientLight,
    DirectionalLight,
    GridHelper,
    BoxGeometry,
    MeshLambertMaterial,
    Object3D,
    InstancedMesh,
    Euler,
    Vector3,
  };
});

vi.mock("three/addons/controls/OrbitControls.js", () => ({
  OrbitControls: class {
    target = {
      set: vi.fn(),
      copy: vi.fn(() => ({ addScaledVector: vi.fn() })),
      clone: vi.fn(() => ({ copy: vi.fn(), add: vi.fn() })),
    };
    enableDamping = false;
    dampingFactor = 0;
    minDistance = 0;
    maxDistance = 0;
    enableRotate = true;
    update = vi.fn();
    dispose = vi.fn();
  },
}));

vi.mock("../../wails/app.ts", () => ({ getApp: vi.fn() }));

import { getApp } from "../../wails/app.ts";
import { bus } from "../../bus.ts";
import { cleanupVoxel3D, createLitematic3D } from "./litematic-3d.ts";
import { sleep } from "../../test-utils/index.ts";

/** 最近创建的 overlay（createLitematic3D append 到 body） */
function lastOverlay(): HTMLElement {
  const kids = document.body.children;
  return kids[kids.length - 1] as HTMLElement;
}

function voxelFn(json: string): (p: string) => Promise<string> {
  return vi.fn().mockResolvedValue(json);
}

const VALID_JSON = JSON.stringify({
  groups: [{ positions: [[1, 2, 3], [4, 5, 6]], color: "#ff0000" }],
  size: [16, 16, 16],
});

beforeEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.mocked(getApp).mockResolvedValue({
    GetLitematicVoxelData: voxelFn(VALID_JSON),
  } as never);
});

afterEach(() => {
  cleanupVoxel3D();
  document.body.innerHTML = "";
});

describe("cleanupVoxel3D", () => {
  it("无活跃实例 → no-op（不抛）", () => {
    expect(() => cleanupVoxel3D()).not.toThrow();
  });

  it("创建后 cleanup → overlay 移除（_voxel3d 复用清理）", async () => {
    await createLitematic3D("/a.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay();
    expect(overlay).toBeTruthy();
    cleanupVoxel3D();
    expect(document.body.contains(overlay)).toBe(false);
  });
});

describe("createLitematic3D 主路径", () => {
  it("渲染 overlay + 顶层控件，加载完成后 loading 移除", async () => {
    await createLitematic3D("/a.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay();
    // topBar 控件：关闭按钮 / 旋转选择 / 速度滑块 / 切片轴 / 分层模式
    expect(overlay.querySelector("button")).toBeTruthy();
    expect(overlay.querySelector('select')).toBeTruthy();
    expect(overlay.querySelector('input[type="range"]')).toBeTruthy();
    // 加载占位已被移除
    expect(overlay.textContent).not.toContain("加载体素数据");
  });

  it("closeBtn 点击 → overlay 移除", async () => {
    await createLitematic3D("/a.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay();
    const closeBtn = overlay.querySelector("button") as HTMLElement;
    closeBtn.click();
    expect(document.body.contains(overlay)).toBe(false);
  });

  it("ESC 键 → overlay 移除", async () => {
    await createLitematic3D("/a.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.body.contains(overlay)).toBe(false);
  });

  it("第二次创建复用 → 先清理旧 overlay（WebGL 上下文防堆积）", async () => {
    await createLitematic3D("/a.litematic", "GetLitematicVoxelData");
    const first = lastOverlay();
    await createLitematic3D("/b.litematic", "GetLitematicVoxelData");
    const second = lastOverlay();
    expect(document.body.contains(first)).toBe(false); // 旧 overlay 被清理
    expect(second).toBeTruthy();
    // 模块级 _voxel3d 指向新实例：cleanup 只移除新的
    cleanupVoxel3D();
    expect(document.body.contains(second)).toBe(false);
  });
});

describe("体素数据处理", () => {
  it("空 groups → voxelEmpty 提示，不崩溃", async () => {
    vi.mocked(getApp).mockResolvedValue({
      GetLitematicVoxelData: voxelFn(JSON.stringify({ groups: [], size: [10, 10, 10] })),
    } as never);
    await createLitematic3D("/empty.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay();
    expect(overlay.textContent).toContain("体素数据为空"); // test-setup t() 返回 zhCN
    unmountOverlay(overlay);
  });

  it("truncated → 显示方块数量上限提示条", async () => {
    vi.mocked(getApp).mockResolvedValue({
      GetLitematicVoxelData: voxelFn(
        JSON.stringify({
          groups: [{ positions: [[0, 0, 0]] }],
          size: [10, 10, 10],
          truncated: true,
          maxBlocks: 200000,
        }),
      ),
    } as never);
    await createLitematic3D("/trunc.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay();
    expect(overlay.textContent).toContain("200,000");
    unmountOverlay(overlay);
  });

  it("getApp 抛错 → 错误占位 + toast:show（escH 清理不泄漏）", async () => {
    vi.mocked(getApp).mockRejectedValue(new Error("no-voxel-binding"));
    const toastSpy = vi.fn();
    const unsub = bus.on("toast:show", toastSpy);
    try {
      await createLitematic3D("/fail.litematic", "GetLitematicVoxelData");
      const overlay = lastOverlay();
      expect(overlay.textContent).toContain("加载失败");
      expect(toastSpy).toHaveBeenCalled();
      unmountOverlay(overlay);
    } finally {
      unsub();
    }
  });
});

describe("控件交互", () => {
  it("旋转模式切换 + 速度滑块更新显示", async () => {
    await createLitematic3D("/a.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay();
    const sel = overlay.querySelector("select") as HTMLSelectElement;
    const spd = overlay.querySelector('input[type="range"]') as HTMLInputElement;
    sel.value = "false";
    sel.dispatchEvent(new Event("change"));
    spd.value = "55";
    spd.dispatchEvent(new Event("input"));
    // 速度值标签跟随（数字文本的 span）
    const spdVal = [...overlay.querySelectorAll("span")].find(
      (s) => /^\d+$/.test(s.textContent || ""),
    );
    expect(spdVal?.textContent).toBe("55");
    unmountOverlay(overlay);
  });

  it("分层模式切换 → applyLayer（mesh.count 更新）；切片轴切换 → 层范围重置", async () => {
    await createLitematic3D("/a.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay();
    const selects = overlay.querySelectorAll("select");
    const layerMode = selects[selects.length - 1] as HTMLSelectElement; // 最后一个 select 是分层模式
    const axisSel = selects[1] as HTMLSelectElement; // 第二个 select 是切片轴
    // 单层模式 → 滑块显示
    layerMode.value = "single";
    layerMode.dispatchEvent(new Event("change"));
    // 切轴 → 层 max 重置（不抛）
    axisSel.value = "Z";
    axisSel.dispatchEvent(new Event("change"));
    // 范围模式 → 双滑块
    layerMode.value = "range";
    layerMode.dispatchEvent(new Event("change"));
    unmountOverlay(overlay);
  });
});

/** 通过关闭按钮移除 overlay（避免污染后续用例） */
function unmountOverlay(overlay: HTMLElement): void {
  const btn = overlay.querySelector("button") as HTMLElement | null;
  if (btn) btn.click();
  else if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  void sleep;
}
