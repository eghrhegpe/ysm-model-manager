// ===== 站点编辑卡片拖拽排序绑定助手（2026-09 从 edit.ts 双胞胎块去重抽出） =====
// 背景：eeBindCreatorsDrag / eeBindPresetsDrag 两段各 ~90 行几乎逐行相同（jscpd 榜 P1），
// 仅差异 = 卡片选择器 / DragStateShell 键位 / drop 提交逻辑 / 输入同步回调——全部注入化。
// 行为与原实现逐点对齐，仅一处刻意收口：dataTransfer 由非空断言改为守卫访问
// （真实浏览器 dragstart/dragover 恒带 dataTransfer，行为不变；happy-dom 缺席时不再抛错，可测）。

/** 双拖拽组的在途源索引壳（creators 组用 srcIdx，presets 组用 presetSrcIdx） */
export interface DragStateShell {
  srcIdx: number;
  presetSrcIdx: number;
}

export interface DragSortSpec {
  /** 事件绑定的作用域容器（原实现为 searchResults） */
  root: HTMLElement;
  /** 本组卡片选择器（原为 `.cr-edit-card:not([data-edit='preset'])` / `[data-edit='preset']`） */
  selector: string;
  /** 双组共享的在途状态壳 */
  ds: DragStateShell;
  /** 本组写入 ds 的键位 */
  srcKey: keyof DragStateShell;
  /** drop 移动前同步全部输入框到数据（原 eeSyncAllEditInputs 的调用点） */
  syncInputs: () => void;
  /** 执行真正的数据移动；返回 true=已移动（随后 refreshView），false=放弃（仅复位 src 键） */
  commit: (srcIdx: number, targetIdx: number) => boolean;
  refreshView: () => void;
  sig: AbortSignal;
}

/** 清理两组共享的拖拽视觉态 + 复位双 src 键（对齐原 eeClearDragState 语义） */
function clearDragState(root: HTMLElement, ds: DragStateShell): void {
  ds.srcIdx = -1;
  ds.presetSrcIdx = -1;
  root.querySelectorAll(".cr-edit-card").forEach((c) => {
    c.classList.remove("cr-dragging", "cr-drag-target", "cr-drag-before", "cr-drag-after");
  });
}

/** 给 selector 命中的卡片挂全套拖拽排序事件（signal 退订，随宿主 AbortController 生命周期） */
export function bindDragSort(spec: DragSortSpec): void {
  const { root, selector, ds, srcKey, syncInputs, commit, refreshView, sig } = spec;

  root.querySelectorAll(selector).forEach((card) => {
    const el = card as HTMLElement;
    const handle = el.querySelector(".cr-drag-handle");
    if (!handle) return;
    handle.addEventListener(
      "pointerdown",
      () => {
        el.draggable = true;
      },
      { signal: sig },
    );
    el.addEventListener(
      "dragstart",
      (e: Event) => {
        const de = e as DragEvent;
        el.draggable = false;
        ds[srcKey] = parseInt(el.dataset.editIdx || "-1", 10);
        el.classList.add("cr-dragging");
        const dt = de.dataTransfer;
        if (dt) {
          dt.effectAllowed = "move";
          dt.setData("text/plain", "");
        }
      },
      { signal: sig },
    );
    el.addEventListener(
      "dragend",
      () => {
        el.draggable = false;
        clearDragState(root, ds);
      },
      { signal: sig },
    );
    el.addEventListener(
      "dragover",
      (e: Event) => {
        e.preventDefault();
        const dt = (e as DragEvent).dataTransfer;
        if (dt) dt.dropEffect = "move";
      },
      { signal: sig },
    );
    el.addEventListener(
      "dragenter",
      (e) => {
        e.preventDefault();
        el.classList.add("cr-drag-target");
        const src = ds[srcKey];
        if (src >= 0) {
          const tgt = parseInt(el.dataset.editIdx || "-1", 10);
          if (src < tgt) {
            el.classList.add("cr-drag-before");
          } else if (src > tgt) {
            el.classList.add("cr-drag-after");
          }
        }
      },
      { signal: sig },
    );
    el.addEventListener(
      "dragleave",
      () => {
        el.classList.remove("cr-drag-target", "cr-drag-before", "cr-drag-after");
      },
      { signal: sig },
    );
    el.addEventListener(
      "drop",
      (e) => {
        e.preventDefault();
        el.classList.remove("cr-drag-target");
        const targetIdx = parseInt(el.dataset.editIdx || "-1", 10);
        const srcIdx = ds[srcKey];
        if (srcIdx < 0 || srcIdx === targetIdx) return;
        syncInputs();
        const moved = commit(srcIdx, targetIdx);
        ds[srcKey] = -1;
        if (moved) refreshView();
      },
      { signal: sig },
    );
  });
}
