/**
 * gate-config.ts — pre-push-gate 静态工具清单单一配置层。
 *
 * 设计意图：pre-push-gate.ts 职责是「按域调度检查」，但它长期内联了 4 个工具清单
 * （ALL_STATIC_TOOLS / DOC_STATIC_TOOLS / FRONTEND_STATIC_TOOLS / GO_STATIC_TOOLS，
 * 合计 40+ 项）。新增检查时同时改 gate 和清单的两处描述极易漂移（ADR-088 Take巧 #3 实证）。
 *
 * 数量口径（2026-10-08 复核实测，勿再沿用旧快照）：ALL_STATIC_TOOLS 唯一条目 = 32 项，
 * DOC/FRONTEND/GO 是**域子集**（与 ALL 有重叠，非追加）；此前「合计 40+ 项」是把四张
 * 列表的重复条目相加，属虚高。统计 check-*.ts 接入数以 `node scripts/` 实际清单为准。
 * 本模块把清单数据与 gate 调度逻辑解耦：gate 读配置，清单单一维护点。
 *
 * 结构（每项）：
 *   string  → 简单调用：node scripts/<name>.ts --json
 *   { tool, args?, autoFix? } → 带参数调用；autoFix=true 时 FAIL 自动跑写盘版刷新后重验
 *
 * 用法：
 *   import { ALL_STATIC_TOOLS, DOC_STATIC_TOOLS, FRONTEND_STATIC_TOOLS, GO_STATIC_TOOLS }
 *     from './_lib/gate-config.ts';
 *
 * 依赖：./gate-debt.ts（存量债元数据类型；零依赖纯函数模块）
 */
import type { GateDebt } from "./gate-debt.ts";

/**
 * 存量债复审默认截止日（2026-10-09 到期制落地）。
 * `blockPolicy: "debt"` 的条目必须带 `debt: { reason, reviewBy }`；此处两档是排期默认值：
 *   - LEDGER：棘轮账本型（knip/jscpd/复杂度/令牌/死键）——量大、需排期回收；
 *   - OBSERVE：信号未验证的观察型（注释考古/孪生探针/时长口径）——一轮内应出结论。
 * 到期未处置 = `doctor --all` 红灯，逼一次显式决策（改硬 / 修 / 带理由续期），详见 gate-debt.ts。
 */
const REVIEW_BY_LEDGER = "2026-11-08";
const REVIEW_BY_OBSERVE = "2026-11-15";

/** 声明一条存量债：reason 必填（禁无理由债务），reviewBy 缺省走账本档排期。 */
const debt = (reason: string, reviewBy: string = REVIEW_BY_LEDGER): GateDebt => ({
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
type BlockPolicy = "hard" | "debt" | "failClosed";

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

/**
 * 全量模式静态工具清单（doctor --all / pre-push-gate --all）。
 * 覆盖 Go + 前端 + 文档 + 脚本治理全栈；与域检查重叠的项（check-layering / binding-check）已剔除。
 */
export const ALL_STATIC_TOOLS: GateTool[] = [
  { tool: "check-doc-drift.ts", blockPolicy: "hard" },
  { tool: "check-adr-health.ts", blockPolicy: "hard" },
  { tool: "check-resource-manifest.ts", blockPolicy: "hard" },
  { tool: "check-boolean-naming.ts", blockPolicy: "debt", debt: debt("命名启发式命中：值语义需人工判断，规则本身非确定性") },
  { tool: "check-circular.ts", blockPolicy: "debt", debt: debt("全库循环依赖存量；--files 裁剪后只对本次变更面判定") },
  { tool: "check-orphan-exports.ts", blockPolicy: "debt", debt: debt("导出面宽于消费面（多为缺 export 关键字/re-export），需分档回收") },
  { tool: "check-deadcode-baseline.ts", blockPolicy: "debt", debt: debt("knip/jscpd 棘轮账本；噪声已分离，回收需分「删关键字」与「真删码」") },
  { tool: "jscpd-go.ts", blockPolicy: "debt", debt: debt("Go 侧克隆基线；含有意保留的兼容入口，需逐对判断") },
  // 双轨漂移扫描**刻意不挂 push 路径**（2026-10-08 回退，撤销当日 76651c051 的挂载）：
  // ① 该清单在 push 模式被 schedule.ts 无条件全跑（36 项串行实测 45.4s），任何新条目都是
  //    全队每次推送的固定成本；② drift-scan 的信号质量尚未验证——6 条规则在本轮实测只出
  //    2 处命中，其中 1 处是跨文件会话范式的启发式误报，「0 处漂移」并不等于「无此类债」；
  // ③ 其扫描面（内联剥后缀/硬编码权限/读取上限/定时器泄漏）与 check-deadcode-baseline·
  //    jscpd-go·check-circular 部分重叠，边际价值低于固定成本。
  // 保留「非挂载但可手动执行」：node scripts/drift-scan.ts（误报与定点豁免已于同日修复，
  // 现 exit 0）。若要接入，先补信号质量实证（真命中/误报比）与耗时预算，再单独拍板。
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
  { tool: "check-proc-adoption.ts", blockPolicy: "debt", debt: debt("进程调用收口未完成的存量站点") },
  { tool: "check-lib-adoption.ts", blockPolicy: "debt", debt: debt("共享能力未走 _lib 的存量站点") },
  { tool: "check-workflow-refs.ts", blockPolicy: "hard" },
  { tool: "check-readme-index.ts", blockPolicy: "hard" },
  // docs markdown 裸标签（2026-09-19 接线）：VitePress 用 Vue 编译器解析 md，
  // 行内代码之外的裸 `<tag>` 会让整站构建抛「Element is missing end tag」——
  // Pages 曾因此静默连挂 6 次（go-scanner 知识卡漏反引号），而断链检查 / 测试 / CI 全绿。
  // hard 的依据：判定经 VitePress 真实 markdown-it 逐例实测 + 真实构建探针裁决
  // （见脚本头「实证依据」），全 docs 语料 0 命中 → 无存量债冒充，属确定性规则
  // 而非启发式（同 check-workflow-refs 的引用守规定位）。配套 tests/test_check_doc_markup.ts。
  { tool: "check-doc-markup.ts", blockPolicy: "hard" },
  { tool: "i18n-check.ts", args: ["--strict"], blockPolicy: "hard" },
  { tool: "i18n-ui-check.ts", blockPolicy: "hard" },
  { tool: "css-layer-check.ts", args: ["--strict"], blockPolicy: "hard" },
  // a11y 覆盖基线守卫（ADR-308 D3，2026-09-26 接线）：coverage 计数下限（aria-* 按属性名 /
  // role / tabindex / prefers-reduced-motion，只增不减）+ document 级 keydown 散点上限
  // （只减不增，key-router.ts 唯一合法出口豁免）。hard 依据：确定性正则 + baseline 即存量
  // 本身，不存在「存量债冒充」；配套 tests/test_check_a11y.ts（纯核直测防空转假绿）。
  { tool: "check-a11y.ts", blockPolicy: "hard" },
  { tool: "check-toast-duration.ts", blockPolicy: "debt", debt: debt("提示时长口径存量违规，量小但分散") },
  // 设计令牌守规（2026-09 接线）：与 css-layer-check 互补——后者管「样式定义在哪一层生效」，
  // 本闸管「样式值是否走了令牌」。全量模式不传 --files（无 diff 上下文）→ 走 `--baseline`：
  // 这里是**账本漂移报告**（全库 vs scripts/baseline/design-tokens-baseline.json），
  // 不再参与提交 / 推送判定（判定已改真行级，见 FRONTEND_STATIC_TOOLS 的 ADR-256 注释）。
  { tool: "check-design-tokens.ts", args: ["--baseline"], blockPolicy: "debt", debt: debt("全库账本漂移报告：判定已改真行级，此处不参与提交/推送判定") },
  // i18n 未使用键（2026-09）：全量模式亦挂——死键是全仓性质的，与扫描域裁剪无关。
  { tool: "check-i18n-unused.ts", args: ["--baseline"], blockPolicy: "debt", debt: debt("i18n 死键基线；含动态查表启发式成分，无法静态判定") },
  // Android 平台黑名单守卫（2026-09-08 纳入）：T1 编译期差集 / T2 运行期 ADR-047 守卫未登记 → 阻断。
  // 依赖 go 工具链；不可用时脚本降级为 T3/T4（_summary.degraded=true），不会因环境缺 go 而红灯。
  { tool: "check-android-unavailable.ts", blockPolicy: "hard" },
  // ── 2026-10-08 门禁清单对账（锐评复核实测）补挂：原真·未接线的 check-* ──
  // check-comment-history：ADR-234 D1 注释考古（WARN 观察期，非阻断）；实测 176ms，errors=0。
  { tool: "check-comment-history.ts", blockPolicy: "debt", debt: debt("注释考古 WARN 观察期（ADR-234 D1），信号质量未验证", REVIEW_BY_OBSERVE) },
  // check-twin-siblings：改动同构同胞探针（纯提醒，走 _summary.warns）；实测 132ms。
  { tool: "check-twin-siblings.ts", blockPolicy: "debt", debt: debt("同构同胞探针为纯提醒（走 _warns），无判定力", REVIEW_BY_OBSERVE) },
  // check-unread-fields：契约字段零读取审计——**刻意不接本地门禁**（2026-10-08 摘除）。
  // 摘除理由（三条均为其自述）：
  //   ① 成本：实测 18.3s 全仓文本解析，单条即吃掉 commit / push 两条路径的全部预算
  //      （原注释已承认「接进来即每次 push +20s」——知会了没解决）；
  //   ② 无判定力：默认 rc=0 纯审计（自述「审计模式，rc=0，供 doctor 调用」），--strict 才 rc=1，
  //      挂在门禁里却从不拦人 → 付了 18s 买到零阻断；
  //   ③ 判定归属存疑 72%：README 自述「契约类 219 个已读中 158 个归属存疑」，
  //      同名跨 interface 互相洗白 → 信号可信度不支持作为门禁项。
  // 归宿：留作按需审计 `node scripts/check-unread-fields.ts`（或 doctor --all 手工跑），
  // 不进 commit / push 热路径。若要重新接入，须先降耗时（增量扫描/缓存）并给出误报率实证。
  // check-diff-coverage.ts（前端 diff 覆盖率）**刻意不在此接入**：同时依赖前端
  // coverage-final.json 与 diff 基线 ref——本地无覆盖率产物会 rc=2 恒红（假阻断，正是
  // 门禁对账要消灭的假闸）；正确归宿是 CI 的 vitest --coverage 之后且 checkout 须有基线 ref。
  // 待 CI 接线专项处理，勿盲目加进本地闸（参见 docs/knowledge/gate-chain-map.md 处置记录）。
];

/**
 * 文档模式静态工具清单（doctor --docs / pre-push-gate --docs）。
 * 仅含 docs/ 域相关项（link-checker / adr-check 由域检查覆盖，不在此处重复）。
 */
export const DOC_STATIC_TOOLS: GateTool[] = [
  { tool: "check-doc-drift.ts", blockPolicy: "hard" },
  { tool: "check-adr-health.ts", blockPolicy: "hard" },
  { tool: "check-resource-manifest.ts", blockPolicy: "hard" },
  { tool: "event-graph.ts", args: ["--check"], autoFix: true, blockPolicy: "hard" },
  { tool: "build-novel-index.ts", args: ["--check"], autoFix: true, blockPolicy: "hard" },
  { tool: "gen-routes.ts", args: ["--check"], autoFix: true, blockPolicy: "hard" },
  { tool: "gen-routes-quick.ts", args: ["--check"], autoFix: true, blockPolicy: "hard" },
  { tool: "gen-cli-doc.ts", args: ["--check"], autoFix: true, blockPolicy: "hard" },
  { tool: "gen-cli-completion.ts", args: ["--check"], autoFix: true, blockPolicy: "hard" },
  { tool: "gen-knowledge-autogen.ts", args: ["--check"], autoFix: true, blockPolicy: "hard" },
  { tool: "check-script-hygiene.ts", args: ["--strict"], blockPolicy: "hard" },
  { tool: "check-proc-adoption.ts", blockPolicy: "debt", debt: debt("进程调用收口未完成的存量站点") },
  { tool: "check-workflow-refs.ts", blockPolicy: "hard" },
  { tool: "check-readme-index.ts", blockPolicy: "hard" },
  // docs markdown 裸标签：见 ALL_STATIC_TOOLS 同项注释（整站构建断裂前移为提交期判定）
  { tool: "check-doc-markup.ts", blockPolicy: "hard" },
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
  { tool: "check-circular.ts", blockPolicy: "debt", debt: debt("全库循环依赖存量；--files 裁剪后只对本次变更面判定") },
  { tool: "check-boolean-naming.ts", blockPolicy: "debt", debt: debt("命名启发式命中：值语义需人工判断，规则本身非确定性") },
  { tool: "check-orphan-exports.ts", blockPolicy: "debt", debt: debt("导出面宽于消费面（多为缺 export 关键字/re-export），需分档回收") },
  { tool: "check-deadcode-baseline.ts", blockPolicy: "debt", debt: debt("knip/jscpd 棘轮账本；噪声已分离，回收需分「删关键字」与「真删码」") },
  { tool: "check-tpl-refs.ts", blockPolicy: "hard" },
  { tool: "check-dynamic-import.ts", blockPolicy: "hard" },
  // auto-import 刻意**不在**本清单（2026-10-09 静态工具段耗时债处置）——它留在
  // ALL_STATIC_TOOLS，即：`doctor --all`（发版前全量）与 CI 的 `pre-push-gate --static`
  // （test.yml「静态治理门禁」步，exit 码传播=阻断）都照跑同一条命令，**远端覆盖零损失**；
  // 只是本地 push / commit-with-check 热路径不再重复付费。
  // 判据（对齐 static-tools.ts 的摘除判据 ②「CI 有无兜底」）：
  //   ① 成本固定且不可裁剪：实测全量 7.8s、单文件 8.1s——它是「先扫全树建导出表、再查目标文件」
  //      的形态，`--files` 增量裁剪**救不了**（不是按目标文件付费）；
  //   ② CI 已同跑同源命令（test.yml:411 `pre-push-gate --static` → 合并 ALL_STATIC_TOOLS），
  //      本地那次只买「早知道」；
  //   ③ 判定力与 tsc 高度重叠（「用了没导入」在严格 TS 下即 TS2304，本地 typecheck 与 CI
  //      frontend job 都跑），本脚本自述为「正则级试水版、有已知误报面」。
  // 反向锚：tests/test_gate_config.ts 同时钉死「ALL 必须在册」+「CI --static 步必须存在」，
  // 防止有人摘掉本行后再顺手删了远端兜底（那就成了真关闸）。
  { tool: "i18n-check.ts", args: ["--strict"], blockPolicy: "hard" },
  { tool: "i18n-ui-check.ts", blockPolicy: "hard" },
  // i18n 未使用键（2026-09 接线）：补四个既有 i18n 闸的公共盲区——它们查「该有的有没有」
  // （缺失键 / 命名 / UI 硬编码中文 / 右键菜单键齐），**没有一个查「有的还有没有人要」**，
  // 故死键只增不减（实测 182/1459 = 12%，多为迁移后遗留）。
  // blockPolicy: debt —— 基线模式（存量冻结）；判定含启发式成分（动态查表无法静态判定），
  // 按 gate-config 准入判据「不存在存量债冒充」才可 hard，故记 debt。
  // 不置 scopedFiles：本闸是「全仓键使用面」分析，单文件无法独立判定（见脚本头注释）。
  { tool: "check-i18n-unused.ts", args: ["--baseline"], blockPolicy: "debt", debt: debt("i18n 死键基线；含动态查表启发式成分，无法静态判定") },
  { tool: "event-graph.ts", args: ["--strict"], blockPolicy: "hard" },
  // a11y 基线守卫（ADR-308 D3）：见 ALL_STATIC_TOOLS 同项注释。无 scopedFiles——
  // 基线是全仓计数守卫，单文件无法独立判定。
  { tool: "check-a11y.ts", blockPolicy: "hard" },
  { tool: "check-toast-duration.ts", blockPolicy: "debt", debt: debt("提示时长口径存量违规，量小但分散") },
  { tool: "check-biome.ts", args: ["--strict"], blockPolicy: "hard" },
  { tool: "check-file-lines.ts", blockPolicy: "hard" },
  // 设计令牌守规（2026-09 接线，2026-09-16 改判真行级 ADR-256）：此前**只挂 pre-commit**，
  // pre-push / CI 均无——而 pre-commit 可被 `git commit --no-verify` 一条命令绕过
  // （CI --static 模式的立项目的正是补这一层，见 pre-push-gate.ts 的 staticMode 注释）。
  //
  // args: --added-lines —— 判定域 = **本次推送引入的新增行**（range 源 base..head，
  // base 取与默认分支的 merge-base；内容取 head blob），与 pre-commit 的索引源共用
  // `_lib/diff-source.ts` + `_lib/git-hunks.ts` + `findViolationsOnLines`（单一事实源）。
  // 为什么不再用 --baseline：键 file:line:kind 实测高噪声——116 提交窗里 added 330 中 322 条（97.6%）
  // 是行位移幻影、真新增候选仅 8；阻断视角 24 次里 19 次行级命中为 0（ADR-256 §1/§4，
  // 可复现 node scripts/token-shift-audit.ts --window 120）。
  // 注：ALL_STATIC_TOOLS 保留 `--baseline`（--all 模式无 diff 上下文，那里是**账本漂移报告**）。
  //
  // blockPolicy: debt —— 行级判定已无「存量债冒充」问题（只判新增行），但先观察一轮
  // push / CI 实况确认无假阻断，再议升 hard（ADR-256 D5）。
  // scopedFiles: true —— 脚本已 import _lib/changed-scope.ts 并接 --files（准入条件满足），
  // 由 tests/test_gate_config.ts 的 scopedFiles 契约断言兜底。
  {
    tool: "check-design-tokens.ts",
    args: ["--added-lines"],
    blockPolicy: "debt",
    debt: debt("行级判定已消存量冒充，观察一轮 push/CI 实况再议升 hard（ADR-256 D5）", REVIEW_BY_OBSERVE),
    scopedFiles: true,
  },
  // ── 三档位阈值扫描器（2026-09-13 接线）──
  // 此前是「无守护债务」：仓库 32 个 check-*.ts 中这 3 个无任何自动化入口，只能手动跑
  // （实证：views 域 10 个 🟥 复杂度档长期无人拦，见 pre-push-gate.md 门禁覆盖边界）。
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
  { tool: "check-complexity.ts", blockPolicy: "debt", debt: debt("全库阈值+增量裁剪：被触碰的存量红档仍计命中，baseline 未落地前不得 hard"), scopedFiles: true },
  { tool: "check-params.ts", blockPolicy: "debt", debt: debt("同上：全库阈值型，存量命中会淹没本次变更"), scopedFiles: true },
  { tool: "check-type-safety.ts", blockPolicy: "debt", debt: debt("同上：生产域当前 errors=0，观察一轮后可单独升 hard"), scopedFiles: true },
];

/**
 * Go 域 push 模式补挂静态工具（plan.go=true 时追加）。
 */
export const GO_STATIC_TOOLS: GateTool[] = [
  { tool: "jscpd-go.ts", blockPolicy: "debt", debt: debt("Go 侧克隆基线；含有意保留的兼容入口，需逐对判断") },
  { tool: "check-go-diff-coverage.ts", blockPolicy: "hard" },
  // check-go-coverage-threshold：包级最低函数覆盖率（语句加权，2026-09 口径修正后）。
  // 只读不写：本门禁不自动生成 .coverage/go-cover.out（pre-push 薄壳 / gate-blocks / CI 非门禁步
  // 均不写此文件），需人工或 CI 先 `go test -coverprofile` 喂料；产物缺失/陈旧时脚本已优雅
  // 降级（缺产物 WARN+exit1，陈旧产物打印醒目警告，见 P1-a 根治）。debt 接入 → 不阻断推送。
  { tool: "check-go-coverage-threshold.ts", blockPolicy: "debt", debt: debt("只读不写：产物需人工/CI 喂料，自动生成未接（降级路径已优雅）") },
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

/**
 * 五张清单的固定展开序（**单一事实源**，2026-10-09）：
 * 覆盖口径统计（gate-coverage）、存量债到期盘点（pre-push-gate --all）、契约测试
 * （tests/test_gate_config.ts）三处消费同一序——新增/改名清单只改这里，杜绝
 * 「三处各抄一份数组、新增清单漏一处」的漂移（本轮锐评反复见到的腐化形态）。
 * 注意：域清单与 ALL 有重叠，覆盖/债统计均按**工具名去重**处理，勿直接相加当总数。
 */
export const ALL_GATE_TOOL_LISTS: readonly (readonly GateTool[])[] = [
  ALL_STATIC_TOOLS,
  DOC_STATIC_TOOLS,
  DOC_EXTRA_SCRIPTS,
  FRONTEND_STATIC_TOOLS,
  GO_STATIC_TOOLS,
  // scripts/ TS 域 typecheck（单条闸、无独立清单，同样是一条「清单条目」——
  // 计入阻断构成，否则「44 条 hard+debt」与实况差一，又是口径不一）。
  [SCRIPTS_TYPECHECK],
];

/** 五张清单展平（含重复；去重口径由消费方决定）。 */
export function flattenGateTools(): GateTool[] {
  return ALL_GATE_TOOL_LISTS.flatMap((l) => [...l]);
}
