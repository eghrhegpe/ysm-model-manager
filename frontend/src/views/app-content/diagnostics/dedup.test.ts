// ===== 去重会话测试（dedup.ts 会话工厂 + 纯 keep 策略） =====
// 补三块缺测：① exec 重入守卫（diagExecBusy 并发双击）② 配置面板绑定（strategy/keepPolicy/
// priorityPath 变更实时落会话）③ getDefaultKeepIdx 策略分支（oldest/newest/path/largest）。
// 会话工厂特性：每测试新开会话，状态互不串扰。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@/test-utils/index.ts";
import { createDedupSession, DEDUP_CONFIRM_MS, dedupSelectedIndex } from "./dedup.ts";
import { getDefaultKeepIdx } from "./dedup-policy.ts";

const { busEmit, getApp } = vi.hoisted(() => ({
  busEmit: vi.fn(),
  getApp: vi.fn(),
}));

// ===== dedupSelectedIndex：缺失容器必须回落 keep-all（fail toward preservation）=====
// 定义（2026-10-07）：`runExecDelete` 用 `groupEls[gi]` 索引渲染平铺的 `.diag-dedup-group`；
// 渲染器当前对每个 group 无条件产出容器（renderResultsHtml 全函数），故「容器缺失」构造
// 不可达，但**缺容器时不能回落 0**——0 会让该组按「保留第 0 项、删除其余」执行（用户没
// 见过的组被静默清空）。删除路径的降级方向必须是**朝向保全**：缺失 → -1（keep-all，整组
// 不删）。容器存在但未勾选 → 仍 0（设计的默认保留项）。
describe("dedupSelectedIndex 缺失容器降级", () => {
  it("容器缺失（undefined）→ -1（keep-all）：整组跳过不删，绝不误回落 0", () => {
    expect(dedupSelectedIndex(undefined)).toBe(-1);
  });

  it("容器存在但未勾选任何 radio → 0（设计的默认：保留第 0 项）", () => {
    const el = document.createElement("div");
    el.innerHTML = `<input type="radio" name="dedup-keep-0" value="0">
    <input type="radio" name="dedup-keep-0" value="-1">`;
    expect(dedupSelectedIndex(el)).toBe(0);
  });

  it("勾选了 keep-all（value=-1）→ -1", () => {
    const el = document.createElement("div");
    el.innerHTML = `<input type="radio" name="dedup-keep-1" value="0">
    <input type="radio" name="dedup-keep-1" value="-1" checked>`;
    expect(dedupSelectedIndex(el)).toBe(-1);
  });

  it("勾选了非 0 保留项（value=2）→ 2（选中项保留、其余删除的口径不变）", () => {
    const el = document.createElement("div");
    el.innerHTML = `<input type="radio" name="dedup-keep-2" value="2" checked>
    <input type="radio" name="dedup-keep-2" value="-1">`;
    expect(dedupSelectedIndex(el)).toBe(2);
  });
});;

vi.mock("@/bus", () => ({ bus: { emit: busEmit } }));
vi.mock("@/backend/app.ts", () => ({ getApp }));

import { escUnknown as esc } from "@/utils/html/html.ts";

/**
 * 走完二次确认：首次点击武装、再次点击执行。
 *
 * 2026-10-14 起 exec 是**两段式**（锐评 P1「破坏性操作无二次确认」）——所有「点一下就该
 * 删掉」的既有用例都必须经此辅助，否则断言的是旧契约。集中一处也避免各测试各写两遍 click。
 */
function confirmExec(list: HTMLElement): void {
  const btn = list.querySelector<HTMLElement>("#diag-dedup-exec");
  btn?.click(); // ① 武装
  btn?.click(); // ② 执行
}

beforeEach(() => {
  vi.resetAllMocks();
  // 锐评 UX #4 收口：config 持久化到 localStorage——每测试需干净起点，否则前一测试
  // 写入的 ysm-dedup-config 会污染后续会话（keepPolicy 默认值不同即让 keep-all 断言误判）。
  localStorage.clear();
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

describe("createDedupSession — exec 二次确认 + 重入守卫", () => {
  it("首次点击只武装不删；二次点击才执行；执行期间的点击被忽略", async () => {
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

    // ① 首次点击：只武装，**不删任何文件**（旧实现此刻就开删——这条断言是那笔账的墓碑）
    execBtn.click();
    expect(moveFn).not.toHaveBeenCalled();
    expect(execBtn.dataset.armed).toBe("1");
    // 武装文案报出真实将删数量（1 个 = 两组文件组默认 oldest 保留 A 删 B）
    expect(execBtn.textContent).toContain("确认删除 1 个文件");
    // 图标仍在（换文案只动标签槽，不整钮重写）
    expect(execBtn.querySelector("svg")).toBeTruthy();

    // ② 二次点击：执行（挂起在 MoveToRecycle）；③ 执行期间第三次点击被忽略（不重新武装）
    execBtn.click();
    execBtn.click();
    expect(moveFn).toHaveBeenCalledTimes(1);
    expect(moveFn).toHaveBeenCalledWith("/b/2.ysm");
    // 执行前已解除武装：不残留「再点一下就删」的状态，文案回到初始值
    expect(execBtn.dataset.armed).toBeUndefined();
    expect(execBtn.textContent).toContain("删除未选中的重复文件");

    // 放行挂起点，让首次点击完成收尾
    resolvers.shift()?.();
    await waitFor(() => list.textContent!.includes("去重完成"));
    expect(busEmit).toHaveBeenCalledWith("stats:refresh");
    expect(busEmit).toHaveBeenCalledWith("tree:reload");
  });

  it("武装态超时自动解除：窗口过后再点只重新武装、不删除", async () => {
    const moveFn = vi.fn(async () => {});
    getApp.mockResolvedValue({
      GetRepoRoot: vi.fn(() => "/repo"),
      FindDuplicateFiles: vi.fn(() => groupJson),
      MoveToRecycle: moveFn,
    });
    const dedup = createDedupSession();
    const list = document.createElement("div");
    // ⚠️ 必须入文档：武装定时器的回调带 `btn.isConnected` 守卫（分离即作废，防写游离节点），
    // 游离夹具会让守卫拦下解除动作——测的就不是产品行为了（同 conflicts.test.ts 的 list 入文档惯例）。
    document.body.appendChild(list);
    // ⚠️ 假时钟必须在 start 之后再装：扫描链路依赖定时器/微任务，先装会让 start 永不落定
    // （测试超时 → finally 不执行 → 假时钟泄漏，同文件后续用例连带全红，实测踩到）。
    await dedup.start(list, esc, "ysm");
    const execBtn = list.querySelector("#diag-dedup-exec") as HTMLElement;

    vi.useFakeTimers();
    try {
      execBtn.click(); // 武装
      expect(execBtn.dataset.armed).toBe("1");
      await vi.advanceTimersByTimeAsync(DEDUP_CONFIRM_MS); // 窗口过期
      expect(execBtn.dataset.armed).toBeUndefined();
      expect(execBtn.textContent).toContain("删除未选中的重复文件");

      execBtn.click(); // 超时后这一下只是重新武装
      expect(moveFn).not.toHaveBeenCalled();
      expect(execBtn.dataset.armed).toBe("1");
    } finally {
      vi.useRealTimers();
      document.body.removeChild(list);
    }
  });

  it("取消（清空结果区）后武装态随之消失，不残留可删入口", async () => {
    const moveFn = vi.fn(async () => {});
    getApp.mockResolvedValue({
      GetRepoRoot: vi.fn(() => "/repo"),
      FindDuplicateFiles: vi.fn(() => groupJson),
      MoveToRecycle: moveFn,
    });
    const dedup = createDedupSession();
    const list = document.createElement("div");
    await dedup.start(list, esc, "ysm");
    const execBtn = list.querySelector("#diag-dedup-exec") as HTMLElement;
    execBtn.click(); // 武装
    expect(execBtn.dataset.armed).toBe("1");

    (list.querySelector("#diag-dedup-cancel") as HTMLElement).click(); // 取消 = 清空结果区
    expect(list.querySelector("#diag-dedup-exec")).toBeNull();
    expect(moveFn).not.toHaveBeenCalled();
  });

  it("全部组选保留全部 → 不武装、不删除，只回一行说明", async () => {
    const moveFn = vi.fn(async () => {});
    getApp.mockResolvedValue({
      GetRepoRoot: vi.fn(() => "/repo"),
      FindDuplicateFiles: vi.fn(() => groupJson),
      MoveToRecycle: moveFn,
    });
    const dedup = createDedupSession();
    const list = document.createElement("div");
    await dedup.start(list, esc, "ysm");
    const group = list.querySelector<HTMLElement>(".diag-dedup-group")!;
    group.querySelector<HTMLInputElement>('input[type="radio"][value="-1"]')!.checked = true;

    (list.querySelector("#diag-dedup-exec") as HTMLElement).click();
    // 计划为空：不进入「确认删除 0 个文件」的荒谬态，也不删任何文件
    const execBtn = list.querySelector("#diag-dedup-exec") as HTMLElement;
    expect(execBtn.dataset.armed).toBeUndefined();
    expect(moveFn).not.toHaveBeenCalled();
    expect(list.textContent).toContain("没有可删除的文件");
  });

  it("预览计数与实际删除同源：报 2 个就真删这 2 个（防「说删 N 实际删 M」）", async () => {
    const moveFn = vi.fn(async () => {});
    const threeGroups = [1, 2, 3].map((i) => ({
      files: [
        { path: `/g${i}/keep.ysm`, name: "keep.ysm", size: 100, modTime: 1000 },
        { path: `/g${i}/drop.ysm`, name: "drop.ysm", size: 200, modTime: 2000 },
      ],
    }));
    getApp.mockResolvedValue({
      GetRepoRoot: vi.fn(() => "/repo"),
      FindDuplicateFiles: vi.fn(() => threeGroups),
      MoveToRecycle: moveFn,
    });
    const dedup = createDedupSession();
    const list = document.createElement("div");
    await dedup.start(list, esc, "ysm");
    // 组 2 改选 keep-all → 计划应剩 2 项
    const groups = list.querySelectorAll<HTMLElement>(".diag-dedup-group");
    groups[1]!.querySelector<HTMLInputElement>('input[type="radio"][value="-1"]')!.checked = true;

    const execBtn = list.querySelector("#diag-dedup-exec") as HTMLElement;
    execBtn.click(); // 武装
    expect(execBtn.textContent).toContain("确认删除 2 个文件");

    execBtn.click(); // 执行
    await waitFor(() => list.textContent!.includes("去重完成"));
    // 实际删除面 = 计划面（组 1/3 各一个；组 2 keep-all 未删）
    // moveFn 是无参签名的 vi.fn，mock.calls 推断为空元组——经 unknown[][] 收窄取首参
    const called = (moveFn.mock.calls as unknown as unknown[][]).map((c) => c[0]);
    expect(called.sort()).toEqual(["/g1/drop.ysm", "/g3/drop.ysm"]);
  });
});

describe("createDedupSession — 感知性记账 lastScannedType（P2-2 收债）", () => {
  it("扫描请求直传 strategy token（锐评①收口：不再 JSON 文本协议）", async () => {
    const findFn = vi.fn(() => groupJson);
    getApp.mockResolvedValue({
      GetRepoRoot: vi.fn(() => "/repo"),
      FindDuplicateFiles: findFn,
      MoveToRecycle: vi.fn(async () => {}),
    });
    const dedup = createDedupSession();
    const list = document.createElement("div");
    await dedup.start(list, esc, "ysm");
    await waitFor(() => findFn.mock.calls.length > 0);
    expect(findFn).toHaveBeenCalledWith("/repo", "deep_hash");
  });

  it("初始 null（从未扫过）→ start 后记为发起类型", async () => {
    getApp.mockResolvedValue({
      GetRepoRoot: vi.fn(() => "/repo"),
      FindDuplicateFiles: vi.fn(() => groupJson),
      MoveToRecycle: vi.fn(async () => {}),
    });
    const dedup = createDedupSession();
    expect(dedup.lastScannedType()).toBeNull();
    const list = document.createElement("div");
    await dedup.start(list, esc, "mmd");
    expect(dedup.lastScannedType()).toBe("mmd");
  });

  it("busy 拦截的重入不改账：扫描 A 进行中发起 B，账上仍是 A", async () => {
    // FindDuplicateFiles 挂起 = busy 长期置位；期间发起的第二次 start 被守卫拦截。
    // 挂起句柄走数组（对齐既有用例的 resolvers 模式）——闭包赋值会让 TS 流分析
    // 把标量窄化成恒 null，`release?.()` 报 never 不可调用
    const releaseFns: Array<() => void> = [];
    getApp.mockResolvedValue({
      GetRepoRoot: vi.fn(() => "/repo"),
      FindDuplicateFiles: vi.fn(
        () =>
          new Promise((res) => {
            releaseFns.push(() => res(groupJson));
          }),
      ),
      MoveToRecycle: vi.fn(async () => {}),
    });
    const dedup = createDedupSession();
    const list = document.createElement("div");
    const first = dedup.start(list, esc, "ysm");
    await waitFor(() => releaseFns.length > 0); // busy 已置位、扫描挂起中
    expect(dedup.lastScannedType()).toBe("ysm");
    await dedup.start(list, esc, "mmd"); // busy 命中 → 记 pending、账不动
    expect(dedup.lastScannedType()).toBe("ysm");
    releaseFns.shift()?.();
    await first;
    // 锐评 P2 收口（2026-10-14）：A 完成后按 pending 补扫 B——可见面板快速连切类型，
    // 去重结果不得定格上一类型。账最终落到 B。
    await waitFor(() => dedup.lastScannedType() === "mmd");
    // 补扫已发起（scanEachDirectory 先让一帧 rAF 才调 FindDuplicateFiles，须等它落）
    await waitFor(() => releaseFns.length > 0);
    releaseFns.shift()?.(); // 释放 B，让会话安静收尾
    await waitFor(() => releaseFns.length === 0);
  });

  it("可见面板三连切（A→B→C）：pending 只留最新，补扫按 C", async () => {
    const releaseFns: Array<() => void> = [];
    getApp.mockResolvedValue({
      GetRepoRoot: vi.fn(() => "/repo"),
      FindDuplicateFiles: vi.fn(
        () =>
          new Promise((res) => {
            releaseFns.push(() => res(groupJson));
          }),
      ),
      MoveToRecycle: vi.fn(async () => {}),
    });
    const dedup = createDedupSession();
    const list = document.createElement("div");
    const first = dedup.start(list, esc, "ysm");
    await waitFor(() => releaseFns.length > 0);
    await dedup.start(list, esc, "mmd"); // pending = mmd
    await dedup.start(list, esc, "EntityPlayer"); // pending 覆盖为 EntityPlayer
    releaseFns.shift()?.(); // 释放 A
    await first;
    await waitFor(() => dedup.lastScannedType() === "EntityPlayer");
    releaseFns.shift()?.(); // 释放最终补扫
    await waitFor(() => releaseFns.length === 0);
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

    // 锐评 UX #4 收口（2026-10-14）：config 持久化到 storage——原「会话隔离」断言在此反转，
    // 新会话读到的是持久化配置而非默认（应用重启不丢策略）。resetConfig 已把默认写回，
    // 故此处断言「新会话=默认」仍是 reset 后的正确行为。
    const other = createDedupSession();
    expect(other.getConfig().strategy).toBe("deep_hash");
    expect(other.getConfig().keepPolicy).toBe("oldest");
  });

  it("配置变更持久化到 storage，新会话读取（锐评 UX #4：重启不丢策略）", () => {
    localStorage.clear();
    const a = createDedupSession();
    const panel = document.createElement("div");
    a.initConfig(panel);

    (panel.querySelector("#dedup-strategy") as HTMLSelectElement).value = "name_size";
    (panel.querySelector("#dedup-strategy") as HTMLSelectElement).dispatchEvent(new Event("change"));
    const keep = panel.querySelector("#keep-policy") as HTMLSelectElement;
    keep.value = "path";
    keep.dispatchEvent(new Event("change"));
    const pathInput = panel.querySelector("#priority-path") as HTMLInputElement;
    pathInput.value = "/x/proj";
    pathInput.dispatchEvent(new Event("input"));

    // 新会话应读到持久化配置（非默认）
    const b = createDedupSession();
    expect(b.getConfig()).toEqual({ strategy: "name_size", keepPolicy: "path", priorityPath: "/x/proj" });
  });

  it("priority-path 输入框回填 config.priorityPath（原恒写 value=\"\" 不回填）", () => {
    localStorage.clear();
    localStorage.setItem(
      "ysm-dedup-config",
      JSON.stringify({ strategy: "deep_hash", keepPolicy: "path", priorityPath: "/x/proj" }),
    );
    const dedup = createDedupSession();
    const panel = document.createElement("div");
    dedup.initConfig(panel);
    const pathInput = panel.querySelector("#priority-path") as HTMLInputElement;
    expect(pathInput.value).toBe("/x/proj");
    // keepPolicy=path → priority-path-item 显形
    const pathItem = panel.querySelector("#priority-path-item") as HTMLElement;
    expect(pathItem.style.display).toBe("");
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

    confirmExec(list);
    await waitFor(() => list.textContent!.includes("去重完成"));
    // 组 1 默认 oldest → 保留 1.ysm、删 2.ysm；组 2 keep-all → 3/4.ysm 均不删
    expect(moveFn).toHaveBeenCalledTimes(1);
    expect(moveFn).toHaveBeenCalledWith("/b/2.ysm");
  });
});
describe("createDedupSession — exec 失败路径（错误样本封顶 + 条件 bus.emit）", () => {
  /** 4 组各 2 文件：默认 oldest → 每组删 1，共 4 次 MoveToRecycle（跨组共享同一 errors 数组） */
  const fourGroups = [1, 2, 3, 4].map((i) => ({
    files: [
      { path: `/g${i}/keep.ysm`, name: "keep.ysm", size: 100, modTime: 1000 },
      { path: `/g${i}/drop.ysm`, name: "drop.ysm", size: 200, modTime: 2000 },
    ],
  }));

  it("全失败 → warn 行（非 success）+ 错误明细全局封顶 3 条；del=0 不刷统计/树", async () => {
    const moveFn = vi.fn(async () => {
      throw new Error("EACCES: 拒绝访问");
    });
    getApp.mockResolvedValue({
      GetRepoRoot: vi.fn(() => "/repo"),
      FindDuplicateFiles: vi.fn(() => fourGroups),
      MoveToRecycle: moveFn,
    });
    const dedup = createDedupSession();
    const list = document.createElement("div");
    await dedup.start(list, esc, "ysm");
    await waitFor(() => list.querySelector("#diag-dedup-exec"));
    confirmExec(list);
    await waitFor(() => list.textContent!.includes("去重完成"));

    // 失败不中断删除链：4 组各尝试 1 次
    expect(moveFn).toHaveBeenCalledTimes(4);
    expect(list.querySelectorAll(".diag-msg-warn").length).toBe(1);
    // errors 是跨组共享数组，封顶 = 全局 3 条（不是每组 3 条）
    expect(list.querySelectorAll(".diag-msg-error").length).toBe(3);
    // del=0 → 不触发统计/树刷新（仅 del>0 才 emit）
    expect(busEmit).not.toHaveBeenCalledWith("stats:refresh");
    expect(busEmit).not.toHaveBeenCalledWith("tree:reload");
  });

  it("部分成功 → del/fail 各自计数，del>0 仍刷统计与树", async () => {
    let n = 0;
    const moveFn = vi.fn(async () => {
      n++;
      if (n === 2) throw new Error("EBUSY: 占用");
    });
    getApp.mockResolvedValue({
      GetRepoRoot: vi.fn(() => "/repo"),
      FindDuplicateFiles: vi.fn(() => fourGroups),
      MoveToRecycle: moveFn,
    });
    const dedup = createDedupSession();
    const list = document.createElement("div");
    await dedup.start(list, esc, "ysm");
    await waitFor(() => list.querySelector("#diag-dedup-exec"));
    confirmExec(list);
    await waitFor(() => list.textContent!.includes("去重完成"));

    const text = (list.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain("移入回收站 3 个");
    expect(text).toContain("失败 1 个");
    expect(list.querySelectorAll(".diag-msg-error").length).toBe(1);
    expect(busEmit).toHaveBeenCalledWith("stats:refresh");
    expect(busEmit).toHaveBeenCalledWith("tree:reload");
  });

  it("execBusy 复位在 finally：失败后再次点击仍会重新执行（不卡死）", async () => {
    const moveFn = vi.fn(async () => {
      throw new Error("boom");
    });
    getApp.mockResolvedValue({
      GetRepoRoot: vi.fn(() => "/repo"),
      FindDuplicateFiles: vi.fn(() => groupJson),
      MoveToRecycle: moveFn,
    });
    const dedup = createDedupSession();
    const list = document.createElement("div");
    await dedup.start(list, esc, "ysm");
    await waitFor(() => list.querySelector("#diag-dedup-exec"));
    confirmExec(list);
    await waitFor(() => list.textContent!.includes("去重完成"));
    expect(moveFn).toHaveBeenCalledTimes(1);
    // 失败后 execBusy 已复位，可再次执行（同一 innerHTML 已被替换 → 重取按钮；此处直接复扫）
    await dedup.start(list, esc, "ysm");
    await waitFor(() => list.querySelector("#diag-dedup-exec"));
    confirmExec(list);
    await waitFor(() => moveFn.mock.calls.length === 2);
  });
});

describe("createDedupSession — 扫描取消（ADR-314）", () => {
  it("取消按钮 → CancelError → 「已取消」落定，busy 复位可复扫", async () => {
    let rejectFn: (e: unknown) => void = () => {};
    const scanMock = vi.fn(() => {
      const p = new Promise<never>((_res, rej) => {
        rejectFn = rej;
      });
      (p as unknown as { cancel: (c?: unknown) => void }).cancel = () =>
        rejectFn(Object.assign(new Error("cancelled"), { name: "CancelError" }));
      return p;
    });
    getApp.mockResolvedValue({
      GetRepoRoot: vi.fn(() => "/repo"),
      FindDuplicateFiles: scanMock,
      MoveToRecycle: vi.fn(async () => {}),
    });
    const dedup = createDedupSession();
    const list = document.createElement("div");
    const startP = dedup.start(list, esc, "ysm");
    await waitFor(() => list.querySelector("#diag-scan-cancel"));
    (list.querySelector("#diag-scan-cancel") as HTMLElement).click();
    await startP;
    await waitFor(() => list.textContent!.includes("已取消"));
    // busy 已复位：换正常 mock 再发起，扫描重新执行到结果渲染
    getApp.mockResolvedValue({
      GetRepoRoot: vi.fn(() => "/repo"),
      FindDuplicateFiles: vi.fn(() => groupJson),
      MoveToRecycle: vi.fn(async () => {}),
    });
    await dedup.start(list, esc, "mmd");
    await waitFor(() => list.querySelector("#diag-dedup-exec"));
  });
});
