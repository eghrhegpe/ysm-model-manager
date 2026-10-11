// ===== 后处理链 MSAA 采样数单一事实源（2026-10-11 F4 收口）=====
// 双源历史：postproc-cost-probe.ts 的 DEFAULT_MSAA_SAMPLES 与
// postprocessing-capability.ts 的 POSTPROC_MSAA_SAMPLES 各自硬编码 4——改一侧即静默
// 报错（探针报告核心数字 rtBytes* 与 cap 实际渲染采样分叉，见 tracker infra 轮 F4）。
// 现下沉 infra 叶层单源：cap 属上层可 import infra（既有先例 postprocessing.ts /
// render-budget.ts），probe 与 cap 同指本值，双源在结构上不可表达。
/** composer 读/写缓冲的 MSAA 采样数（与 renderer 的 antialias 意图对齐；WebGL2 下才生效） */
export const POSTPROC_MSAA_SAMPLES = 4;
