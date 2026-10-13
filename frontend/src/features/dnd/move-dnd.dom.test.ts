// ===== bindTreeMoveDnD DOM 编排层测试（ADR-336）=====
// 覆盖 move-dnd.ts 的 DOM 事件编排（dragstart 行委托 / drop 分流 / dragend 清理）——
// CI diff-coverage 实证：纯函数测试只盖判定层（21%），DOM 层 116-260 行零覆盖。
// happy-dom 下合成 DragEvent + Object.defineProperty 注入 dataTransfer（dnd-integration
// 同款手法）。双通道互斥 / 自反短路 / 载荷防伪在纯函数测试（move-dnd.test.ts）已锁，
// 此处只锁「事件到达 → 正确分支执行」的编排行为。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bindTreeMoveDnD, TREE_MOVE_MIME, type TreeMovePayload } from "./move-dnd.ts";

const PAYLOAD: TreeMovePayload = { paths: ["/repo/a.ysm"], anchor: "/repo/a.ysm" };

function makeDndEvent(
  type: string,
  opts: {
    /** dataTransfer（未给 = 不注入，模拟无 dt 事件） */
    dt?: DataTransfer;
    /** 派发目标（缺省 = file 行内子元素，走行委托） */
    target?: HTMLElement;
    relatedTarget?: EventTarget | null;
  } = {},
): DragEvent {
  const ev = new DragEvent(type, { bubbles: true, cancelable: true, composed: true });
  if (opts.dt) {
    Object.defineProperty(ev, "dataTransfer", { value: opts.dt, configurable: true });
  }
  if ("relatedTarget" in opts) {
    Object.defineProperty(ev, "relatedTarget", { value: opts.relatedTarget, configurable: true });
  }
  (opts.target ?? undefined) && opts.target?.dispatchEvent(ev);
  return ev;
}

describe("bindTreeMoveDnD — DOM 编排", () => {
  let container: HTMLElement;
  let calls: {
    getPayload: ReturnType<typeof vi.fn<(anchorPath: string) => TreeMovePayload | null>>;
    setDragging: ReturnType<typeof vi.fn<(paths: Set<string> | null) => void>>;
    executeMove: ReturnType<typeof vi.fn<(paths: string[], targetDir: string) => Promise<void>>>;
    setDropTarget: ReturnType<typeof vi.fn<(el: HTMLElement | null) => void>>;
  };
  let cleanup: () => void;

  beforeEach(() => {
    document.body.innerHTML = "";
    container = document.createElement("div");
    container.innerHTML = `
      <div class="fl" data-fullpath="/repo/a.ysm"><span class="nm">a.ysm</span></div>
      <div class="fh" data-dir="folder"><span class="nm">folder</span></div>
    `;
    document.body.appendChild(container);
    calls = {
      getPayload: vi.fn((_anchorPath: string) => PAYLOAD),
      setDragging: vi.fn(),
      executeMove: vi.fn().mockResolvedValue(undefined),
      setDropTarget: vi.fn(),
    };
    cleanup = bindTreeMoveDnD(container, calls);
  });

  afterEach(() => {
    cleanup?.();
  });

  // ── dragstart 行委托 ──

  it("dragstart on file row → getPayload + setData(MIME) + effectAllowed=move + setDragging", () => {
    const dt = new DataTransfer();
    const row = container.querySelector<HTMLElement>(".fl")!;
    makeDndEvent("dragstart", { dt, target: row });
    expect(calls.getPayload).toHaveBeenCalledWith("/repo/a.ysm");
    expect(dt.getData(TREE_MOVE_MIME)).toBe(JSON.stringify(PAYLOAD));
    expect(dt.effectAllowed).toBe("move");
    expect(calls.setDragging).toHaveBeenCalledWith(new Set(["/repo/a.ysm"]));
  });

  it("dragstart target 非文件行（folder 行）→ 不起拖（getPayload 不调）", () => {
    const dt = new DataTransfer();
    const folder = container.querySelector<HTMLElement>(".fh")!;
    makeDndEvent("dragstart", { dt, target: folder });
    expect(calls.getPayload).not.toHaveBeenCalled();
    expect(dt.getData(TREE_MOVE_MIME)).toBe("");
  });

  it("getPayload 返回 null（busy 拒绝）→ 不 setData 不 setDragging", () => {
    calls.getPayload.mockReturnValueOnce(null);
    const dt = new DataTransfer();
    const row = container.querySelector<HTMLElement>(".fl")!;
    makeDndEvent("dragstart", { dt, target: row });
    expect(dt.getData(TREE_MOVE_MIME)).toBe("");
    expect(calls.setDragging).not.toHaveBeenCalled();
  });

  it("无 dataTransfer 的 dragstart → 安全早退不抛", () => {
    const row = container.querySelector<HTMLElement>(".fl")!;
    expect(() => {
      const ev = new DragEvent("dragstart", { bubbles: true, cancelable: true, composed: true });
      row.dispatchEvent(ev);
    }).not.toThrow();
    expect(calls.setDragging).not.toHaveBeenCalled();
  });

  // ── dragover / drop 分流 ──

  it("dragover with TREE_MOVE_MIME → preventDefault + dropEffect=move + folder 行 drop-target", () => {
    const dt = new DataTransfer();
    dt.setData(TREE_MOVE_MIME, "x");
    const folder = container.querySelector<HTMLElement>(".fh")!;
    const ev = makeDndEvent("dragover", { dt });
    // 派发在 folder 行上（document 监听，bubbles 到 document；target=folder）
    folder.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(dt.dropEffect).toBe("move");
    expect(folder.classList.contains("drop-target")).toBe(true);
    expect(calls.setDropTarget).toHaveBeenCalledWith(folder);
  });

  it("dragover 无文件夹命中 → container 本体成为目标（根目标）", () => {
    const dt = new DataTransfer();
    dt.setData(TREE_MOVE_MIME, "x");
    const fileRow = container.querySelector<HTMLElement>(".fl")!;
    fileRow.dispatchEvent(makeDndEvent("dragover", { dt }));
    expect(container.classList.contains("drop-target")).toBe(true);
  });

  it("drop on folder → executeMove(paths, dir) 被调", async () => {
    const dt = new DataTransfer();
    dt.setData(TREE_MOVE_MIME, JSON.stringify(PAYLOAD));
    const folder = container.querySelector<HTMLElement>(".fh")!;
    folder.dispatchEvent(makeDndEvent("drop", { dt }));
    await vi.waitFor(() => expect(calls.executeMove).toHaveBeenCalledWith(PAYLOAD.paths, "folder"));
  });

  it("drop on 根（非文件夹）→ executeMove(paths, '')", async () => {
    const dt = new DataTransfer();
    dt.setData(TREE_MOVE_MIME, JSON.stringify(PAYLOAD));
    const fileRow = container.querySelector<HTMLElement>(".fl")!;
    fileRow.dispatchEvent(makeDndEvent("drop", { dt }));
    await vi.waitFor(() => expect(calls.executeMove).toHaveBeenCalledWith(PAYLOAD.paths, ""));
  });

  it("drop 载荷伪造（非法 JSON）→ executeMove 不被调（fail-closed）", async () => {
    const dt = new DataTransfer();
    dt.setData(TREE_MOVE_MIME, "not-json{");
    const folder = container.querySelector<HTMLElement>(".fh")!;
    folder.dispatchEvent(makeDndEvent("drop", { dt }));
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.executeMove).not.toHaveBeenCalled();
  });

  it("drop 无 MIME（Files 拖源等）→ 早退不执行（双通道互斥编排侧）", async () => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "x");
    const folder = container.querySelector<HTMLElement>(".fh")!;
    folder.dispatchEvent(makeDndEvent("drop", { dt }));
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.executeMove).not.toHaveBeenCalled();
  });

  // ── 视觉态清理 ──

  it("dragend → setDragging(null)（拖源降透明收口）", () => {
    const dt = new DataTransfer();
    const row = container.querySelector<HTMLElement>(".fl")!;
    row.dispatchEvent(makeDndEvent("dragstart", { dt }));
    expect(calls.setDragging).toHaveBeenCalledTimes(1);
    row.dispatchEvent(new DragEvent("dragend", { bubbles: true, composed: true }));
    expect(calls.setDragging).toHaveBeenLastCalledWith(null);
  });

  it("drop 后 drop-target 摘除（无论落点是否有效）", async () => {
    const dt = new DataTransfer();
    dt.setData(TREE_MOVE_MIME, JSON.stringify(PAYLOAD));
    const folder = container.querySelector<HTMLElement>(".fh")!;
    folder.dispatchEvent(makeDndEvent("dragover", { dt }));
    expect(folder.classList.contains("drop-target")).toBe(true);
    folder.dispatchEvent(makeDndEvent("drop", { dt }));
    await vi.waitFor(() => expect(calls.executeMove).toHaveBeenCalled());
    expect(folder.classList.contains("drop-target")).toBe(false);
  });

  it("dragleave 出树 → drop-target 摘除 + setDragging 不动（离开≠会话结束）", () => {
    const dt = new DataTransfer();
    dt.setData(TREE_MOVE_MIME, JSON.stringify(PAYLOAD));
    const folder = container.querySelector<HTMLElement>(".fh")!;
    folder.dispatchEvent(makeDndEvent("dragover", { dt }));
    expect(folder.classList.contains("drop-target")).toBe(true);
    // relatedTarget=null（拖出窗口）
    const ev = new DragEvent("dragleave", { bubbles: true, composed: true });
    Object.defineProperty(ev, "dataTransfer", { value: dt, configurable: true });
    Object.defineProperty(ev, "relatedTarget", { value: null, configurable: true });
    folder.dispatchEvent(ev);
    expect(folder.classList.contains("drop-target")).toBe(false);
    expect(calls.setDragging).not.toHaveBeenCalledWith(null); // dragleave 不清拖源态
  });

  // ── cleanup ──

  it("cleanup 后事件不再响应（dragstart/drop 静默）", async () => {
    cleanup();
    cleanup = () => {}; // 防 afterEach 双清
    const dt = new DataTransfer();
    dt.setData(TREE_MOVE_MIME, JSON.stringify(PAYLOAD));
    const folder = container.querySelector<HTMLElement>(".fh")!;
    folder.dispatchEvent(makeDndEvent("drop", { dt }));
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.executeMove).not.toHaveBeenCalled();
  });
});
