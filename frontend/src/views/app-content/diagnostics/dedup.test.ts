// ===== 去重会话测试（dedup.ts 会话工厂 + 纯 keep 策略） =====
// 补三块缺测：① exec 重入守卫（diagExecBusy 并发双击）② 配置面板绑定（strategy/keepPolicy/
// priorityPath 变更实时落会话）③ getDefaultKeepIdx 策略分支（oldest/newest/path/largest）。
// 会话工厂特性：每测试新开会话，状态互不串扰。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "../../../test-utils/index.ts";
import { createDedupSession } from "./dedup.ts";
import { getDefaultKeepIdx } from "./dedup-policy.ts";

const { busEmit, getApp, loadResourceRegistry } = vi.hoisted(() => ({
  busEmit: vi.fn(),
  getApp: vi.fn(),
  loadResourceRegistry: vi.fn(() => ({})),
}));

vi.mock("../../../bus.ts", () => ({ bus: { emit: busEmit } }));
vi.mock("../../../backend/app.ts", () => ({ getApp }));
vi.mock("../../../services/resource-registry.ts", () => ({ loadResourceRegistry }));

const esc = (s: unknown): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

beforeEach(() => {
  vi.resetAllMocks();
  loadResourceRegistry.mockResolvedValue({ ysm: { id: "ysm", name: "模型", icon: "🧊" } });
});

// 两文件组：A 更老（modTime 1000）、B 更新（modTime 2000），默认 oldest → 保留 A，删 B
const groupJson = [
  {
    files: [
      { path: "/a/1.ysm", name: "1.ysm", size: 100, modTime: 1000 },
      { path: "/b/2.ysm", name: "2.ysm", size: 200, modTime: 2000 },
    ],
  },
];

describe("createDedupSession — exec 重入守卫", () => {
  it("exec 并发双击：busy 期间第二次早退，单组仅删一次", async () => {
    const resolvers: (() => void)[] = [];
    const moveFn = vi.fn(
      (_p: string) =>
        new Promise<void>((res) => {
          resolvers.push(res);
        }),
    );
    getApp.mockResolvedValue({
      GetRepoRoot: vi.fn(() => "/repo"),
      FindDuplicateFiles: vi.fn(() => groupJson),
      MoveToRecycle: moveFn,
    });
    const dedup = createDedupSession();
    const list = document.createElement("div");
    await dedup.start(list, esc, "ysm");
    await waitFor(() => list.querySelector("#diag-dedup-exec"));
    const execBtn = list.querySelector("#diag-dedup-exec") as HTMLElement;

    // 首次点击挂起在 MoveToRecycle（execBusy 已置位）；第二次同步点击必命中守卫早退
    execBtn.click();
    execBtn.click();

    // 首次点击删了 1 个文件（B）；守卫生效时第二次不产生新删除
    expect(moveFn).toHaveBeenCalledTimes(1);
    expect(moveFn).toHaveBeenCalledWith("/b/2.ysm");

    // 放行挂起点，让首次点击完成收尾
    resolvers.shift()?.();
    await waitFor(() => list.textContent!.includes("去重完成"));
    expect(busEmit).toHaveBeenCalledWith("stats:refresh");
    expect(busEmit).toHaveBeenCalledWith("tree:reload");
  });
});

describe("createDedupSession — 配置面板绑定", () => {
  it("面板 change/input 实时写入会话 config，且会话间隔离", () => {
    const dedup = createDedupSession();
    const panel = document.createElement("div");
    dedup.initConfig(panel);

    // strategy
    const strategy = panel.querySelector("#dedup-strategy") as HTMLSelectElement;
    strategy.value = "quick_hash";
    strategy.dispatchEvent(new Event("change"));
    expect(dedup.getConfig().strategy).toBe("quick_hash");

    // keepPolicy
    const keep = panel.querySelector("#keep-policy") as HTMLSelectElement;
    keep.value = "newest";
    keep.dispatchEvent(new Event("change"));
    expect(dedup.getConfig().keepPolicy).toBe("newest");
    // keepPolicy=path 时 priority-path-item 显形
    keep.value = "path";
    keep.dispatchEvent(new Event("change"));
    const pathItem = panel.querySelector("#priority-path-item") as HTMLElement;
    expect(pathItem.style.display).toBe("");

    // priorityPath
    const pathInput = panel.querySelector("#priority-path") as HTMLInputElement;
    pathInput.value = "/x/proj";
    pathInput.dispatchEvent(new Event("input"));
    expect(dedup.getConfig().priorityPath).toBe("/x/proj");

    // resetConfig 回默认
    dedup.resetConfig();
    expect(dedup.getConfig()).toEqual({ strategy: "deep_hash", keepPolicy: "oldest", priorityPath: "" });

    // 隔离：另一会话不受本会话变更影响
    const other = createDedupSession();
    expect(other.getConfig().strategy).toBe("deep_hash");
    expect(other.getConfig().keepPolicy).toBe("oldest");
  });
});

describe("getDefaultKeepIdx — keep 策略分支", () => {
  const F = [
    { path: "/x/proj/a.ysm", size: 100, modTime: 2000 },
    { path: "/y/b.ysm", size: 300, modTime: 1000 },
    { path: "/x/proj/c.ysm", size: 200, modTime: 3000 },
  ];

  it("oldest → 最早修改（min modTime）", () => {
    expect(getDefaultKeepIdx(F, "oldest", "")).toBe(1);
  });
  it("newest → 最新修改（max modTime）", () => {
    expect(getDefaultKeepIdx(F, "newest", "")).toBe(2);
  });
  it("path + 命中前缀 → 首个匹配，忽略大小写", () => {
    expect(getDefaultKeepIdx(F, "path", "/X/PROJ")).toBe(0);
  });
  it("path + 无命中 → 回退最大文件", () => {
    expect(getDefaultKeepIdx(F, "path", "/nope")).toBe(1);
    expect(getDefaultKeepIdx(F, "path", "")).toBe(1);
  });
  it("未知策略（default）→ 最大文件", () => {
    expect(getDefaultKeepIdx(F, "random", "")).toBe(1);
  });
  it("空数组 → 0", () => {
    expect(getDefaultKeepIdx([], "oldest", "")).toBe(0);
  });
});

describe("createDedupSession — exec 多组 DOM 读态（组级 :checked，非 name 拼串）", () => {
  it("两组成员各自按组读选中，keep-all 组整组跳过不删", async () => {
    const moveFn = vi.fn(async () => {});
    getApp.mockResolvedValue({
      GetRepoRoot: vi.fn(() => "/repo"),
      FindDuplicateFiles: vi.fn(() => [
        {
          files: [
            { path: "/a/1.ysm", name: "1.ysm", size: 100, modTime: 1000 },
            { path: "/b/2.ysm", name: "2.ysm", size: 200, modTime: 2000 },
          ],
        },
        {
          files: [
            { path: "/c/3.ysm", name: "3.ysm", size: 300, modTime: 3000 },
            { path: "/d/4.ysm", name: "4.ysm", size: 400, modTime: 4000 },
          ],
        },
      ]),
      MoveToRecycle: moveFn,
    });
    const dedup = createDedupSession();
    const list = document.createElement("div");
    await dedup.start(list, esc, "ysm");
    await waitFor(() => list.querySelector("#diag-dedup-exec"));

    // 两组容器按渲染序对齐 allResults；组 2 用户改选 keep-all（-1）
    const groups = list.querySelectorAll<HTMLElement>(".diag-dedup-group");
    expect(groups.length).toBe(2);
    const keepAll2 = groups[1]!.querySelector<HTMLInputElement>(
      'input[type="radio"][value="-1"]',
    )!;
    keepAll2.checked = true;

    (list.querySelector("#diag-dedup-exec") as HTMLElement).click();
    await waitFor(() => list.textContent!.includes("去重完成"));
    // 组 1 默认 oldest → 保留 1.ysm、删 2.ysm；组 2 keep-all → 3/4.ysm 均不删
    expect(moveFn).toHaveBeenCalledTimes(1);
    expect(moveFn).toHaveBeenCalledWith("/b/2.ysm");
  });
});