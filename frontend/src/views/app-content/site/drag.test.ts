// ===== 站点视图拖拽 JSON 导入组件测试（G-1 — ADR-035 / Design.md §19.1）=====
// 真实绑定 bindDragEvents：验证 JSON 识别分支（创作者/站点/非法）+ dragenter 计数。
// getApp 四个绑定 mock（MergeWorkshopCreatorsFromJSON / LoadWorkshopCreators /
// MergeWorkshopSitesFromJSON / DefaultWorkshopSites）；bus/toast 用真实总线事件流断言。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { bus } from "../../../bus.ts";

// mock bindings（阻断 Wails runtime 加载链）
vi.mock("@/backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    MergeWorkshopCreatorsFromJSON: vi.fn(async () => [2, 1]),
    LoadWorkshopCreators: vi.fn(async () => [{ name: "新A" }, { name: "新B" }]),
    MergeWorkshopSitesFromJSON: vi.fn(async () => [1, 1]),
    DefaultWorkshopSites: vi.fn(async () => [
      { id: "s1", label: "站点1新" },
      { id: "s2", label: "新站" },
    ]),
  }),
}));

import { getApp } from "../../../backend/app.ts";
import { bindDragEvents } from "./drag.ts";
import type { SiteViewState } from "./types.ts";
import type { LocalCreatorLike } from "../site-view.ts";
import type { WorkshopSite } from "../../../../bindings/ysm-model-manager/go/types/models.ts";
import { fireDrop } from "../../../test-utils/events.ts";

interface AppLike {
  MergeWorkshopCreatorsFromJSON: ReturnType<typeof vi.fn>;
  LoadWorkshopCreators: ReturnType<typeof vi.fn>;
  MergeWorkshopSitesFromJSON: ReturnType<typeof vi.fn>;
  DefaultWorkshopSites: ReturnType<typeof vi.fn>;
}

function makeState(): {
  state: SiteViewState;
  dropZone: HTMLElement;
  refresh: () => void;
  allCreators: LocalCreatorLike[];
  allSites: WorkshopSite[];
} {
  const searchResults = document.createElement("div");
  searchResults.innerHTML = '<div id="cr-drop-zone"><span>📥</span></div>';
  const allCreators: LocalCreatorLike[] = [{ name: "旧作者" } as LocalCreatorLike];
  const allSites: WorkshopSite[] = [
    { id: "s1", label: "站点1" } as WorkshopSite,
  ];
  const refresh: () => void = vi.fn();
  const state = {
    searchResults,
    allCreators,
    allSites,
    bus,
  } as unknown as SiteViewState;
  document.body.appendChild(searchResults);
  return {
    state,
    dropZone: searchResults.querySelector("#cr-drop-zone") as HTMLElement,
    refresh,
    allCreators,
    allSites,
  };
}

/** 构造带 files 的拖放事件（happy-dom 的 DragEvent init 忽略 dataTransfer，fireDrop 已处理 defineProperty 注入） */
function dropFile(dropZone: HTMLElement, file: File): void {
  fireDrop(dropZone, { files: [file] });
}

async function toastOnce(fn: () => void): Promise<{ msg: string; type: string }> {
  return new Promise((resolve) => {
    const unsub = bus.on("toast:show", (p) => {
      unsub();
      resolve({ msg: p.msg, type: p.type || "" });
    });
    fn();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("bindDragEvents 拖拽 JSON 导入", () => {
  it("1. dragenter/leave 计数：进出配对后移除 active class", () => {
    const { state, dropZone, refresh } = makeState();
    bindDragEvents(state, refresh);
    dropZone.dispatchEvent(new DragEvent("dragenter", { bubbles: true }));
    dropZone.dispatchEvent(new DragEvent("dragenter", { bubbles: true }));
    expect(dropZone.classList.contains("cr-drop-zone-active")).toBe(true);
    dropZone.dispatchEvent(new DragEvent("dragleave", { bubbles: true }));
    expect(dropZone.classList.contains("cr-drop-zone-active")).toBe(true);
    dropZone.dispatchEvent(new DragEvent("dragleave", { bubbles: true }));
    expect(dropZone.classList.contains("cr-drop-zone-active")).toBe(false);
  });

  it("2. 拖入非 .json → error toast", async () => {
    const { state, dropZone, refresh } = makeState();
    bindDragEvents(state, refresh);
    const file = new File(["x"], "a.txt", { type: "text/plain" });
    const toast = await toastOnce(() => dropFile(dropZone, file));
    expect(toast.type).toBe("error");
    expect(toast.msg).toContain("请拖拽 .json 文件");
  });

  it("3. 创作者 JSON → Merge + 刷新 allCreators + success toast", async () => {
    const { state, dropZone, refresh, allCreators } = makeState();
    bindDragEvents(state, refresh);
    const file = new File(
      ['[{"name":"新A"},{"name":"新B"}]'],
      "creators.json",
      { type: "application/json" },
    );
    const toastP = toastOnce(() => dropFile(dropZone, file));
    const app = (await getApp()) as unknown as AppLike;
    await vi.waitFor(() =>
      expect(app.MergeWorkshopCreatorsFromJSON).toHaveBeenCalled(),
    );
    expect(app.MergeWorkshopCreatorsFromJSON).toHaveBeenCalledWith(
      '[{"name":"新A"},{"name":"新B"}]',
    );
    expect(app.LoadWorkshopCreators).toHaveBeenCalled();
    expect(allCreators.map((c) => c.name)).toEqual(["新A", "新B"]);
    const toast = await toastP;
    expect(toast.type).toBe("success");
    expect(toast.msg).toBe("✅ 创作者: 新增 2，更新 1");
    expect(refresh).toHaveBeenCalled();
  });

  it("4. 站点 JSON → Go MergeWorkshopSitesFromJSON + DefaultWorkshopSites 刷新（双轨收口）", async () => {
    const { state, dropZone, refresh, allSites } = makeState();
    bindDragEvents(state, refresh);
    // DefaultWorkshopSites 返回「bundled 默认 + 合并结果」形态（真实契约：Go 落盘
    // 后读回全量，含默认站），而非恰好等于期望终态——断言默认站保留、同 id 被覆盖
    const app = (await getApp()) as unknown as AppLike;
    app.DefaultWorkshopSites.mockResolvedValueOnce([
      { id: "bilibili", label: "B站" },
      { id: "s1", label: "站点1新" },
      { id: "s2", label: "新站" },
    ]);
    const file = new File(
      ['[{"id":"s1","label":"站点1新"},{"id":"s2","label":"新站"}]'],
      "sites.json",
      { type: "application/json" },
    );
    const toastP = toastOnce(() => dropFile(dropZone, file));
    await vi.waitFor(() => expect(app.MergeWorkshopSitesFromJSON).toHaveBeenCalled());
    // 合并/去重/写回下沉 Go：前端只传原始 JSON（不本地合并、不 SaveWorkshopSites 整存）
    expect(app.MergeWorkshopSitesFromJSON).toHaveBeenCalledWith(
      '[{"id":"s1","label":"站点1新"},{"id":"s2","label":"新站"}]',
    );
    // 内存 allSites 由 DefaultWorkshopSites 刷新（前端加载站点规范函数）
    expect(app.DefaultWorkshopSites).toHaveBeenCalled();
    // 行为级断言：bundled 默认站保留（bilibili）、同 id 覆盖为刷新值、新增追加
    expect(allSites).toHaveLength(3);
    expect(allSites.find((s) => s.id === "bilibili")?.label).toBe("B站");
    expect(allSites.find((s) => s.id === "s1")?.label).toBe("站点1新");
    expect(allSites.find((s) => s.id === "s2")?.label).toBe("新站");
    const toast = await toastP;
    expect(toast.msg).toBe("✅ 站点: 新增 1，更新 1"); // 计数以 Go 返回为准
    expect(refresh).toHaveBeenCalled();
  });

  it("4b. 站点合并后 DefaultWorkshopSites 返回 null/空 → 不清空视图（走失败反馈）", async () => {
    const { state, dropZone, refresh, allSites } = makeState();
    bindDragEvents(state, refresh);
    const app = (await getApp()) as unknown as AppLike;
    app.DefaultWorkshopSites.mockResolvedValueOnce(null); // 刷新源异常
    const file = new File(
      ['[{"id":"s1","label":"站点1新"}]'],
      "sites-null.json",
      { type: "application/json" },
    );
    const toastP = toastOnce(() => dropFile(dropZone, file));
    await vi.waitFor(() => expect(app.MergeWorkshopSitesFromJSON).toHaveBeenCalled());
    const toast = await toastP;
    // 抛错进 catch → 失败反馈（refreshSitesFailed），且旧 allSites 不被清空
    expect(toast.type).toBe("error");
    expect(toast.msg).toContain("刷新站点列表失败");
    expect(allSites).toHaveLength(1); // 初始 makeState 的 s1 保留
    expect(allSites[0].label).toBe("站点1");
    expect(refresh).toHaveBeenCalled(); // finally 仍刷新
  });

  it("5. 空数组 JSON → error toast（JSON 必须是对象数组）", async () => {
    const { state, dropZone, refresh } = makeState();
    bindDragEvents(state, refresh);
    const file = new File(["[]"], "empty.json", { type: "application/json" });
    const toast = await toastOnce(() => dropFile(dropZone, file));
    expect(toast.type).toBe("error");
    expect(toast.msg).toContain("JSON 必须是对象数组");
    expect(refresh).toHaveBeenCalled(); // finally 仍刷新
  });

  it("6. 无法识别格式（无 name/id+label）→ error toast", async () => {
    const { state, dropZone, refresh } = makeState();
    bindDragEvents(state, refresh);
    const file = new File(['[{"foo":"bar"}]'], "bad.json", {
      type: "application/json",
    });
    const toast = await toastOnce(() => dropFile(dropZone, file));
    expect(toast.type).toBe("error");
    expect(toast.msg).toContain("JSON 结构无法识别");
    expect(refresh).toHaveBeenCalled();
  });

  it("7. 合并成功后 dropZone 恢复默认 label（finally resetLabel）", async () => {
    const { state, dropZone, refresh } = makeState();
    bindDragEvents(state, refresh);
    const file = new File(['[{"name":"新A"}]'], "c.json", {
      type: "application/json",
    });
    dropFile(dropZone, file);
    const app = (await getApp()) as unknown as AppLike;
    await vi.waitFor(() =>
      expect(app.MergeWorkshopCreatorsFromJSON).toHaveBeenCalled(),
    );
    await vi.waitFor(() => {
      expect(dropZone.textContent).toContain("拖拽 JSON 文件到此处");
    });
  });
});
