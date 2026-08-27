// @vitest-environment node
// ===== web-fs.ts 纯函数堆测试（补盲区）=====
// 覆盖导出的无 IO 纯函数：typeFromWebDir。
// idb 相关（parseWebModelPath / rekeyWebModelGroup）需集成环境，不在本文件。
// 未导出的内部函数（voxelErrorJson / webMoveTargetName / assertValidRenameName）
// 通过其调用者间接覆盖，不在此直接测。
import { describe, it, expect, vi } from "vitest";

// resource_types.json mock：typeFromWebDir 依赖
vi.mock("../utils/resource/resource-types.json", () => ({
  default: {
    resourceTypes: [
      { id: "ysm", instanceDir: "ysm-assets" },
      { id: "vrm", instanceDir: "vrm-models" },
    ],
  },
}));

// web-common mock：webDirType 是 typeFromWebDir 的核心
vi.mock("./web-common.ts", () => ({
  webDirType: (dir: string): string | undefined => {
    if (dir === "ysm-assets" || dir === "ysm") return "ysm";
    if (dir === "vrm-models" || dir === "vrm") return "vrm";
    return undefined;
  },
}));

// web-fs-shared mock：其余内部用导出
vi.mock("./web-fs-shared.ts", () => ({
  parseWebDirPath: () => null,
  INVALID_NAME_CHARS: /[<>:"/\\|?*]/,
  dirKey: (type: string, name: string) => `dir:${type}/${name}:`,
  fileKey: (type: string, name: string, rel: string) => `file:${type}/${name}/${rel}`,
}));

import { typeFromWebDir } from "./web-fs.ts";

describe("typeFromWebDir", () => {
  it("已知 ysm 目录 → 返回 ysm", () => {
    expect(typeFromWebDir("ysm-assets")).toBe("ysm");
  });

  it("已知 vrm 目录 → 返回 vrm", () => {
    expect(typeFromWebDir("vrm-models")).toBe("vrm");
  });

  it("未知目录 → 兜底 RESOURCE_TYPES.YSM", () => {
    expect(typeFromWebDir("unknown-dir")).toBe("ysm");
  });

  it("空字符串 → 兜底 ysm", () => {
    expect(typeFromWebDir("")).toBe("ysm");
  });
});
