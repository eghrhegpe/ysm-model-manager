// ===== 下载任务构建 + 大小策略纯函数测试（ADR-023 L3）=====
import { describe, it, expect } from "vitest";
import {
  DOWNLOAD_CONFIRM_BYTES,
  DOWNLOAD_REJECT_BYTES,
  classifyDownloadSize,
  buildDownloadTasks,
} from "./download-tasks.ts";

describe("classifyDownloadSize", () => {
  it("小文件（≤4MB）直接下载", () => {
    expect(classifyDownloadSize(0)).toBe("ok");
    expect(classifyDownloadSize(DOWNLOAD_CONFIRM_BYTES)).toBe("ok");
  });

  it("4–10MB 需确认", () => {
    expect(classifyDownloadSize(DOWNLOAD_CONFIRM_BYTES + 1)).toBe("confirm");
    expect(classifyDownloadSize(DOWNLOAD_REJECT_BYTES)).toBe("confirm");
  });

  it(">10MB 拒绝", () => {
    expect(classifyDownloadSize(DOWNLOAD_REJECT_BYTES + 1)).toBe("reject");
  });

  it("阈值常量与文案口径一致（4MB / 10MB）", () => {
    expect(DOWNLOAD_CONFIRM_BYTES).toBe(4 * 1024 * 1024);
    expect(DOWNLOAD_REJECT_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe("buildDownloadTasks", () => {
  const models = [
    { name: "a.ysm", path: "mods\\a.ysm", size: 1024 },
    { name: "b.ysm", path: "mods/b.ysm" },
  ];

  it("按选中集构建任务，路径统一转正斜杠", () => {
    const tasks = buildDownloadTasks(models, ["a.ysm", "b.ysm"], "https://dl/");
    expect(tasks).toEqual([
      { url: "https://dl/mods/a.ysm", saveDir: "", name: "a.ysm", size: 1024 },
      { url: "https://dl/mods/b.ysm", saveDir: "", name: "b.ysm", size: 0 },
    ]);
  });

  it("未匹配到模型的选中项静默跳过", () => {
    const tasks = buildDownloadTasks(models, ["a.ysm", "ghost.ysm"], "https://dl/");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].name).toBe("a.ysm");
  });

  it("空选中集返回空数组", () => {
    expect(buildDownloadTasks(models, [], "https://dl/")).toEqual([]);
  });
});
