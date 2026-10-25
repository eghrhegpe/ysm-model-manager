/**
 * gate-tool-types.ts — 静态工具清单的**类型层**（GateTool 判别联合 + 债元数据内核）。
 *
 * 从 gate-config.ts 沿真缝拆出（ADR-234 D3 `_lib` 400 行硬红线，2026-10-25）：
 * 清单数据（各域表）与「条目长什么样」是两个关注点——类型与 `debt()` 内核被
 * 五张清单共用，且新增闸目**从不改它**；清单表则随接入不断增长。拆开后：
 *   · 新增/删除闸目只动 `gate-config.ts` 或对应域文件，行数压力不再集中在单文件；
 *   · 并行会话按域各改各的（docs / go / frontend），提交冲突面同步收敛。
 *
 * **零行为变更**：本文件内容逐字搬移，导出名与签名不变；gate-config.ts 原样
 * re-export，消费方 import 路径无需改动。
 *
 * 依赖：./gate-debt.ts（GateDebt 元数据类型，零依赖纯函数模块）
 */
import type { GateDebt } from "./gate-debt.ts";

/**
 * 存量债复审默认截止日（2026-10-09 到期制落地）。
 * `blockPolicy: "debt"` 的条目必须带 `debt: { reason, reviewBy }`；此处两档是排期默认值：
 *   - LEDGER：棘轮账本型（knip/jscpd/复杂度/令牌/死键）——量大、需排期回收；
 *   - OBSERVE：信号未验证的观察型（注释考古/孪生探针/时长口径）——一轮内应出结论。
 * 到期未处置 = `doctor --all` 红灯，逼一次显式决策（改硬 / 修 / 带理由续期），详见 gate-debt.ts。
 */
export const REVIEW_BY_LEDGER = "2026-11-08";
export const REVIEW_BY_OBSERVE = "2026-11-15";

/** 声明一条存量债：reason 必填（禁无理由债务），reviewBy 缺省走账本档排期。 */
export const debt = (reason: string, reviewBy: string = REVIEW_BY_LEDGER): GateDebt => ({
  reason,
  reviewBy,
});

/**
 * 阻断策略：控制 record() 是否因 FAIL 置 blocked=true。
 *   hard        FAIL → 阻断（默认，隐式）
 *   debt        FAIL → 只记录，不阻断（债务类，推送后修）
 *   failClosed  FAIL → 只记录，不阻断；仅工具本身不可用（如 rg 缺失）才阻断——
 *               由调用方在 record() 之外单独判断，此处保留字段作语义标注。
 */
export type BlockPolicy = "hard" | "debt" | "failClosed";

/**
 * 静态工具条目：**必须为 object，且 blockPolicy 必填**。
 * 2026-09-08（脚本体系锐评 R3）：此前允许 string 条目 + blockPolicy 可省略，导致
 * 隐式「string 永远 hard」的语义靠人记住（类型系统不保护）。现改为 full object +
 * 必填 blockPolicy：新增条目未声明阻断策略即编译报错，消灭隐式 hard 的歧义。
 * 2026-10-09（审核体系锐评 · 到期制）：`debt` 分支同样由类型强制附带债元数据
 * （reason + reviewBy）——「没拦也没撤、只记一笔」不再是一种可以无限沉默的状态。
 */
export interface GateToolBase {
  tool: string;
  args?: string[];
  autoFix?: boolean;
  allowRc2?: boolean;
  /**
   * 声明本工具支持 `--files <换行分隔文件列表>` 增量裁剪（2026-09-13）。
   *
   * true 时 pre-push-gate 的 runTools 改用数组式 procRun 传 `--files`（本次变更文件集），
   * 而非 shell 拼串的全库调用；`--all` / `--docs` 模式 files 为空 → 退回全库扫描。
   *
   * **仅当脚本自身接入了 `_lib/changed-scope.ts` 的 resolveChangedScope 才可置 true**：
   * 否则 runTools 会把 --files 发给不识别的脚本（parseArgs 报未知参数 → exit 1 →
   * 误阻断），或脚本忽略该参数静默全扫（存量债淹没）。该不变量由
   * tests/test_gate_config.ts 的 scopedFiles 契约断言锁死。
   */
  scopedFiles?: boolean;
}

/**
 * 清单条目 = 判别联合（2026-10-09 到期制）：
 *   - hard / failClosed：FAIL 即阻断，无需债元数据；
 *   - debt：**必须**携带 `debt: { reason, reviewBy }`——类型系统强制每笔债写下
 *     「为什么是债」与「何时重新决策」，从源头消灭「无理由、无期限」的沉默债务。
 * 违反即 `tsc -p scripts/tsconfig.json` 编译报错（脚本域 typecheck 是门禁项）。
 */
export type GateTool =
  | (GateToolBase & { blockPolicy: Exclude<BlockPolicy, "debt"> })
  | (GateToolBase & { blockPolicy: "debt"; debt: GateDebt });
