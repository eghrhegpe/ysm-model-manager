// ===== 高级筛选弹窗（类型化版 — ADR-014 P3 dialogs）=====
// 多字段（关键字 + 骨骼/立方体/纹理 范围）
// 风格与 modal.js 一致（dlg-overlay/dlg-box）
// 样式：.afv-inp 已提取到 frontend/css/components.css（避免重复注入 <style>）
// 后端约束：当前 Go SearchModels 只支持 (minBones, maxBones, minCubes, maxCubes, minTex, maxTex) 6 个范围 + 1 个关键字；
//   不支持文件大小、排序（避免展示无效控件）
// ADR-190 D2 注入真化 + ADR-208 D1（R5 门禁）：生产默认 getApp 经 backend-deps seam 单出口

import { t } from "@/core/i18n/t.ts";
import { backendGetApp } from "@/features/backend-deps.ts";
import { esc } from "@/utils/html/html.ts";
import { type AdvFilterValue, parseFilterNumber, validateAdvFilter } from "./adv-filter-util.ts";
import { createDialog } from "./modal-core.ts";

type GetAppFn = typeof backendGetApp;

export type { AdvFilterValue } from "./adv-filter-util.ts";

export type AdvFilterResult = AdvFilterValue | { cleared: true } | null;

/**
 * 弹出高级筛选弹窗
 * @param opts 初始值
 * @returns 筛选条件对象，取消返回 null；清除时返回 { cleared: true }
 */
/** 收集弹窗输入 → AdvFilterValue（骨骼/立方体/纹理 数字解析 + 关键字/标签去空格） */
function advFilterCollect(
  box: HTMLDivElement,
  kwInput: HTMLInputElement,
  tagInput: HTMLInputElement,
): AdvFilterValue {
  return {
    keyword: kwInput.value.trim(),
    minBones: parseFilterNumber(
      (box.querySelector("#afv-minBones") as HTMLInputElement)?.value ?? "",
    ),
    maxBones: parseFilterNumber(
      (box.querySelector("#afv-maxBones") as HTMLInputElement)?.value ?? "",
    ),
    minCubes: parseFilterNumber(
      (box.querySelector("#afv-minCubes") as HTMLInputElement)?.value ?? "",
    ),
    maxCubes: parseFilterNumber(
      (box.querySelector("#afv-maxCubes") as HTMLInputElement)?.value ?? "",
    ),
    minTex: parseFilterNumber((box.querySelector("#afv-minTex") as HTMLInputElement)?.value ?? ""),
    maxTex: parseFilterNumber((box.querySelector("#afv-maxTex") as HTMLInputElement)?.value ?? ""),
    tag: tagInput.value.trim(),
  };
}

/** 渲染弹窗表单 HTML（纯函数，无 DOM 副作用；标题行由 createDialog 统一渲染 — ADR-190 D3；样式全部走 components.css） */
function buildAdvFilterFormHTML(v: Partial<AdvFilterValue>): string {
  return `
      <div class="afv-form">
        <div>
          <label for="afv-kw" class="afv-label">🔍 ${t("dialog.keyword")}</label>
          <input id="afv-kw" class="afv-input-kw" maxlength="100" value="${esc(v.keyword || "")}" placeholder="${t("dialog.matchAll")}">
        </div>

        <div class="afv-grid">
          <div>
            <label for="afv-minBones" class="afv-label">🦴 ${t("dialog.bones")}</label>
            <div class="afv-range-row">
              <input id="afv-minBones" type="number" min="0" value="${esc(String(v.minBones ?? ""))}" placeholder="${t("dialog.min")}" class="afv-inp">
              <span class="afv-sep">—</span>
              <input id="afv-maxBones" type="number" min="0" value="${esc(String(v.maxBones ?? ""))}" placeholder="${t("dialog.max")}" aria-label="${t("dialog.bones")} ${t("dialog.max")}" class="afv-inp">
            </div>
          </div>
          <div>
            <label for="afv-minCubes" class="afv-label">🧊 ${t("dialog.cubes")}</label>
            <div class="afv-range-row">
              <input id="afv-minCubes" type="number" min="0" value="${esc(String(v.minCubes ?? ""))}" placeholder="${t("dialog.min")}" class="afv-inp">
              <span class="afv-sep">—</span>
              <input id="afv-maxCubes" type="number" min="0" value="${esc(String(v.maxCubes ?? ""))}" placeholder="${t("dialog.max")}" aria-label="${t("dialog.cubes")} ${t("dialog.max")}" class="afv-inp">
            </div>
          </div>
        </div>

        <div>
          <label for="afv-minTex" class="afv-label">🖼 ${t("dialog.textureSize")}</label>
          <div class="afv-range-row">
            <input id="afv-minTex" type="number" min="0" value="${esc(String(v.minTex ?? ""))}" placeholder="${t("dialog.min")}" class="afv-inp">
            <span class="afv-sep">—</span>
            <input id="afv-maxTex" type="number" min="0" value="${esc(String(v.maxTex ?? ""))}" placeholder="${t("dialog.max")}" aria-label="${t("dialog.textureSize")} ${t("dialog.max")}" class="afv-inp">
          </div>
        </div>

        <div>
          <label for="afv-tag" class="afv-label">🏷️ ${t("dialog.tags")}</label>
          <div class="afv-range-row">
            <input id="afv-tag" maxlength="30" value="${esc(v.tag || "")}" placeholder="${t("dialog.tagPlaceholder")}" class="afv-inp">
            <span id="afv-tag-hint" class="afv-tag-hint"></span>
          </div>
        </div>
      </div>

      <div id="afv-err" class="dlg-err"></div>

      <div class="dlg-footer afv-footer">
        <button id="afv-clear" class="dlg-btn afv-clear">🧹 ${t("dialog.clearAll")}</button>
        <button id="afv-cancel" class="dlg-btn">${t("dialog.cancelEsc")}</button>
        <button id="afv-ok" class="dlg-btn dlg-btn-primary">🔍 ${t("dialog.applyEnter")}</button>
      </div>
    `;
}

/** 绑定弹窗交互：清除/取消/应用/Enter + 已有标签提示异步加载 */
function bindAdvFilterEvents(
  overlay: HTMLElement,
  box: HTMLDivElement,
  close: (r: AdvFilterResult) => void,
  getValue: () => AdvFilterValue,
  getApp: GetAppFn,
): void {
  const kwInput = box.querySelector("#afv-kw") as HTMLInputElement;
  kwInput.focus();

  const tagHint = box.querySelector("#afv-tag-hint") as HTMLElement;

  // 异步加载已有标签提示
  (async () => {
    try {
      const App = await getApp();
      const all = (await App.AllTags()) || [];
      // 弹窗已关闭（Esc/单例槽位替换）后不再写已卸载 DOM
      if (!overlay.isConnected) return;
      if (all?.length) {
        tagHint.textContent = t("dialog.existingTagsHint", {
          tags: all.join(", "),
        });
      }
    } catch (e) {
      // 提示属可选功能：留痕但不打扰用户
      console.warn("[adv-filter] 标签提示加载失败:", e);
    }
  })();

  const errEl = box.querySelector("#afv-err") as HTMLElement;

  (box.querySelector("#afv-cancel") as HTMLElement).onclick = (): void => close(null);
  (box.querySelector("#afv-clear") as HTMLElement).onclick = (): void => close({ cleared: true });
  (box.querySelector("#afv-ok") as HTMLElement).onclick = (): void => {
    const data = getValue();
    const err = validateAdvFilter(data);
    if (err) {
      errEl.textContent = `⚠️ ${t(err)}`;
      return;
    }
    close(data);
  };

  // Enter 提交（任意输入框）
  const allInputs = box.querySelectorAll("input");
  allInputs.forEach((el) => {
    el.addEventListener("keydown", (e: KeyboardEvent): void => {
      if (e.key === "Enter") {
        const data = getValue();
        const err = validateAdvFilter(data);
        if (err) {
          errEl.textContent = `⚠️ ${t(err)}`;
          return;
        }
        close(data);
      }
    });
  });
}

export function modalAdvFilter(
  opts: {
    value?: Partial<AdvFilterValue>;
    /** 依赖注入（ADR-190 D2）：测试可注入 getApp 替身，缺省走生产实现 */
    getApp?: GetAppFn;
  } = {},
): Promise<AdvFilterResult> {
  return new Promise((resolve) => {
    const v = opts.value || {};
    const { overlay, box, close } = createDialog<AdvFilterResult>({
      title: t("dialog.advFilter"),
      icon: "⚙️",
      width: "420px",
      boxClass: "dlg-box dlg-pad dlg-gap-lg",
      tabIndex: 0,
      cancelValue: null,
      resolve,
      buildBox: (el) => {
        el.innerHTML = buildAdvFilterFormHTML(v);
      },
    });

    const kwInput = box.querySelector("#afv-kw") as HTMLInputElement;
    const tagInput = box.querySelector("#afv-tag") as HTMLInputElement;
    bindAdvFilterEvents(
      overlay,
      box,
      close,
      () => advFilterCollect(box, kwInput, tagInput),
      opts.getApp || backendGetApp,
    );
  });
}
