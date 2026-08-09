// ===== 站点视图拖拽 JSON 导入组件测试（G-1 — ADR-035 / Design.md §19.1）=====
// 真实绑定 bindDragEvents：验证 JSON 识别分支（创作者/站点/非法）+ dragenter 计数。
// getApp 三个绑定 mock；bus/toast 用真实总线事件流断言。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bus } from "../../../bus.ts";

// mock bindings（阻断 Wails runtime 加载链）
vi.mock("../../../wails/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    MergeWorkshopCreatorsFromJSON: vi.fn(async () => [2, 1]),
    LoadWorkshopCreators: vi.fn(async () => [{ name: "新A" }, { name: "新B" }]),
    SaveWorkshopSites: vi.fn(async () => undefined),
  }),
}));

import { getApp } from "../../../wails/app.ts";
import { bindDragEvents } from "./drag.ts";
import type { SiteViewState } from "./types.ts";
import type { LocalCreatorLike } from "../site-view.ts";
import type { WorkshopSite } from "../../../../bindings/ysm-model-manager/go/types/models.ts";
import { fireDrop } from "../../../test-utils/events.ts";

interface AppLike {
  MergeWorkshopCreatorsFromJSON: ReturnType<typeof vi.fn>;
  LoadWorkshopCreators: ReturnType<typeof vi.fn>;
  SaveWorkshopSites: ReturnType<typeof vi.fn>;
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

/** 构造带 files 的拖放事件（happy-dom 的 DragEvent init 忽略 dataTransfer，需 defineProperty 注入） */
function dropFile(dropZone: HTMLElement, file: File): void {
  const dt = { files: [file] } as unknown as DataTransfer;
  const ev = new DragEvent("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "dataTransfer", { value: dt, configurable: true });
  dropZone.dispatchEvent(ev);
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

  it("4. 站点 JSON → 前端合并（新增+更新）→ SaveWorkshopSites", async () => {
    const { state, dropZone, refresh, allSites } = makeState();
    bindDragEvents(state, refresh);
    const file = new File(
      ['[{"id":"s1","label":"站点1新"},{"id":"s2","label":"新站"}]'],
      "sites.json",
      { type: "application/json" },
    );
    const toastP = toastOnce(() => dropFile(dropZone, file));
    const app = (await getApp()) as unknown as AppLike;
    await vi.waitFor(() => expect(app.SaveWorkshopSites).toHaveBeenCalled());
    expect(allSites).toHaveLength(2);
    expect(allSites[0].label).toBe("站点1新"); // 更新命中
    expect(allSites[1].id).toBe("s2"); // 新增追加
    expect(app.SaveWorkshopSites).toHaveBeenCalledWith(allSites);
    const toast = await toastP;
    expect(toast.msg).toBe("✅ 站点: 新增 1，更新 1");
    expect(refresh).toHaveBeenCalled();
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
    expect(toast.msg).toContain("JSON 格式无法识别");
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
