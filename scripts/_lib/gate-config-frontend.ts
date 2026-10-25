/**
 * gate-config-frontend.ts — 前端域 push 模式补挂静态工具（plan.frontend=true 时追加）。
 *
 * 从 gate-config.ts 沿域缝拆出（ADR-234 D3 `_lib` 400 行硬红线，2026-10-25）。
 * 这是 gate-config 里最大的一簇（并行会话热点：新增前端闸目几乎都落在这张表），
 * 拆出后「新增前端闸」只改本文件，不再与 docs/go 域的改动手动合并。
 *
 * 只搬移不重写：条目内容、顺序、全部判定注释与原文件逐字一致。
 *
 * 依赖：./gate-tool-types.ts（GateTool / debt）
 */
import { debt, REVIEW_BY_OBSERVE, type GateTool } from "./gate-tool-types.ts";

/**
 * 前端域 push 模式补挂静态工具（plan.frontend=true 时追加）。
 * 与 ALL_STATIC_TOOLS 分工：后者全量扫描，此项增量门禁——只拦本次变更引入的新违规。
 */
export const FRONTEND_STATIC_TOOLS: GateTool[] = [
  {
    tool: "check-circular.ts",
    blockPolicy: "debt",
    debt: debt("全库循环依赖存量；--files 裁剪后只对本次变更面判定"),
  },
  {
    tool: "check-boolean-naming.ts",
    blockPolicy: "debt",
    debt: debt("命名启发式命中：值语义需人工判断，规则本身非确定性"),
  },
  {
    tool: "check-orphan-exports.ts",
    blockPolicy: "debt",
    debt: debt("导出面宽于消费面（多为缺 export 关键字/re-export），需分档回收"),
  },
  // deadcode-baseline 刻意**不在本清单**（2026-10-17 第四轮锐评，镜像上方 auto-import 先例）：
  //   ① 成本：实测 3.4s，纯前端 push（20.8s）的第 2 贵项；非 scopedFiles——全仓键使用面
  //      分析，单文件无法独立判定（见其注释），--files 裁剪救不了；
  //   ② 判定力：blockPolicy=debt 不阻断，热路径付 3.4s 只买「早知道」；
  //   ③ 远端覆盖如实口径（第五轮锐评 P2-1：不写「零损失」这种绝对话）：frontend 域
  //      每次 push 必触发 CI 独立步骤（test.yml「死代码基线门禁」，按 ADR-244 显式带
  //      changed-base 归属基线——判定质量高于本地无上下文那次，故 --static 经
  //      CI_INDEPENDENT_TOOLS 剔除避免同 job 双跑假红）；doctor --all 亦在册。
  //      **已知豁口**：纯 scripts 提交若改动 deadcode 判定面本身（_lib/deadcode-keys/
  //      attrib、knip.json、baseline 账本），本地与 CI frontend-gates 均不跑该闸——
  //      概率低、接受，由 doctor --all 发版前兜底；独立步骤存在性由
  //      tests/test_gate_schedule.ts 第 9 组钉死，缺席三域表由 test_gate_config.ts 第 7 组钉死。
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
  // 冻结 t() 第五闸（立因与判据见 ALL_STATIC_TOOLS 同项注释）：判定虽只扫 frontend/src，
  // 但**刻意不接 scopedFiles 增量裁剪**——复发面在全前端任意模块表，按变更文件裁剪会漏
  // 「改 A 文件、把 B 文件的旧冻结点留在仓里」；全扫实测秒级，成本不构成理由。
  { tool: "i18n-frozen-t-check.ts", args: ["--strict"], blockPolicy: "hard" },
  // i18n 未使用键（2026-09 接线）：补四个既有 i18n 闸的公共盲区——它们查「该有的有没有」
  // （缺失键 / 命名 / UI 硬编码中文 / 右键菜单键齐），**没有一个查「有的还有没有人要」**，
  // 故死键只增不减（实测 182/1459 = 12%，多为迁移后遗留）。
  // blockPolicy: debt —— 基线模式（存量冻结）；判定含启发式成分（动态查表无法静态判定），
  // 按 gate-config 准入判据「不存在存量债冒充」才可 hard，故记 debt。
  // 不置 scopedFiles：本闸是「全仓键使用面」分析，单文件无法独立判定（见脚本头注释）。
  {
    tool: "check-i18n-unused.ts",
    args: ["--baseline"],
    blockPolicy: "debt",
    debt: debt("i18n 死键基线；含动态查表启发式成分，无法静态判定"),
  },
  { tool: "event-graph.ts", args: ["--strict"], blockPolicy: "hard" },
  // a11y 基线守卫（ADR-308 D3）：见 ALL_STATIC_TOOLS 同项注释。无 scopedFiles——
  // 基线是全仓计数守卫，单文件无法独立判定。
  { tool: "check-a11y.ts", blockPolicy: "hard" },
  {
    tool: "check-toast-duration.ts",
    blockPolicy: "debt",
    debt: debt("提示时长口径存量违规，量小但分散"),
  },
  // e2e 反模式静态门禁（2026-10-25 锐评落地；规则全文见 docs/knowledge/e2e-visual-feedback.md）：
  // 扫 frontend/e2e + frontend/e2e-web 的 *.spec.ts 三类反模式——R1 固定 sleep 等就绪
  //（waitForTimeout>=1000 为 high 硬闸候选）/ R2 软断言假绿（toBeGreaterThan(0) 等，high）/
  // R3 防假绿守卫废置（screenshotWithBaseline 全树零调用=死代码待删；ad-hoc 截图仍缺闸）。
  // blockPolicy: debt 观察期非阻断（--strict 命中 high 才 exit 1）。不置 scopedFiles：全仓套件级。
  // 观察期定位（2026-10 历史实证）：硬化战役 8323b5cce/0c6763185/21d262ae3/75c046853 已在同一
  // 批 offender spec 上飞（sleep→轮询 / sha256 互异闸 / skip 改硬断言 / 硬断言复活），85 命中多落活跃
  // 工程——此刻硬红会撞在途改动，制造噪声（本仓反复吃亏的「假红训练人忽略红灯」）。故保留 debt
  // 作「欠债看板」；升 hard 的自然触发点 = 战役收口压低基线后，把 R1(high)/R2 当防回归锁（那时硬红
  // 才是「新增拦截」而非撞存量）。R3 真缺口：删 visual-baseline.ts 死代码 + menu-visual 的 6 处
  // ad-hoc shot() 接 sha256 互异闸（其余 spec 已迁）。
  {
    tool: "check-e2e-hygiene.ts",
    blockPolicy: "debt",
    debt: debt("e2e 反模式存量（R1 固定 sleep / R2 软断言假绿 / R3 守卫废置）；作硬化战役欠债看板，收口后 R1(high)/R2 升 hard 防回归", REVIEW_BY_OBSERVE),
  },
  // 前端 vitest「失败失语」防回退闸（2026-10-25 接线；判据与理由见 docs/knowledge/vitest-assert-quality.md）：
  // 唯一精确判据 = `expect(<含顶层 &&/|| 的表达式>).toBe(true|false|Truthy|Falsy)` 且**无第二实参消息**
  // ——失败输出只有 expected false to be true，无任何 diff，与 Go 侧裸 t.Fatal 同等失语。
  // 与上方 check-e2e-hygiene 的 R2（尺寸稀释）**刻意不同**：R2 静态不可判（`toBeGreaterThan(0)`
  // 在「应当报错」的测试里是正确的），故 R2 只做非阻断普查、不进基线；本闸只收确定性形态。
  // blockPolicy: debt —— 存量 5 处在基线内（只减不增），清完即升 hard 作纯防回归锁。
  // 不置 scopedFiles：全仓测试文件套件级判据，单文件裁剪无意义（成本实测 ~110ms/538 文件）。
  {
    tool: "check-vitest-assert-quality.ts",
    blockPolicy: "debt",
    debt: debt("存量 5 处失败失语断言在基线内；判据确定性无假阳性，清完即升 hard", REVIEW_BY_OBSERVE),
  },
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
    debt: debt(
      "行级判定已消存量冒充，观察一轮 push/CI 实况再议升 hard（ADR-256 D5）",
      REVIEW_BY_OBSERVE,
    ),
    scopedFiles: true,
  },
  // ── 三档位阈值扫描器（2026-09-13 接线）──
  // 此前是「无守护债务」：仓库 32 个 check-*.ts 中这 3 个无任何自动化入口，只能手动跑
  // （实证：views 域 10 个 🟥 复杂度档长期无人拦，见 pre-push-gate.md 门禁覆盖边界）。
  //
  // blockPolicy: debt —— 这三者是**全库阈值 + 增量裁剪**模式：--files 只把扫描范围收敛到
  // 「本次变更文件」，但**被触碰的文件若本就超阈值仍会计入命中**（改一行注释也会红）。
  // 对比 check-file-lines 可 hard：它是显式规则表（少量受控文件，逐条 ADR 登记），不存在存量债冒充。
  // 故须待 baseline 比对落地（同 check-redlines --baseline 的「新增违规」口径）后才有资格升 hard。
  // 其中 check-type-safety 生产域当前 errors=0（--strict 实测 exit 0），观察一轮后可单独升 hard。
  //
  // scopedFiles: true → runTools 传 --files。动机有两条，缺一不可：
  //   1. 防淹没：全库跑 check-complexity 命中 301 条（27 个 🟥）、check-params 54 条，
  //      未触碰文件的存量债会把每次推送刷成全红。
  //   2. 控成本：check-params 全库墙钟 59.4s（getType() 逐参数触发类型检查），
  //      --files 裁剪到本次变更后降至 7.9s 量级，是它可挂门禁的前提。
  {
    tool: "check-complexity.ts",
    blockPolicy: "debt",
    debt: debt("全库阈值+增量裁剪：被触碰的存量红档仍计命中，baseline 未落地前不得 hard"),
    scopedFiles: true,
  },
  {
    tool: "check-params.ts",
    blockPolicy: "debt",
    debt: debt("同上：全库阈值型，存量命中会淹没本次变更"),
    scopedFiles: true,
  },
  {
    tool: "check-type-safety.ts",
    blockPolicy: "debt",
    debt: debt("同上：生产域当前 errors=0，观察一轮后可单独升 hard"),
    scopedFiles: true,
  },
];
