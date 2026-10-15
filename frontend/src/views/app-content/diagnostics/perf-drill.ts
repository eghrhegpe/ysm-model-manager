// ===== 诊断页：性能面板 — 阶段→加载剖析下钻（CLI 基准 → 前端实测，跨 tab 缝链）=====
//
// 数据来源（两侧都是既有数据，本模块不新增仪表）：
//   - single-bench（Go CLI 解析一个模型）的 `identity.relPath`
//   - load-trace store（前端 3D 适配器真实加载时写入）的 `path`
//
// 语义诚实红线（2026-10-15 锐评 P1 拍板）：
//   ⚠️ 两个面板测的是**两次独立观测**，不是同一个测量——
//     single-bench 的 7 段（清单读取/JSON 解析/模型扫描/几何/纹理/渲染预估/缓存）是 **Go 段**，
//     load-trace 的 4 段（读取/解析/纹理加载/build）是 **前端段**。
//   阶段名与切法都不同，逐阶段映射是编造对应关系（「CLI 的② JSON 解析 ≈ trace 的解析段」无据可依），
//   故下钻目标 = **同一模型**的前端实测，阶段只是触发上下文，不做假对应。
//
// 另一个必须先说清的缺席事实：single-bench 跑 CLI **不写** trace 记录——trace 只在 3D 预览
// 真实打开该模型时写入。故「无匹配」也是一种结果，必须如实呈现（切到 trace pill + 明说为什么没有），
// 而不是让用户自己去猜「这个面板是不是没数据」。

import { getLoadTraces, type LoadTrace } from "@/preview-3d/infra/load-trace.ts";
import type { EscFn } from "@/utils/html/html.ts";
import { renderLoadTraceSection, type TraceFocus } from "./perf-trace.ts";

/**
 * 下钻的连接键：把 relPath 归一成可比形态（posix 分隔、剥掉开头的 `./` 与 `/`）。
 * 两侧 path 坐标系不统一（single-bench 是仓库相对路径；trace.path 各 adapter 各异——
 * `_modelPath`/`origPath`/URL），故以「尾部路径段」为匹配面，不做字符串全等。
 */
export function benchTraceKey(relPath: string): string {
  return relPath
    .replace(/\\/g, "/")
    .replace(/^(\.\/|\/+)+/, "")
    .trim();
}

/** 尾部匹配（带路径段边界）：`key === hay` 或 `hay` 以 `/key` 结尾。
 *  不加边界会让 `aaa.ysm` 匹配 `xaaa.ysm`（`endsWith` 的经典假命中）。 */
function pathTailMatch(hay: string, key: string): boolean {
  if (hay === key) return true;
  if (!hay.endsWith(key)) return false;
  const cut = hay.length - key.length - 1;
  return cut >= 0 && hay[cut] === "/";
}

/**
 * 在 trace store 里找「同一模型」的记录（纯函数，可单测）。
 *
 * 匹配规则（从严到宽，逐级回退）：
 *   ① 归一化后**全等**（两侧碰巧同坐标系）；
 *   ② 归一化后**尾部匹配**（前端 path 带了仓库根/url 前缀，去掉后尾段即 relPath）。
 *   `format`（rtype 契约字符串）只作**辅判不做硬约束**：同一路径就是同一文件，
 *   rtype 判定可能因历史版本/registry 变更而分叉，用它拦下钻会误伤。
 *   空 relPath 视为无匹配（不编造连接）。
 */
export function matchBenchTrace(
  traces: LoadTrace[],
  relPath: string,
  format?: string,
): LoadTrace | undefined {
  const key = benchTraceKey(relPath);
  if (!key) return undefined;
  const hay = traces
    .map((tr) => ({ tr, h: benchTraceKey(tr.path) }))
    .filter(({ h }) => h && pathTailMatch(h, key));
  if (!hay.length) return undefined;
  // format 辅判：有 format 一致的优先；没有则回落「同路径」首位（不因 format 分叉而空手而归）
  if (format) {
    const byFormat = hay.find(({ tr }) => tr.format === format);
    if (byFormat) return byFormat.tr;
  }
  // 新记录优先（最近的加载 = 用户刚做的事）
  return hay[hay.length - 1]?.tr ?? hay[0]?.tr;
}

/**
 * 阶段→加载剖析下钻：切到 logs 组 trace 子屏，并让 trace 区段聚焦到同一模型。
 *
 * 跳转分两步（都靠既有激活机制，不复制一份显隐逻辑）：
 *   ① 激活顶层 logs tab（bindTabs 的 click 处理激活 + 面板显隐 + dgInBindTraceTab 的重渲染）；
 *   ② 激活 trace pill（bindSubBar 的 click 处理 active 迁移 + 面板显隐 + onSwitch 重渲染）。
 * 最后以本函数显式调用 `renderLoadTraceSection(root, esc, focus)` 收尾，确保聚焦态是最终态
 * （前两步的 click 可能已触发无 focus 的重渲染，被这一步覆盖，幂等无害）。
 *
 * ⚠️ 未匹配也必须跳：它是「该模型前端侧未实测」的**呈现路径**，不是失败。
 */
export function drillBenchToTrace(
  root: ShadowRoot,
  esc: EscFn,
  relPath: string,
  format?: string,
): void {
  const logsTab = root.querySelector<HTMLElement>('.repo-tab[data-tab="logs"]');
  if (logsTab && !logsTab.classList.contains("active")) logsTab.click();
  const tracePill = root.querySelector<HTMLElement>(
    '.diag-sub-bar[data-sub-bar="logs"] .diag-sub-tab[data-sub="trace"]',
  );
  if (tracePill && !tracePill.classList.contains("active")) tracePill.click();

  const hit = matchBenchTrace(getLoadTraces(), relPath, format);
  const focus: TraceFocus = hit ? { path: hit.path } : { miss: benchTraceKey(relPath) };
  renderLoadTraceSection(root, esc, focus);
}

/**
 * 下钻按钮的**结果容器委托**（`#diag-perf-single`）：`single-bench` 每次跑完 `innerHTML`
 * 整块重渲染，若在渲染后逐次绑定会让监听随结果累积；委托一次、按 `[data-drill-trace]`
 * 命中即调 `drillBenchToTrace`（与 `bindPerfCopyHandlers` 的复制委托同构）。
 *
 * 按钮只读它自己的 `data-drill-*`（identity 已在渲染时落到 DOM），不反向去读载荷。
 */
export function bindPerfDrillHandler(root: ShadowRoot, esc: EscFn): void {
  root.getElementById("diag-perf-single")?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-drill-trace]");
    if (!btn) return;
    const path = btn.dataset.drillPath?.trim() ?? "";
    if (!path) return; // 无身份不下钻（不编造连接，同 matchBenchTrace 空键口径）
    drillBenchToTrace(root, esc, path, btn.dataset.drillFormat || undefined);
  });
}
