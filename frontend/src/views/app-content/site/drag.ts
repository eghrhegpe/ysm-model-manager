// ===== 站点视图拖拽 JSON 导入（从 site-view.ts 拆出，ADR-034 方向①）=====
import { friendlyError } from "../../../utils/dom/errors.ts";
import { t } from "../../../core/i18n/t.ts";
import { getApp } from "../../../backend/app.ts";
import type { WorkshopSite } from "../../../utils/types-re-export.ts";
import type { LocalCreatorLike } from "../site-view.ts";
import type { SiteViewState, CleanupFn } from "./types.ts";

/**
 * 绑定拖拽 JSON 导入事件：创作者 JSON / 站点 JSON 识别 + 合并。
 * 仅在 wsEditModeRef.v 编辑模式下渲染 drop-zone，故内部判断编辑态。
 */
export function bindDragEvents(state: SiteViewState, _refreshView: () => void): CleanupFn {
  const { searchResults, allCreators, allSites, bus: busRef } = state;

  // ===== 拖拽 JSON 导入创作者/站点配置 =====
  const dropZone = searchResults.querySelector("#cr-drop-zone");
  if (dropZone) {
    let _dragCounter = 0;

    const onDragEnter = (e: DragEvent): void => {
      e.preventDefault();
      _dragCounter++;
      dropZone.classList.add("cr-drop-zone-active");
    };
    const onDragOver = (e: Event): void => {
      e.preventDefault();
    };
    const onDragLeave = (): void => {
      _dragCounter--;
      if (_dragCounter <= 0) {
        _dragCounter = 0;
        dropZone.classList.remove("cr-drop-zone-active");
      }
    };
    const onDrop = async (e: DragEvent): Promise<void> => {
      e.preventDefault();
      _dragCounter = 0;
      dropZone.classList.remove("cr-drop-zone-active");

      const file = e.dataTransfer?.files?.[0];
      if (!file || !file.name.endsWith(".json")) {
        busRef.emit("toast:show", {
          msg: t("content.dragJsonOnly"),
          duration: 3000,
          type: "error",
        });
        return;
      }

      const resetLabel = (): void => {
        dropZone.innerHTML =
          '<span class="cr-drop-icon">📥</span>' +
          '<span class="cr-drop-text">' + t("content.dropZoneHint") + "</span>";
      };

      try {
        const text = await file.text();
        const data = JSON.parse(text) as Array<Record<string, unknown>>;
        if (!Array.isArray(data) || !data.length) {
          throw new Error(t("content.jsonMustBeArray"));
        }

        const first = data[0];
        if (first && typeof first.name === "string") {
          // 创作者 JSON → Go 端 MergeWorkshopCreatorsFromJSON
          dropZone.textContent = t("content.mergingCreators");
          const { MergeWorkshopCreatorsFromJSON, LoadWorkshopCreators } = await getApp();
          const result = await MergeWorkshopCreatorsFromJSON(text);
          let added: number, updated: number;
          if (Array.isArray(result)) {
            added = result[0]; updated = result[1];
          } else {
            added = result; updated = 0;
          }
          // 刷新内存中的 allCreators
          const fresh = (await LoadWorkshopCreators()) || [];
          allCreators.length = 0;
          allCreators.push(...(fresh as LocalCreatorLike[]));
          busRef.emit("toast:show", {
            msg: t("content.creatorMergeResult", { added, updated }),
            duration: 3000,
            type: "success",
          });
        } else if (first && typeof first.id === "string" && typeof first.label === "string") {
          // 站点 JSON → 前端合并后调用 SaveWorkshopSites
          dropZone.textContent = t("content.mergingSites");
          const { SaveWorkshopSites } = await getApp();
          const existMap = new Map(allSites.map((s) => [s.id, s]));
          let added = 0, updated = 0;
          data.forEach((s) => {
            const sid = String(s.id);
            if (existMap.has(sid)) {
              Object.assign(existMap.get(sid) as object, s);
              updated++;
            } else {
              existMap.set(sid, s as unknown as WorkshopSite);
              allSites.push(s as unknown as WorkshopSite);
              added++;
            }
          });
          await SaveWorkshopSites(allSites);
          busRef.emit("toast:show", {
            msg: t("content.siteMergeResult", { added, updated }),
            duration: 3000,
            type: "success",
          });
        } else {
          throw new Error(t("content.jsonUnrecognized"));
        }
      } catch (e) {
        busRef.emit("toast:show", {
          msg: "❌ " + friendlyError(e, t("content.importFailed")),
          duration: 4000,
          type: "error",
        });
      } finally {
        resetLabel();
        _refreshView();
      }
    };

    dropZone.addEventListener("dragenter", onDragEnter as EventListener);
    dropZone.addEventListener("dragover", onDragOver);
    dropZone.addEventListener("dragleave", onDragLeave);
    dropZone.addEventListener("drop", onDrop as unknown as EventListener);

    // 收集 cleanup，在组件卸载时移除事件监听，防止泄漏
    return () => {
      dropZone.removeEventListener("dragenter", onDragEnter as EventListener);
      dropZone.removeEventListener("dragover", onDragOver);
      dropZone.removeEventListener("dragleave", onDragLeave);
      dropZone.removeEventListener("drop", onDrop as unknown as EventListener);
    };
  }

  // 无 dropZone 时返回空 cleanup
  return () => {};
}
