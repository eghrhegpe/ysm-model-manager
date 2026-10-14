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
import { isGeometrySearchableRtype, rtypeLabelOf } from "@/utils/resource/types.ts";
import { type AdvFilterValue, parseFilterNumber, validateAdvFilter } from "./adv-filter-util.ts";
import { dialogsGetApp } from "./dialogs-deps.ts";

type GetAppFn = typeof dialogsGetApp;

export type { AdvFilterValue } from "./adv-filter-util.ts";

export type AdvFilterResult = AdvFilterValue | { cleared: true } | null;

/** 数值条件 6 输入框 id（geometrySearchable 门控的禁用/归零目标；与模板 #afv-* 编号同源） */
const NUMERIC_INPUT_IDS = [
  "#afv-minBones",
  "#afv-maxBones",
  "#afv-minCubes",
  "#afv-maxCubes",
  "#afv-minTex",
  "#afv-maxTex",
] as const;

/** 收集弹窗输入 → AdvFilterValue（骨骼/立方体/纹理 数字解析 + 关键字/标签去空格）
 * @param ignoreNumeric 数值区被门控禁用时传 true——数值字段一律归 null（「用不了就不带走」：
 *  旧数值若带进 SearchModels 会被 BoneCount==0 静默排除整类条目，归 null 才是可见语义） */
function advFilterCollect(
  box: HTMLDivElement,
  kwInput: HTMLInputElement,
  tagInput: HTMLInputElement,
  ignoreNumeric = false,
): AdvFilterValue {
  const num = (id: string): number | null =>
    ignoreNumeric
      ? null
      : parseFilterNumber((box.querySelector(id) as HTMLInputElement)?.value ?? "");
  return {
    keyword: kwInput.value.trim(),
    minBones: num("#afv-minBones"),
    maxBones: num("#afv-maxBones"),
    minCubes: num("#afv-minCubes"),
    maxCubes: num("#afv-maxCubes"),
    minTex: num("#afv-minTex"),
    maxTex: num("#afv-maxTex"),
    tag: tagInput.value.trim(),
  };
}

/** 数值区门控（2026-10-14 锐评 P1 修复 A 案）：当前 rtype 无几何分析管线（registry
 *  geometrySearchable 声明）时——禁用 6 数值输入 + 显示提示行。展示端门控，判据同源注册表。 */
function gateNumericSection(box: HTMLElement, rtype: string): void {
  for (const id of NUMERIC_INPUT_IDS) {
    const inp = box.querySelector(id) as HTMLInputElement | null;
    if (inp) inp.disabled = true;
  }
  const hint = box.querySelector("#afv-numeric-hint") as HTMLElement | null;
  if (hint) {
    hint.textContent = t("tree.advFilterNumericUnsupported", { type: rtypeLabelOf(rtype) });
    hint.hidden = false;
  }
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
 * @param opts.rtype 当前树资源类型——无几何管线的类型（registry geometrySearchable 声明）
 *  数值区禁用 + 提示 + 数值字段归零（2026-10-14 锐评 P1 修复 A 案）；缺省（旧调用方）行为不变
 * @returns 筛选条件对象，取消返回 null；清除时返回 { cleared: true }
 */
export function modalAdvFilter(opts: {
  value?: Partial<AdvFilterValue>;
  /** DOM 模板注入（ADR-190 D1a）：组合根传 views/app-tree/tpl-adv-filter.ts 的 advFilterTpl，features 无默认模板 */
  tpl: AdvFilterTpl;
  /** 依赖注入（ADR-190 D2）：测试可注入 getApp 替身，缺省走生产实现 */
  getApp?: GetAppFn;
  /** 当前树资源类型（数值区展示门控；缺省 = 不门控，兼容旧调用方） */
  rtype?: string;
}): Promise<AdvFilterResult> {
  return new Promise((resolve) => {
    const rawV = opts.value || {};
    const rtype = opts.rtype;
    // 数值区门控判定：无几何管线的类型——预填数值一并剥掉（禁用态下展示陈旧数值徒增困惑，
    // 且 collect 会归零，展示与提交口径保持同一真相）
    const numericGated = !!rtype && !isGeometrySearchableRtype(rtype);
    const v: Partial<AdvFilterValue> = numericGated
      ? {
          ...rawV,
          minBones: null,
          maxBones: null,
          minCubes: null,
          maxCubes: null,
          minTex: null,
          maxTex: null,
        }
      : rawV;
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
        // numericGated 蕴含 rtype 非空（窄化守卫，免非空断言）
        if (numericGated && rtype) gateNumericSection(el, rtype);
      },
    });

    const kwInput = box.querySelector("#afv-kw") as HTMLInputElement;
    const tagInput = box.querySelector("#afv-tag") as HTMLInputElement;
    bindAdvFilterEvents(
      overlay,
      box,
      close,
      () => advFilterCollect(box, kwInput, tagInput, numericGated),
      opts.getApp || dialogsGetApp,
    );
  });
}
