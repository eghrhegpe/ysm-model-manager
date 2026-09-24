// ===== 高级筛选弹窗（类型化版 — ADR-014 P3 dialogs）=====
// 多字段（关键字 + 骨骼/立方体/纹理 范围）
// 风格与 modal.js 一致（dlg-overlay/dlg-box）
// 样式：.afv-inp 已提取到 frontend/css/components.css（避免重复注入 <style>）
// 后端约束：当前 Go SearchModels 只支持 (minBones, maxBones, minCubes, maxCubes, minTex, maxTex) 6 个范围 + 1 个关键字；
//   不支持文件大小、排序（避免展示无效控件）
// ADR-190 D2 注入真化 + ADR-208 D1（R5 门禁）：生产默认 getApp 经 backend-deps seam 单出口
// ADR-190 D1a / R8 销账：表单 HTML 模板已外移 views/app-tree/tpl-adv-filter.ts，经 opts.tpl 注入

import { t } from "@/core/i18n/t.ts";
import { createDialog } from "@/utils/dom/modal-core.ts";
import { type AdvFilterValue, parseFilterNumber, validateAdvFilter } from "./adv-filter-util.ts";
import { dialogsGetApp } from "./dialogs-deps.ts";

type GetAppFn = typeof dialogsGetApp;

export type { AdvFilterValue } from "./adv-filter-util.ts";

export type AdvFilterResult = AdvFilterValue | { cleared: true } | null;

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

/**
 * DOM 模板注入契约（ADR-190 D1a：DOM 模板归 views，组合根注入；features 不自渲染。
 * 先例 BatchRenameTpl / RecycleDeps.renderListHtml）。
 * views/app-tree/tpl-adv-filter.ts 提供实现。
 */
export interface AdvFilterTpl {
  /** 弹窗内容区表单（标题行由 createDialog 统一渲染 — ADR-190 D3；样式全部走 components.css） */
  formHTML: (v: Partial<AdvFilterValue>) => string;
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

/**
 * 弹出高级筛选弹窗
 * @param opts.value 初始值（预填 vm 已应用态）
 * @param opts.tpl DOM 模板（ADR-190 D1a，组合根注入 advFilterTpl）
 * @returns 筛选条件对象，取消返回 null；清除时返回 { cleared: true }
 */
export function modalAdvFilter(opts: {
  value?: Partial<AdvFilterValue>;
  /** DOM 模板注入（ADR-190 D1a）：组合根传 views/app-tree/tpl-adv-filter.ts 的 advFilterTpl，features 无默认模板 */
  tpl: AdvFilterTpl;
  /** 依赖注入（ADR-190 D2）：测试可注入 getApp 替身，缺省走生产实现 */
  getApp?: GetAppFn;
}): Promise<AdvFilterResult> {
  return new Promise((resolve) => {
    const v = opts.value || {};
    const { overlay, box, close } = createDialog<AdvFilterResult>({
      title: t("dialog.advFilter"),
      titleIcon: "settings",
      width: "var(--dlg-width-sm)",
      boxClass:
        "dlg-box dlg-pad dlg-gap-lg" /* 审计 P1-1：宽收口 --dlg-width-sm（420px），与 .dlg-box（640px）解耦 */,
      tabIndex: 0,
      cancelValue: null,
      resolve,
      buildBox: (el) => {
        el.innerHTML = opts.tpl.formHTML(v);
      },
    });

    const kwInput = box.querySelector("#afv-kw") as HTMLInputElement;
    const tagInput = box.querySelector("#afv-tag") as HTMLInputElement;
    bindAdvFilterEvents(
      overlay,
      box,
      close,
      () => advFilterCollect(box, kwInput, tagInput),
      opts.getApp || dialogsGetApp,
    );
  });
}
