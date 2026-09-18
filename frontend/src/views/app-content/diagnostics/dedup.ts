// ===== 诊断页：去重扫描会话工厂（createDedupSession） =====
// ADR-040 按职责切文件：原 init.ts 拆分——日志加载（logs.ts）/ 去重（本文件+三叶）/ 冲突扫描（conflicts.ts）
// 2026-09 锐评 P1 再拆（539 行 → 会话壳 + dedup-types/dedup-scan/dedup-render 三叶，各回 400 行红线内）：
// - dedup-types.ts   类型与默认值
// - dedup-scan.ts    targets 收集 + 逐目录扫描（依赖注入，无会话状态）
// - dedup-render.ts  结果渲染 + 配置面板 + 事件绑定
// 去全局化：原模块级可变全局 _dedupBusy / diagExecBusy / dedupConfig 收敛为会话闭包状态，
// 每会话独立（可 reset、可隔离单测），消除跨调用共享状态的竞态面。

import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { loadResourceRegistry } from "@/services/resource-registry.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import {
  bindCancelButton,
  bindPreviewClicks,
  buildConfigPanel,
  renderResultsHtml,
} from "./dedup-render.ts";
import { collectTargets, scanEachDirectory } from "./dedup-scan.ts";
import type {
  DedupConfigShape,
  DedupRegType,
  FindDuplicateFilesFn,
  GetRepoRootFn,
  MoveToRecycleFn,
  ScanGroupResult,
} from "./dedup-types.ts";
import { DEDUP_DEFAULTS } from "./dedup-types.ts";
import type { EscFn } from "./logs.ts";
import { msgRowHTML, statRowHTML } from "./status-row.ts";

export type { DedupConfigShape } from "./dedup-types.ts";

export interface DedupSession {
  initConfig(list: HTMLElement): void;
  start(list: HTMLElement, esc: EscFn, rtype?: string): Promise<void>;
  getConfig(): Readonly<DedupConfigShape>;
  resetConfig(): void;
}

/**
 * 去重扫描会话。所有可变状态（busy 重入守卫 / exec 重入守卫 / 配置）收进闭包：
 * - 每会话独立，会话间无共享状态，可直接实例化隔离单测
 * - getConfig() 返回冻结快照防外部篡改；resetConfig() 从默认值展开
 */
export function createDedupSession(): DedupSession {
  const state = {
    busy: false, // startDedup 重入守卫：大量 await，快速连点并发扫描会互相覆盖并重复移入回收站
    execBusy: false, // exec 重入守卫：执行期间大量 MoveToRecycle await，重复点击并行二次删除
    config: { ...DEDUP_DEFAULTS } as DedupConfigShape,
  };

  function getConfig(): Readonly<DedupConfigShape> {
    return Object.freeze({
      strategy: state.config.strategy,
      keepPolicy: state.config.keepPolicy,
      priorityPath: state.config.priorityPath,
    });
  }

  function resetConfig(): void {
    Object.assign(state.config, DEDUP_DEFAULTS);
  }

  function initConfig(list: HTMLElement): void {
    buildConfigPanel(list, state.config);
  }

  // ⑤ exec 按钮：逐组 MoveToRecycle + success/fail 统计 + treeReload
  async function runExecDelete(
    list: HTMLElement,
    allResults: ScanGroupResult[],
    MoveToRecycle: MoveToRecycleFn,
    esc: EscFn,
  ): Promise<void> {
    if (state.execBusy) return;
    state.execBusy = true;
    let del = 0,
      fail = 0;
    // 组容器按渲染平铺序与 allResults 的 groups 一一对应（渲染 groupIndex 递增 = 同序）。
    // 逐组在容器内查 :checked，替代按 name="dedup-keep-<gi>" 的全局拼串查询——
    // 组间插入其它控件也不致错位，消除「渲染计数 gi / exec 计数 gi2」双轨对齐依赖。
    const groupEls = Array.from(list.querySelectorAll<HTMLElement>(".diag-dedup-group"));
    let gi = 0;
    try {
      for (const rtResult of allResults) {
        for (const group of rtResult.groups) {
          const files = group.files || [];
          const selEl = groupEls[gi]?.querySelector<HTMLInputElement>(
            'input[type="radio"]:checked',
          );
          const selected = selEl ? parseInt(selEl.value, 10) : 0;
          if (selected !== -1) {
            for (let fi = 0; fi < files.length; fi++) {
              if (fi === selected) continue;
              try {
                await MoveToRecycle(files[fi].path);
                del++;
              } catch {
                fail++;
              }
            }
          }
          gi++;
        }
      }
      if (del > 0) {
        bus.emit("stats:refresh");
        bus.emit("tree:reload");
      }
      list.innerHTML = msgRowHTML(
        fail > 0 ? "warn" : "success",
        t("diagnostics.dedupDone", { del, fail }),
        undefined,
        { icon: UI_ICONS.success },
      );
    } catch (err) {
      list.innerHTML = msgRowHTML("error", `${t("diagnostics.dedupFailed")}: ${esc(String(err))}`);
    } finally {
      state.execBusy = false;
    }
  }

  // ⑤ exec 按钮绑定壳
  function bindExecButton(
    list: HTMLElement,
    allResults: ScanGroupResult[],
    MoveToRecycle: MoveToRecycleFn,
    esc: EscFn,
  ): void {
    list.querySelector("#diag-dedup-exec")?.addEventListener("click", async () => {
      await runExecDelete(list, allResults, MoveToRecycle, esc);
    });
  }

  // ②→③→④→⑤ executeDedupScan 核心协调壳
  async function executeScanCore(
    list: HTMLElement,
    esc: EscFn,
    rtype: string | undefined,
    reg: DedupRegType,
    typeIcon: string,
    typeLabel: string,
    GetRepoRoot: GetRepoRootFn,
    FindDuplicateFiles: FindDuplicateFilesFn,
    MoveToRecycle: MoveToRecycleFn,
  ): Promise<void> {
    // ② targets 收集
    const targets = await collectTargets(rtype, reg, typeIcon, typeLabel, GetRepoRoot);
    if (!targets.length) {
      list.innerHTML = msgRowHTML("error", t("diagnostics.configResourceDir"));
      return;
    }

    // ③ 逐目录扫描
    const { allResults, earlyExit } = await scanEachDirectory(
      targets,
      list,
      esc,
      FindDuplicateFiles,
      getConfig,
    );
    if (earlyExit) return;

    const totalGroups = allResults.reduce((s, r) => s + r.groups.length, 0);
    if (!totalGroups) {
      list.innerHTML =
        '<div class="stat-row diag-msg diag-msg-success" style="justify-content:center">' +
        UI_ICONS.success +
        " " +
        t("diagnostics.noDups") +
        "</div>";
      return;
    }

    // ④ 渲染结果 HTML + 绑定预览/取消
    list.innerHTML = renderResultsHtml(allResults, esc, getConfig());
    bindPreviewClicks(list);
    bindCancelButton(list);

    // ⑤ exec 按钮绑定
    bindExecButton(list, allResults, MoveToRecycle, esc);
  }

  // 编排壳 + 外层 try-catch（异常路径渲染）
  async function executeScan(
    list: HTMLElement,
    esc: EscFn,
    rtype: string | undefined,
    reg: DedupRegType,
    typeIcon: string,
    typeLabel: string,
    GetRepoRoot: GetRepoRootFn,
    FindDuplicateFiles: FindDuplicateFilesFn,
    MoveToRecycle: MoveToRecycleFn,
  ): Promise<void> {
    try {
      await executeScanCore(
        list,
        esc,
        rtype,
        reg,
        typeIcon,
        typeLabel,
        GetRepoRoot,
        FindDuplicateFiles,
        MoveToRecycle,
      );
    } catch (err) {
      list.innerHTML = msgRowHTML("error", `${t("diagnostics.dedupFailed")}: ${esc(String(err))}`);
    }
  }

  /**
   * 去重结果容器统一显式传入（消除 mock root 包装 + 幽灵 id diag-dedup-list）。
   */
  async function start(list: HTMLElement, esc: EscFn, rtype?: string): Promise<void> {
    // ① 重入守卫：busy 命中直接返回；整段包 try/finally，busy 仅在此单点复位
    if (state.busy) return;
    state.busy = true;
    try {
      // ① loadResourceRegistry（early return err）
      let reg: DedupRegType | null = null;
      let typeLabel = "";
      let typeIcon = "📦";
      try {
        reg = await loadResourceRegistry();
        const entry = rtype ? reg[rtype] : undefined;
        const entryName = entry && typeof entry.name === "string" ? entry.name : "";
        const entryIcon = entry && typeof entry.icon === "string" ? entry.icon : "";
        typeLabel = rtype ? entryName || rtype : t("diagnostics.all");
        typeIcon = rtype ? entryIcon || "📦" : "📦";
        list.innerHTML = statRowHTML(
          "muted",
          t("diagnostics.scanHash", { icon: esc(typeIcon), label: esc(typeLabel) }),
        );
      } catch (e) {
        list.innerHTML = statRowHTML(
          "muted",
          friendlyError(e, t("diagnostics.loadResourceTypesFailed")),
          esc,
          { icon: UI_ICONS.error },
        );
        return;
      }

      try {
        const { FindDuplicateFiles, GetRepoRoot, MoveToRecycle } = await backendGetApp();
        await executeScan(
          list,
          esc,
          rtype,
          reg,
          typeIcon,
          typeLabel,
          GetRepoRoot,
          FindDuplicateFiles,
          MoveToRecycle,
        );
      } catch (e) {
        list.innerHTML = statRowHTML(
          "muted",
          friendlyError(e, t("diagnostics.loadDedupConfigFailed")),
          esc,
          { icon: UI_ICONS.error },
        );
      }
    } finally {
      state.busy = false;
    }
  }

  return { initConfig, start, getConfig, resetConfig };
}
