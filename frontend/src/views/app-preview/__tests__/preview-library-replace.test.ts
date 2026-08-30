// ===== preview-library 方案 A 契约测试 =====
// 锁定「cooperate=false 且有活跃会话时先清理旧活跃全屏层」语义（ADR-093 T4 注释从名义变实际）。
// 用部分 mock 隔离 mount-preview-core，不触发任何 createXxx3D 注册链，保持轻量。

import { describe, it, expect, vi, beforeEach } from "vitest";

// 部分 mock：保留原模块真实导出，仅覆盖 cleanupPreview / hasActivePreview / switchPreview 供断言
vi.mock("../../../features/preview-3d/adapters/mount-preview-core.ts", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return {
    ...mod,
    cleanupPreview: vi.fn(),
    hasActivePreview: vi.fn(() => true),
    switchPreview: vi.fn(),
  };
});

// 阻断 Wails runtime 加载链（openModel3DFullscreen 内部 getApp()）。
// 注意路径：vi.mock 相对【测试文件】解析，preview-library.ts 的
// `import { getApp } from "../../backend/app.ts"` 相对【preview-library.ts】
// （src/views/app-preview/）→ src/backend/app.ts；测试文件在 __tests__/ 子目录，
// 须再上一级 `../../../backend/app.ts` 才能命中同一模块（原 `../../` 解析到
// src/views/backend/ 不存在 → mock 静默失效，被旧版顶部无条件 cleanup 掩盖）。
const { getAppMock } = vi.hoisted(() => ({ getAppMock: vi.fn() }));
vi.mock("../../../backend/app.ts", () => ({ getApp: getAppMock }));

import { openModel3DFullscreen, registerReRoute } from "../preview-library.ts";
import { cleanupPreview, hasActivePreview, switchPreview } from "../../../features/preview-3d/adapters/mount-preview-core.ts";

beforeEach(() => {
  vi.clearAllMocks();
  (hasActivePreview as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
  getAppMock.mockResolvedValue({
    DetectResourceType: vi.fn().mockResolvedValue("litematic"),
  });
  // 注册一个最小 opener，让 openModel3DFullscreen 派发成功（不触发真实 mount）
  registerReRoute("litematic", () => Promise.resolve());
});

describe("方案 A：cooperate=false 二次点击清理旧层", () => {
  it("cooperate=false 且有活跃会话 → 调 cleanupPreview 清理旧活跃全屏层", async () => {
    await openModel3DFullscreen("/a.litematic");
    expect(cleanupPreview).toHaveBeenCalledTimes(1);
  });

  it("cooperate=false 且无活跃会话 → 不调 cleanupPreview（首开无需清理）", async () => {
    (hasActivePreview as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    await openModel3DFullscreen("/a.litematic");
    expect(cleanupPreview).not.toHaveBeenCalled();
  });

  it("cooperate=true 且有活跃会话 → 走 keepInScene 追加，不调 cleanupPreview", async () => {
    await openModel3DFullscreen("/b.litematic", { cooperate: true });
    expect(cleanupPreview).not.toHaveBeenCalled();
    // 必须验证 switchPreview 以 keepInScene 分发（否则 cooperate 分支被移除时测试仍绿，
    // keepInScene 追加语义未锁定——code review P3）
    expect(switchPreview).toHaveBeenCalledTimes(1);
    expect(switchPreview).toHaveBeenCalledWith("/b.litematic", { keepInScene: true });
  });
});
