// ===== 创作者头像提取测试（workshop-avatar.ts）=====
// 覆盖：非空结果整表替换 / 空表 + 仓库根未配置 → 保留缓存（守卫用意）/
//       空表 + 仓库根已配置 → 清空（锐评修复 2026-10-14，防陈旧头像不自愈）/ 绑定抛错降级
// 用**真 store**（不 mock creator-avatar-store）——本测试的价值正在于验证
// 「调用方的权威空表判定」与「store 空表守卫」的接合，mock 掉就测不出接合点。
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    BatchExtractCreatorAvatars: vi.fn(),
    GetRepoRoot: vi.fn(),
  },
}));

vi.mock("@/views/backend-deps.ts", () => ({
  backendGetApp: vi.fn().mockResolvedValue({
    BatchExtractCreatorAvatars: mocks.BatchExtractCreatorAvatars,
    GetRepoRoot: mocks.GetRepoRoot,
  }),
}));
vi.mock("@/utils/debug/debug.ts", () => ({ dbg: vi.fn() }));

import { clearAvatars, getAvatar } from "@/features/community/creator-avatar-store.ts";
import { extractAvatars } from "./workshop-avatar.ts";

beforeEach(() => {
  vi.clearAllMocks();
  clearAvatars();
  mocks.GetRepoRoot.mockResolvedValue("/repo");
  mocks.BatchExtractCreatorAvatars.mockResolvedValue({});
});

describe("extractAvatars", () => {
  it("非空结果 → 整表写入 store", async () => {
    mocks.BatchExtractCreatorAvatars.mockResolvedValue({ alice: "data:image/png;base64,AAA" });
    await extractAvatars();
    expect(getAvatar("alice")).toBe("data:image/png;base64,AAA");
  });

  // 锐评修复（2026-10-14）核心用例：Go 侧 BatchExtractCreatorAvatars 在
  // `ysmRoot()==""`（仓库根未配置）与「确实没有头像」两种情况下**都返回空表**，
  // 只有前端能区分。此处锁「未配置 → 不得清」——这是 setAvatars 守卫存在的理由。
  it("空表 + 仓库根未配置 → 保留既有头像（不抹掉下载累积的增量）", async () => {
    // 先用增量写模拟「下载完成经 avatar:refresh 灌进来的头像」
    mocks.BatchExtractCreatorAvatars.mockResolvedValue({ alice: "data:image/png;base64,AAA" });
    await extractAvatars();
    expect(getAvatar("alice")).toBe("data:image/png;base64,AAA");

    // 仓库根未配置（如切库瞬间）+ 空表 → 必须保留
    mocks.GetRepoRoot.mockResolvedValue("");
    mocks.BatchExtractCreatorAvatars.mockResolvedValue({});
    await extractAvatars();
    expect(getAvatar("alice")).toBe("data:image/png;base64,AAA");
  });

  // 同一处的另一半：仓库根**已配置**时空表就是权威结论，必须清——否则用户把某创作者
  // 的全部模型删掉后，其陈旧头像在本应用会话内永不自愈（store 是内存态，生产无其他清理点）。
  it("空表 + 仓库根已配置 → 清空陈旧头像（自愈）", async () => {
    mocks.BatchExtractCreatorAvatars.mockResolvedValue({ alice: "data:image/png;base64,AAA" });
    await extractAvatars();
    expect(getAvatar("alice")).toBe("data:image/png;base64,AAA");

    // 用户删光 alice 的模型 → 提取结果为空，而仓库根仍配置着
    mocks.GetRepoRoot.mockResolvedValue("/repo");
    mocks.BatchExtractCreatorAvatars.mockResolvedValue({});
    await extractAvatars();
    expect(getAvatar("alice")).toBeUndefined();
  });

  it("GetRepoRoot 抛错 → 按「拿不到判据」保守处理，保留缓存", async () => {
    mocks.BatchExtractCreatorAvatars.mockResolvedValue({ alice: "data:image/png;base64,AAA" });
    await extractAvatars();

    mocks.BatchExtractCreatorAvatars.mockResolvedValue({});
    mocks.GetRepoRoot.mockRejectedValue(new Error("ipc down"));
    await extractAvatars();
    // 判据不可得时不得误清（.catch(() => "") 走「未配置」分支）
    expect(getAvatar("alice")).toBe("data:image/png;base64,AAA");
  });

  it("提取绑定抛错 → 降级不抛，store 不被改动", async () => {
    mocks.BatchExtractCreatorAvatars.mockResolvedValue({ alice: "data:image/png;base64,AAA" });
    await extractAvatars();

    mocks.BatchExtractCreatorAvatars.mockRejectedValue(new Error("scan boom"));
    await expect(extractAvatars()).resolves.toBeUndefined();
    expect(getAvatar("alice")).toBe("data:image/png;base64,AAA");
  });

  it("按 ysm 类型问仓库根（与 Go 侧 ysmRoot() 同参）", async () => {
    await extractAvatars();
    expect(mocks.GetRepoRoot).toHaveBeenCalledWith("ysm");
  });
});
