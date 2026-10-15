// ===== 诊断页：基准面板的「简版 / 进阶」参数密度（2026-10-15 锐评改进 P0）=====
// 立因（锐评信息可读性 3/5）：single 一屏同时摊开「目标集 × 排序 × 上限 × 迭代 × 基准三件套」，
// 主 CTA 之外全是同等视觉权重——新手第一次面对的是参数矩阵，而不是「先跑一次基准」。
//
// 三条口径（与本卡既有纪律逐条对齐，不是新发明）：
//  ① **不复制 DOM**：收起 = 加 class，控件本体（#diag-perf-baseline-*）恒为唯一实例，
//     singleBenchRead* 的读取路径与 perf.test.ts 的断言面一字不动。给同一语义配第二个框
//     等于把 ADR-278 刚拆掉的「两份平行 DOM」病养回来。
//  ② **收起的参数不得继续生效**：切回简版时把「记录 / 对比」两个勾选归零。否则
//     singleBenchReadMode 仍会读到 checked=true 并组装 --save-baseline/--baseline——
//     那正是本卡 2026-10-12「看得见、点不动」条目判词的反面变体：
//     「看不见，却还在改这次跑什么」比「没反应」更坏。阈值数字是有意义默认值（50），
//     不参与归零（它单独存在时不改变命令语义，只在两个勾选之一为真时才随参数出去）。
//  ③ 显隐走 class（.perf-density-off），与 .perf-mode-off 同机制、作用对象不重叠：
//     一个表达「哪个基准模式」，一个表达「参数密度」，两判据各自独立，任一判隐即隐藏。
//
// 持久化走 safeGet/safeSet（ADR-044）：隐私模式静默降级为简版（不抛、不弹），
// 与 dedup 配置持久化同一口径。

import { t } from "@/core/i18n/t.ts";
import { safeGet, safeSet } from "@/utils/base/primitives/storage.ts";

/** 密度态：simple = 收起基准三件套（默认），advanced = 展开 */
export type PerfDensity = "simple" | "advanced";

export const PERF_DENSITY_KEY = "diag.perf.density";

/** 收起基准三件套的唯一机制（与 .perf-mode-off 并列的第二个显隐维度） */
const DENSITY_OFF_CLASS = "perf-density-off";

/** 只读扫描：当前是否进阶态（持久化值为准，隐私模式降级简版） */
export function readPerfDensity(): PerfDensity {
  return safeGet(PERF_DENSITY_KEY) === "advanced" ? "advanced" : "simple";
}

/**
 * 应用密度态：翻 class + 改按钮文案/aria-pressed + 收起时归零不可见勾选。
 * 幂等——可重复调用（语言切换重建面板、bench pill 切换重放都走这里）。
 * 文案键随态切换：进阶态说「收起基准选项」，简版态说「基准对比选项」。
 */
export function applyPerfDensity(root: ShadowRoot, density: PerfDensity): void {
  const btn = root.getElementById("diag-perf-density");
  // 特性缺席（旧夹具 / 未渲染密度开关的面板）→ 整体不介入：归零勾选是本模块的越权行为，
  // 没有密度开关就没有「收起」这件事，基准控件该保持它被渲染成什么样子。
  if (!btn) return;
  const advanced = density === "advanced";
  root.querySelectorAll<HTMLElement>('[data-perf-density="advanced"]').forEach((el) => {
    el.classList.toggle(DENSITY_OFF_CLASS, !advanced);
  });
  btn.setAttribute("aria-pressed", String(advanced));
  btn.title = t("diagnostics.perfDensityHint");
  // 只换文字节点——按钮的 SVG 图标由 tpl 静态产出，重放时不得连它一起清掉。
  // 文字节点用 data-perf-density-label 属性（机器可读钩子，同 D12 收口口径：
  // 纯 JS 定位用途不占 class，避开「用了未定义的类」与「定义了无视觉的类」两道 css-layer-check）。
  const label = btn.querySelector("[data-perf-density-label]");
  if (label)
    label.textContent = t(advanced ? "diagnostics.perfDensityLess" : "diagnostics.perfDensityMore");
  if (!advanced) {
    // 收起即失效：不可见的勾选不得参与下一次命令的参数组装
    for (const id of ["diag-perf-baseline-save", "diag-perf-baseline-compare"]) {
      const el = root.getElementById(id) as HTMLInputElement | null;
      if (el?.checked) el.checked = false;
    }
  }
}

/**
 * 接线：装配面板时读持久化态并应用，绑定点击翻转。
 * 返回当前态（调用方可据此决定是否重放其它门禁）。
 * 重复 init 同一 root 不叠监听：按钮节点在语言切换时随 innerHTML 整体重建，
 * 旧监听随旧节点消失，故按节点 dataset 判重即可（同 dedup 会话自管的口径）。
 */
export function initPerfDensity(root: ShadowRoot): PerfDensity {
  const btn = root.getElementById("diag-perf-density");
  const density = readPerfDensity();
  applyPerfDensity(root, density);
  if (!btn || btn.dataset.densityBound === "1") return density;
  btn.dataset.densityBound = "1";
  let current = density;
  btn.addEventListener("click", () => {
    current = current === "advanced" ? "simple" : "advanced";
    safeSet(PERF_DENSITY_KEY, current);
    applyPerfDensity(root, current);
  });
  return current;
}
