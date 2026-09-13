/**
 * gate-config.ts — pre-push-gate 静态工具清单单一配置层。
 *
 * 设计意图：pre-push-gate.ts 职责是「按域调度检查」，但它长期内联了 4 个工具清单
 * （ALL_STATIC_TOOLS / DOC_STATIC_TOOLS / FRONTEND_STATIC_TOOLS / GO_STATIC_TOOLS，
 * 合计 40+ 项）。新增检查时同时改 gate 和清单的两处描述极易漂移（ADR-088 Take巧 #3 实证）。
 * 本模块把清单数据与 gate 调度逻辑解耦：gate 读配置，清单单一维护点。
 *
 * 结构（每项）：
 *   string  → 简单调用：node scripts/<name>.mjs --json
 *   { tool, args?, autoFix? } → 带参数调用；autoFix=true 时 FAIL 自动跑写盘版刷新后重验
 *
 * 用法：
 *   import { ALL_STATIC_TOOLS, DOC_STATIC_TOOLS, FRONTEND_STATIC_TOOLS, GO_STATIC_TOOLS }
 *     from './_lib/gate-config.ts';
 *
 * 依赖：零依赖（纯数据结构）
 */

/**
 * 阻断策略：控制 record() 是否因 FAIL 置 blocked=true。
 *   hard        FAIL → 阻断（默认，隐式）
 *   debt        FAIL → 只记录，不阻断（债务类，推送后修）
 *   failClosed  FAIL → 只记录，不阻断；仅工具本身不可用（如 rg 缺失）才阻断——
 *               由调用方在 record() 之外单独判断，此处保留字段作语义标注。
 */
type BlockPolicy = "hard" | "debt" | "failClosed";

/**
 * 静态工具条目：**必须为 object，且 blockPolicy 必填**。
 * 2026-09-08（脚本体系锐评 R3）：此前允许 string 条目 + blockPolicy 可省略，导致
 * 隐式「string 永远 hard」的语义靠人记住（类型系统不保护）。现改为 full object +
 * 必填 blockPolicy：新增条目未声明阻断策略即编译报错，消灭隐式 hard 的歧义。
 */
export interface GateTool {
  tool: string;
  args?: string[];
  autoFix?: boolean;
  allowRc2?: boolean;
  blockPolicy: BlockPolicy;
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
 * 全量模式静态工具清单（doctor --all / pre-push-gate --all）。
 * 覆盖 Go + 前端 + 文档 + 脚本治理全栈；与域检查重叠的项（check-layering / binding-check）已剔除。
 */
export const ALL_STATIC_TOOLS: GateTool[] = [
  { tool: "check-doc-drift.ts", blockPolicy: "hard" },
  { tool: "check-adr-health.ts", blockPolicy: "hard" },
  { tool: "check-boolean-naming.ts", blockPolicy: "debt" },
  { tool: "check-circular.ts", blockPolicy: "debt" },
  { tool: "check-orphan-exports.ts", blockPolicy: "debt" },
  { tool: "check-deadcode-baseline.ts", blockPolicy: "debt" },
  { tool: "jscpd-go.ts", blockPolicy: "debt" },
  { tool: "check-tpl-refs.ts", blockPolicy: "hard" },
  { tool: "check-dynamic-import.ts", blockPolicy: "hard" },
  { tool: "auto-import.ts", args: ["--strict"], blockPolicy: "hard" },
  { tool: "event-graph.ts", args: ["--check"], autoFix: true, blockPolicy: "hard" },
  { tool: "build-novel-index.ts", args: ["--check"], autoFix: true, blockPolicy: "hard" },
  { tool: "gen-routes.ts", args: ["--check"], autoFix: true, blockPolicy: "hard" },
  { tool: "gen-routes-quick.ts", args: ["--check"], autoFix: true, blockPolicy: "hard" },
  { tool: "gen-cli-doc.ts", args: ["--check"], autoFix: true, blockPolicy: "hard" },
  { tool: "gen-cli-completion.ts", args: ["--check"], autoFix: true, blockPolicy: "hard" },
  { tool: "gen-knowledge-autogen.ts", args: ["--check"], autoFix: true, blockPolicy: "hard" },
  { tool: "check-script-hygiene.ts", args: ["--strict"], blockPolicy: "hard" },
  { tool: "check-proc-adoption.ts", blockPolicy: "debt" },
  { tool: "check-lib-adoption.ts", blockPolicy: "debt" },
  { tool: "check-workflow-refs.ts", blockPolicy: "hard" },
  { tool: "check-readme-index.ts", blockPolicy: "hard" },
  { tool: "i18n-check.ts", args: ["--strict"], blockPolicy: "hard" },
  { tool: "i18n-ui-check.ts", blockPolicy: "hard" },
  { tool: "css-layer-check.ts", args: ["--strict"], blockPolicy: "hard" },
  { tool: "check-toast-duration.ts", blockPolicy: "debt" },
  // Android 平台黑名单守卫（2026-09-08 纳入）：T1 编译期差集 / T2 运行期 ADR-047 守卫未登记 → 阻断。
  // 依赖 go 工具链；不可用时脚本降级为 T3/T4（_summary.degraded=true），不会因环境缺 go 而红灯。
  { tool: "check-android-unavailable.ts", blockPolicy: "hard" },
];

/**
 * 文档模式静态工具清单（doctor --docs / pre-push-gate --docs）。
 * 仅含 docs/ 域相关项（link-checker / adr-check 由域检查覆盖，不在此处重复）。
 */
export const DOC_STATIC_TOOLS: GateTool[] = [
  { tool: "check-doc-drift.ts", blockPolicy: "hard" },
  { tool: "check-adr-health.ts", blockPolicy: "hard" },
  { tool: "event-graph.ts", args: ["--check"], autoFix: true, blockPolicy: "hard" },
  { tool: "build-novel-index.ts", args: ["--check"], autoFix: true, blockPolicy: "hard" },
  { tool: "gen-routes.ts", args: ["--check"], autoFix: true, blockPolicy: "hard" },
  { tool: "gen-routes-quick.ts", args: ["--check"], autoFix: true, blockPolicy: "hard" },
  { tool: "gen-cli-doc.ts", args: ["--check"], autoFix: true, blockPolicy: "hard" },
  { tool: "gen-cli-completion.ts", args: ["--check"], autoFix: true, blockPolicy: "hard" },
  { tool: "gen-knowledge-autogen.ts", args: ["--check"], autoFix: true, blockPolicy: "hard" },
  { tool: "check-script-hygiene.ts", args: ["--strict"], blockPolicy: "hard" },
  { tool: "check-proc-adoption.ts", blockPolicy: "debt" },
  { tool: "check-workflow-refs.ts", blockPolicy: "hard" },
  { tool: "check-readme-index.ts", blockPolicy: "hard" },
];

/**
 * 文档额外检查（--all / --docs 模式下与 DOC_STATIC_TOOLS 合并执行）。
 * 仅含未被域检查覆盖的 drift 守护项。
 */
export const DOC_EXTRA_SCRIPTS: GateTool[] = [
  { tool: "check-knowledge-drift.ts", blockPolicy: "hard" },
  { tool: "check-adr-drift.ts", blockPolicy: "hard" },
];

/**
 * 前端域 push 模式补挂静态工具（plan.frontend=true 时追加）。
 * 与 ALL_STATIC_TOOLS 分工：后者全量扫描，此项增量门禁——只拦本次变更引入的新违规。
 */
export const FRONTEND_STATIC_TOOLS: GateTool[] = [
  { tool: "check-circular.ts", blockPolicy: "debt" },
  { tool: "check-boolean-naming.ts", blockPolicy: "debt" },
  { tool: "check-orphan-exports.ts", blockPolicy: "debt" },
  { tool: "check-deadcode-baseline.ts", blockPolicy: "debt" },
  { tool: "check-tpl-refs.ts", blockPolicy: "hard" },
  { tool: "check-dynamic-import.ts", blockPolicy: "hard" },
  { tool: "auto-import.ts", args: ["--strict"], blockPolicy: "hard" },
  { tool: "i18n-check.ts", args: ["--strict"], blockPolicy: "hard" },
  { tool: "i18n-ui-check.ts", blockPolicy: "hard" },
  { tool: "event-graph.ts", args: ["--strict"], blockPolicy: "hard" },
  { tool: "check-toast-duration.ts", blockPolicy: "debt" },
  { tool: "check-biome.ts", args: ["--strict"], blockPolicy: "hard" },
  { tool: "check-file-lines.ts", blockPolicy: "hard" },
  // ── 三档位阈值扫描器（2026-09-13 接线）──
  // 此前是「无守护债务」：仓库 32 个 check-*.ts 中这 3 个无任何自动化入口，只能手动跑
  // （实证：views 域 10 个 🟥 复杂度档长期无人拦，见 pre_push_gate.md 门禁覆盖边界）。
  //
  // blockPolicy: debt —— 这三者是**全库阈值 + 增量裁剪**模式：--files 只把扫描范围收敛到
  // 「本次变更文件」，但**被触碰的文件若本就超阈值仍会计入命中**（改一行注释也会红）。
  // 对比 check-file-lines 可 hard：它是显式规则表（1 个受控文件），不存在存量债冒充。
  // 故须待 baseline 比对落地（同 check-redlines --baseline 的「新增违规」口径）后才有资格升 hard。
  // 其中 check-type-safety 生产域当前 errors=0（--strict 实测 exit 0），观察一轮后可单独升 hard。
  //
  // scopedFiles: true → runTools 传 --files。动机有两条，缺一不可：
  //   1. 防淹没：全库跑 check-complexity 命中 301 条（27 个 🟥）、check-params 54 条，
  //      未触碰文件的存量债会把每次推送刷成全红。
  //   2. 控成本：check-params 全库墙钟 59.4s（getType() 逐参数触发类型检查），
  //      --files 裁剪到本次变更后降至 7.9s 量级，是它可挂门禁的前提。
  { tool: "check-complexity.ts", blockPolicy: "debt", scopedFiles: true },
  { tool: "check-params.ts", blockPolicy: "debt", scopedFiles: true },
  { tool: "check-type-safety.ts", blockPolicy: "debt", scopedFiles: true },
];

/**
 * Go 域 push 模式补挂静态工具（plan.go=true 时追加）。
 */
export const GO_STATIC_TOOLS: GateTool[] = [
  { tool: "jscpd-go.ts", blockPolicy: "debt" },
  { tool: "check-go-diff-coverage.ts", blockPolicy: "hard" },
];

/**
 * scripts/ TS 类型检查（--all 模式；.ts 文件随 _lib/ 迁移逐步出现，零 .ts 时 tsc
 * 返回 TS18003 退出码 2——此处容忍 rc=2 为"无输入"，避免早期误阻断）。
 */
export const SCRIPTS_TYPECHECK: GateTool = {
  tool: "tsc",
  args: ["--noEmit", "-p", "scripts/tsconfig.json"],
  allowRc2: true, // TS18003 无输入 = 尚未有 .ts，非错误
  blockPolicy: "hard",
};
