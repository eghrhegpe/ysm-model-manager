// @vitest-environment node
// ===== 下载任务构建 + 大小策略纯函数测试（ADR-023 L3）=====
import { describe, it, expect } from "vitest";
import {
  DOWNLOAD_CONFIRM_BYTES,
  DOWNLOAD_REJECT_BYTES,
  classifyDownloadSize,
  buildDownloadTasks,
  buildModelDownloadUrl,
} from "./download-tasks.ts";

describe("buildModelDownloadUrl — 逐段编码（P3④ 收口：路径含 URL 保留字符不得截断）", () => {
  it("普通路径原样拼接（反斜杠转正斜杠）", () => {
    expect(buildModelDownloadUrl("https://dl/", "mods\\a.ysm")).toBe("https://dl/mods/a.ysm");
    expect(buildModelDownloadUrl("https://dl/", "mods/b.ysm")).toBe("https://dl/mods/b.ysm");
  });

  it("# ? % 逐段编码——不编码会落 fragment/query 或被当坏转义（原 P3 截断 bug）", () => {
    expect(buildModelDownloadUrl("https://dl/", "mods/a#1.ysm")).toBe("https://dl/mods/a%231.ysm");
    expect(buildModelDownloadUrl("https://dl/", "mods/a?b.ysm")).toBe("https://dl/mods/a%3Fb.ysm");
    expect(buildModelDownloadUrl("https://dl/", "mods/100%.ysm")).toBe("https://dl/mods/100%25.ysm");
  });

  it("空格与非 ASCII 编码（CJK 走浏览器也发同一字节，显式编码防中间环节再解析）", () => {
    expect(buildModelDownloadUrl("https://dl/", "my mods/a b.ysm")).toBe("https://dl/my%20mods/a%20b.ysm");
    expect(buildModelDownloadUrl("https://dl/", "角色/雾雨.ysm")).toBe(
      `https://dl/${encodeURIComponent("角色")}/${encodeURIComponent("雾雨.ysm")}`,
    );
  });

  it("分隔符 / 保留不编码（逐段处理，非整串 encodeURIComponent）", () => {
    expect(buildModelDownloadUrl("https://dl/", "a/b/c.ysm")).toBe("https://dl/a/b/c.ysm");
  });
});

describe("classifyDownloadSize", () => {
  it("小文件（≤4MB）直接下载", () => {
    expect(classifyDownloadSize(0)).toBe("ok");
    expect(classifyDownloadSize(DOWNLOAD_CONFIRM_BYTES)).toBe("ok");
    expect(classifyDownloadSize(-1)).toBe("ok"); // 有限负数落回 ok（P4 哨兵注释）
  });

  it("4–10MB 需确认", () => {
    expect(classifyDownloadSize(DOWNLOAD_CONFIRM_BYTES + 1)).toBe("confirm");
    expect(classifyDownloadSize(DOWNLOAD_REJECT_BYTES)).toBe("confirm");
  });

  it(">10MB 拒绝", () => {
    expect(classifyDownloadSize(DOWNLOAD_REJECT_BYTES + 1)).toBe("reject");
  });

  it("非有限数值（NaN/±Infinity）一律拒绝（P3 数值守卫范式）", () => {
    expect(classifyDownloadSize(NaN)).toBe("reject");
    expect(classifyDownloadSize(Infinity)).toBe("reject");
    expect(classifyDownloadSize(-Infinity)).toBe("reject");
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

  it("size 缺失/非法（NaN/-1）归一为 0（P4 守卫：-1 哨兵不当真值原样写入）", () => {
    const withIllegal = [
      { name: "c.ysm", path: "mods/c.ysm", size: -1 },
      { name: "d.ysm", path: "mods/d.ysm", size: Number.NaN },
    ];
    const tasks = buildDownloadTasks(withIllegal, ["c.ysm", "d.ysm"], "https://dl/");
    expect(tasks[0].size).toBe(0);
    expect(tasks[1].size).toBe(0);
  });
});
