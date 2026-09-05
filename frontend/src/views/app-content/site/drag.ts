// ===== 站点视图拖拽 JSON 导入（从 site-view.ts 拆出，ADR-034 方向①）=====

import { getApp } from "../../../backend/app.ts";
import { t } from "../../../core/i18n/t.ts";
import { friendlyError } from "../../../utils/dom/errors.ts";
import type { WorkshopSite } from "../../../utils/types-re-export.ts";
import type { LocalCreatorLike } from "../site-view.ts";
import type { CleanupFn, SiteViewState } from "./types.ts";

/**
 * 合并结果归一化：Go/Wails 绑定按 (added, updated) 双值返回时解构元组，
 * 旧单值形态（仅 added）兜底 updated=0——兼容两种返回形态，两分支复用
 *（code_review 0d454160 #9：原创作者/站点分支逐字重复，提取公共 helper）。
 */
function normalizeMergeCounts(result: [number, number] | number): {
  added: number;
  updated: number;
} {
  if (Array.isArray(result)) {
    return { added: result[0], updated: result[1] };
  }
  return { added: result, updated: 0 };
}

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
      if (!file?.name.endsWith(".json")) {
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
          '<span class="cr-drop-text">' +
          t("content.dropZoneHint") +
          "</span>";
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
          const { added, updated } = normalizeMergeCounts(result as [number, number] | number);
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
          // 站点 JSON → Go 端 MergeWorkshopSitesFromJSON（镜像创作者分支，收口双轨）：
          // 合并/去重/写回下沉 Go，前端只传原始 JSON + 用 DefaultWorkshopSites 刷新内存。
          dropZone.textContent = t("content.mergingSites");
          const { MergeWorkshopSitesFromJSON, DefaultWorkshopSites } = await getApp();
          const result = await MergeWorkshopSitesFromJSON(text);
          const { added, updated } = normalizeMergeCounts(result as [number, number] | number);
          // 刷新内存中的 allSites（DefaultWorkshopSites 读用户配置优先——Go 已落盘合并结果）
          const fresh = await DefaultWorkshopSites();
          // null/空守卫：合并已落盘但刷新源异常（binding 缺实现/返回 null）时不得把
          // 视图清空成静默假成功——抛错进 catch 走「导入失败」反馈，保现有列表
          //（code_review 0d454160 #8：`|| []` 会在 null 时把整个站点列表清空）
          if (!Array.isArray(fresh) || fresh.length === 0) {
            throw new Error(t("content.refreshSitesFailed"));
          }
          allSites.length = 0;
          allSites.push(...(fresh as WorkshopSite[]));
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
          msg: `❌ ${friendlyError(e, t("content.importFailed"))}`,
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
