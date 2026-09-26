// ===== 去重扫描：targets 收集 + 逐目录扫描（2026-09 锐评 P1 自 dedup.ts 拆出）=====
// ②③ 段：依赖注入、无会话状态——collectTargets(rtype单目录/全类型遍历)、
// scanEachDirectory（progress 占位 + err 判别 {error} 假绿）。

import { t } from "@/core/i18n/t.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import type {
  DedupRegType,
  FindDuplicateFilesFn,
  GetRepoRootFn,
  ScanGroupResult,
  ScanTarget,
} from "./dedup-types.ts";
import type { EscFn } from "./logs.ts";
import { statRowHTML } from "./status-row.ts";

/** ② targets收集(rtype单目录/全类型遍历)（依赖注入，无会话状态） */
export async function collectTargets(
  rtype: string | undefined,
  reg: DedupRegType,
  typeIcon: string,
  typeLabel: string,
  GetRepoRoot: GetRepoRootFn,
): Promise<ScanTarget[]> {
  const targets: ScanTarget[] = [];
  if (rtype && rtype !== "all") {
    const dir = await GetRepoRoot(rtype);
    if (dir) targets.push({ id: rtype, icon: typeIcon, label: typeLabel, dir });
  } else {
    for (const rt of Object.values(reg)) {
      const dir = await GetRepoRoot(rt.id);
      if (dir) {
        const rtName = typeof rt.name === "string" ? rt.name : rt.id;
        const rtIcon = typeof rt.icon === "string" ? rt.icon : "📦";
        targets.push({ id: rt.id, icon: rtIcon, label: rtName, dir });
      }
    }
  }
  return targets;
}

/** ③ 逐目录 FindDuplicateFiles 扫描（progress占位 + err判别；strategy token 直传，锐评①收口） */
export async function scanEachDirectory(
  targets: ScanTarget[],
  list: HTMLElement,
  esc: EscFn,
  FindDuplicateFiles: FindDuplicateFilesFn,
  strategy: string,
): Promise<{ allResults: ScanGroupResult[]; earlyExit: boolean }> {
  const allResults: ScanGroupResult[] = [];
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    list.innerHTML = statRowHTML(
      "muted",
      t("diagnostics.scanningProgress", {
        cur: i + 1,
        total: targets.length,
        icon: esc(target.icon),
        label: esc(target.label),
      }),
    );
    await new Promise((r) => setTimeout(r, 10));
    const groups = await FindDuplicateFiles(target.dir, strategy);
    if (!groups) {
      // Go 成功路径恒返回非 nil（无重复 = 空数组，go/dedup/dedup.go result 起步即 []Group{}，
      // 契约锁 internal/app TestFindDuplicateFiles_NoDupNilFree）——null 只可能是绑定层
      // 结构异常，按扫描失败显式报错。此前手拼的 {reason:"扫描返回空"} 既写死中文又被
      // t() 静默吞参（scanFailed 键无占位符），双重无意义。
      list.innerHTML =
        '<div class="stat-row diag-msg diag-msg-error" style="justify-content:center">' +
        UI_ICONS.error +
        " " +
        t("diagnostics.scanFailed") +
        "</div>";
      return { allResults, earlyExit: true };
    }
    if (groups.length)
      allResults.push({
        icon: target.icon,
        label: target.label,
        groups: groups.map((g) => ({
          files: (g.files || []).map((f) => ({
            path: f.path,
            name: f.name,
            size: f.size,
            ...(f.modTime ? { modTime: new Date(f.modTime).toISOString() } : {}),
          })),
        })),
      });
  }
  return { allResults, earlyExit: false };
}
