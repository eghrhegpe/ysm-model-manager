// ===== 高级筛选弹窗（类型化版 — ADR-014 P3 dialogs）=====
// 多字段（关键字 + 骨骼/立方体/纹理 范围）
// 风格与 modal.js 一致（dlg-overlay/dlg-box）
// 样式：.afv-inp 已提取到 frontend/css/components.css（避免重复注入 <style>）
// 后端约束：当前 Go SearchModels 只支持 (minBones, maxBones, minCubes, maxCubes, minTex, maxTex) 6 个范围 + 1 个关键字；
//   不支持文件大小、排序（避免展示无效控件）
import { esc } from "../html.ts";
import { closeDlg, registerDlg, trapFocus } from "./modal.ts";
import { getApp } from "../../../backend/app.ts";
import { t } from "../../../core/i18n/t.ts";
import {
  parseFilterNumber,
  validateAdvFilter,
  type AdvFilterValue,
} from "./adv-filter-util.ts";

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
    minTex: parseFilterNumber(
      (box.querySelector("#afv-minTex") as HTMLInputElement)?.value ?? "",
    ),
    maxTex: parseFilterNumber(
      (box.querySelector("#afv-maxTex") as HTMLInputElement)?.value ?? "",
    ),
    tag: tagInput.value.trim(),
  };
}

/** 渲染弹窗表单 HTML（纯函数，无 DOM 副作用） */
function buildAdvFilterFormHTML(v: Partial<AdvFilterValue>): string {
  return `
      <div class="dlg-title" style="margin:0">⚙️ ${t("dialog.advFilter")}</div>

      <div style="display:flex;flex-direction:column;gap:8px;font-size:11px">
        <div>
          <label style="display:block;color:var(--muted);margin-bottom:3px">🔍 ${t("dialog.keyword")}</label>
          <input id="afv-kw" maxlength="100" value="${esc(v.keyword || "")}" placeholder="${t("dialog.matchAll")}" style="width:100%;padding:5px 8px;border-radius:5px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);font-size:11px;box-sizing:border-box">
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div>
            <label style="display:block;color:var(--muted);margin-bottom:3px">🦴 ${t("dialog.bones")}</label>
            <div style="display:flex;gap:4px;align-items:center">
              <input id="afv-minBones" type="number" min="0" value="${esc(String(v.minBones ?? ""))}" placeholder="${t("dialog.min")}" class="afv-inp" style="flex:1;width:0;min-width:0">
              <span style="color:var(--muted)">—</span>
              <input id="afv-maxBones" type="number" min="0" value="${esc(String(v.maxBones ?? ""))}" placeholder="${t("dialog.max")}" class="afv-inp" style="flex:1;width:0;min-width:0">
            </div>
          </div>
          <div>
            <label style="display:block;color:var(--muted);margin-bottom:3px">🧊 ${t("dialog.cubes")}</label>
            <div style="display:flex;gap:4px;align-items:center">
              <input id="afv-minCubes" type="number" min="0" value="${esc(String(v.minCubes ?? ""))}" placeholder="${t("dialog.min")}" class="afv-inp" style="flex:1;width:0;min-width:0">
              <span style="color:var(--muted)">—</span>
              <input id="afv-maxCubes" type="number" min="0" value="${esc(String(v.maxCubes ?? ""))}" placeholder="${t("dialog.max")}" class="afv-inp" style="flex:1;width:0;min-width:0">
            </div>
          </div>
        </div>

        <div>
          <label style="display:block;color:var(--muted);margin-bottom:3px">🖼 ${t("dialog.textureSize")}</label>
          <div style="display:flex;gap:4px;align-items:center">
            <input id="afv-minTex" type="number" min="0" value="${esc(String(v.minTex ?? ""))}" placeholder="${t("dialog.min")}" class="afv-inp" style="flex:1;width:0;min-width:0">
            <span style="color:var(--muted)">—</span>
            <input id="afv-maxTex" type="number" min="0" value="${esc(String(v.maxTex ?? ""))}" placeholder="${t("dialog.max")}" class="afv-inp" style="flex:1;width:0;min-width:0">
          </div>
        </div>

        <div>
          <label style="display:block;color:var(--muted);margin-bottom:3px">🏷️ ${t("dialog.tags")}</label>
          <div style="display:flex;gap:4px;align-items:center">
            <input id="afv-tag" maxlength="30" value="${esc(v.tag || "")}" placeholder="${t("dialog.tagPlaceholder")}" class="afv-inp" style="flex:1;width:0;min-width:0">
            <span id="afv-tag-hint" style="font-size:9px;color:var(--muted);white-space:nowrap"></span>
          </div>
        </div>
      </div>

      <div id="afv-err" class="dlg-err"></div>

      <div class="dlg-footer" style="padding:0;display:flex;gap:6px">
        <button id="afv-clear" class="dlg-btn" style="margin-right:auto">🧹 ${t("dialog.clearAll")}</button>
        <button id="afv-cancel" class="dlg-btn">${t("dialog.cancelEsc")}</button>
        <button id="afv-ok" class="dlg-btn dlg-btn-primary">🔍 ${t("dialog.applyEnter")}</button>
      </div>
    `;
}

/** 绑定弹窗交互：清除/取消/应用/Enter + 已有标签提示异步加载 */
function bindAdvFilterEvents(
  overlay: HTMLDivElement,
  box: HTMLDivElement,
  resolve: (r: AdvFilterResult) => void,
  getValue: () => AdvFilterValue,
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

  const close = (result: AdvFilterResult): void =>
    closeDlg(overlay, resolve, result);

  (box.querySelector("#afv-cancel") as HTMLElement).onclick = (): void =>
    close(null);
  (box.querySelector("#afv-clear") as HTMLElement).onclick = (): void =>
    closeDlg(overlay, resolve, { cleared: true });
  (box.querySelector("#afv-ok") as HTMLElement).onclick = (): void => {
    const data = getValue();
    const err = validateAdvFilter(data);
    if (err) {
      errEl.textContent = "⚠️ " + t(err);
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
          errEl.textContent = "⚠️ " + t(err);
          return;
        }
        close(data);
      }
    });
  });
}

export function modalAdvFilter(opts: { value?: Partial<AdvFilterValue> } = {}): Promise<AdvFilterResult> {
  return new Promise((resolve) => {
    const v = opts.value || {};
    const overlay = document.createElement("div");
    overlay.className = "dlg-overlay";
    overlay.onclick = (e: MouseEvent): void => {
      if (e.target === overlay) closeDlg(overlay, resolve, null);
    };
    overlay.addEventListener("keydown", (e: KeyboardEvent): void => {
      if (e.key === "Escape") closeDlg(overlay, resolve, null);
    });

    const box = document.createElement("div");
    box.className = "dlg-box dlg-pad";
    box.style.gap = "10px";
    box.style.width = "420px";
    box.innerHTML = buildAdvFilterFormHTML(v);

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    registerDlg(overlay, () => closeDlg(overlay, resolve, null));
    trapFocus(overlay); // #3：Tab 焦点锁在弹窗内，防逃逸到背后页面（修复陷阱 #14 变体）

    const kwInput = box.querySelector("#afv-kw") as HTMLInputElement;
    const tagInput = box.querySelector("#afv-tag") as HTMLInputElement;
    bindAdvFilterEvents(
      overlay,
      box,
      resolve,
      () => advFilterCollect(box, kwInput, tagInput),
    );
  });
}
