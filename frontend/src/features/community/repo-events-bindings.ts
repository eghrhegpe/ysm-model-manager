// ===== 创意工坊仓库事件绑定 · DOM 注册块（ADR-040 拆出）=====
// 从 events.ts 拆出：8 个 cmReBind*（DOM 选择器 → 处理器接线）+ 单文件下载决策，
// 纯副作用注册，依赖共享 ctx/监听原语，不自建状态。

import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { modalConfirm } from "@/utils/dom/modal-confirm.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { esc } from "@/utils/html/html.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { ICONS } from "@/utils/icon/workshop-icons.ts";
import { parseModelName } from "@/utils/model-name/display.ts";
import { communityGetApp } from "./community-deps.ts";
import { buildDownloadTasks, classifyDownloadSize } from "./download-tasks.ts";
import { isModelMissing } from "./render.ts";
import {
  type CmReCtx,
  cmReListen,
  cmReRenderList,
  cmReUpdateSelectedUI,
  type ListenerRef,
} from "./repo-events-shared.ts";

export function cmReBindBack(ctx: CmReCtx, listeners: ListenerRef[]): void {
  const el = ctx.sr.querySelector<HTMLElement>(".gh-back-repo");
  if (el) cmReListen(listeners, el, "click", () => ctx.backToSite());
}

export function cmReBindSearch(ctx: CmReCtx, listeners: ListenerRef[]): void {
  const srch = ctx.sr.querySelector("#gh-repo-srch") as HTMLInputElement | null;
  if (srch) cmReListen(listeners, srch, "input", () => cmReRenderList(ctx, srch.value));
}

export function cmReBindToggle(ctx: CmReCtx, listeners: ListenerRef[]): void {
  const { sr, state } = ctx;
  const toggleBtn = sr.querySelector(".gh-toggle-missing") as HTMLElement | null;
  if (toggleBtn) {
    cmReListen(listeners, toggleBtn, "click", () => {
      state.showAll = !state.showAll;
      const label = state.showAll ? t("workshop.showAll") : t("workshop.showMissing");
      toggleBtn.innerHTML = `${UI_ICONS.folder} ${esc(label)}`;
      toggleBtn.classList.toggle("active", state.showAll);
      cmReRenderList(ctx);
    });
  }
}

export function cmReBindSelChecks(ctx: CmReCtx, listeners: ListenerRef[]): void {
  const { sr, selectedSet } = ctx;
  const selContainer = sr.querySelector<HTMLElement>("#gh-repo-list");
  if (selContainer) {
    cmReListen(listeners, selContainer, "change", (e: Event) => {
      const target = e.target as HTMLInputElement;
      if (!target.classList.contains("gh-sel")) return;
      const name = target.dataset.name || "";
      if (target.checked) selectedSet.add(name);
      else selectedSet.delete(name);
      cmReUpdateSelectedUI(ctx);
    });
  }
}

export function cmReBindDlSelected(ctx: CmReCtx, listeners: ListenerRef[]): void {
  const { sr, selectedSet, queue, models, dlPrefix } = ctx;
  const dlSelBtn = sr.querySelector(".gh-dl-selected") as HTMLElement | null;
  if (dlSelBtn) {
    cmReListen(listeners, dlSelBtn, "click", async () => {
      if (queue.isDownloading()) {
        bus.emit("toast:show", {
          msg: t("workshop.downloading"),
          duration: TOAST_MS.success,
          type: "info",
        });
        return;
      }
      if (!selectedSet.size) return;
      try {
        const tasks = buildDownloadTasks(models, selectedSet, dlPrefix);
        await queue.enqueue(tasks);
      } catch (e) {
        bus.emit("toast:show", {
          msg: friendlyError(e, "下载失败"),
          duration: TOAST_MS.normal,
          type: "error",
        });
      }
    });
  }
}

export function cmReBindSelAll(ctx: CmReCtx, listeners: ListenerRef[]): void {
  const { sr, state, selectedSet, localMap } = ctx;
  const selAllCb = sr.querySelector(
    ".gh-select-all input[type=checkbox]",
  ) as HTMLInputElement | null;
  if (selAllCb) {
    cmReListen(listeners, selAllCb, "change", () => {
      const checked = selAllCb.checked;
      for (const m of state.currentFiltered) {
        if (isModelMissing(m, localMap)) {
          if (checked) selectedSet.add(m.name);
          else selectedSet.delete(m.name);
        }
      }
      cmReUpdateSelectedUI(ctx);
      cmReRenderList(ctx);
    });
  }
}

export function cmReBindContextMenu(ctx: CmReCtx, listeners: ListenerRef[]): void {
  const { sr, models } = ctx;
  const listEl = sr.querySelector("#gh-repo-list") as HTMLElement | null;
  if (listEl) {
    cmReListen(listeners, listEl, "contextmenu", (e: MouseEvent) => {
      const row = (e.target as Element).closest(".gh-row") as HTMLElement | null;
      if (!row) return;
      e.preventDefault();
      e.stopPropagation();
      const name = row.dataset.name || "";
      const m = models.find((x) => x.name === name);
      if (!m) return;
      // ADR-208 D3：右键展示项移植 menu-defs（type "workshop"，4 条纯展示项挂 noop）——
      // ctx:show 走 orchestrator 过滤链（visibleWhen 护栏 / canWebAction / divider 折叠），
      // 杀灭裸发 menu:show + 空 onClick 幽灵菜单 + m.size! 非空断言
      // （exactOptionalPropertyTypes：条件携带可选字段，不显式传 undefined）
      const workshop: { name: string; path: string; hash?: string; size?: number } = {
        name: m.name,
        path: m.path,
      };
      if (m.hash !== undefined) workshop.hash = m.hash;
      if (m.size !== undefined) workshop.size = m.size;
      bus.emit("ctx:show", {
        x: e.clientX,
        y: e.clientY,
        type: "workshop",
        workshop,
      });
    });
  }
}

async function cmReHandleSingleDownload(
  ctx: CmReCtx,
  btn: HTMLElement,
  row: Element | null,
): Promise<void> {
  const { selectedSet, queue } = ctx;
  const cbName = btn.dataset.name || "";
  const url = btn.dataset.url || "";
  const parsedSize = parseInt(btn.dataset.size || "", 10);
  const size = Number.isFinite(parsedSize) && parsedSize > 0 ? parsedSize : 0;
  const decision = classifyDownloadSize(size);
  if (decision === "reject") {
    bus.emit("toast:show", {
      msg: `📏 ${t("workshop.fileTooLarge")}`,
      duration: TOAST_MS.normal,
      type: "warn",
    });
    return;
  }
  if (decision === "confirm") {
    let ok: boolean;
    try {
      ok = await modalConfirm({
        title: t("workshop.largeFile"),
        titleIcon: "ruler",
        message: `${(size / 1024 / 1024).toFixed(1)}MB，${t("workshop.confirmDownload")}`,
        okText: t("workshop.download"),
      });
    } catch {
      ok = false;
    }
    if (ctx.state.disposed) return;
    if (!ok) return;
  }

  const cb = row?.querySelector(".gh-sel") as HTMLInputElement | null;
  if (cb && cbName) {
    cb.checked = true;
    selectedSet.add(cbName);
    cmReUpdateSelectedUI(ctx);
  }

  btn.innerHTML = ICONS.HOURGLASS;
  try {
    await queue.enqueue([{ url, saveDir: "", name: cbName, size }]);
  } finally {
    btn.innerHTML = ICONS.DOWNLOAD;
  }
}

export function cmReBindRowClick(ctx: CmReCtx, listeners: ListenerRef[]): void {
  const { sr, queue } = ctx;
  const dlContainer = sr.querySelector("#gh-repo-list") as HTMLElement | null;
  if (dlContainer) {
    cmReListen(listeners, dlContainer, "click", async (e: MouseEvent) => {
      try {
        const target = e.target as HTMLElement;
        if (target.classList.contains("gh-sel")) return;

        const dlBtn = target.closest('.gh-icon-btn[data-action="download"]') as HTMLElement | null;
        if (dlBtn) {
          if (queue.isDownloading()) {
            bus.emit("toast:show", {
              msg: t("workshop.downloading"),
              duration: TOAST_MS.success,
              type: "info",
            });
            return;
          }
          const row = dlBtn.closest(".gh-row");
          await cmReHandleSingleDownload(ctx, dlBtn, row);
          return;
        }

        const searchBtn = target.closest(
          '.gh-icon-btn[data-action="search-bili"]',
        ) as HTMLElement | null;
        if (searchBtn) {
          e.stopPropagation();
          const row = searchBtn.closest("[data-name]");
          if (row) {
            const { author } = parseModelName((row as HTMLElement).dataset.name || "");
            if (author) {
              try {
                const { OpenInBrowser } = await communityGetApp();
                OpenInBrowser(
                  `https://search.bilibili.com/all?keyword=${encodeURIComponent(author)}`,
                );
              } catch (openErr) {
                console.warn("[workshop] OpenInBrowser 失败:", openErr);
              }
            }
          }
          return;
        }
      } catch (e) {
        bus.emit("toast:show", {
          msg: friendlyError(e, "操作失败"),
          duration: TOAST_MS.normal,
          type: "error",
        });
      }
    });
  }
}
