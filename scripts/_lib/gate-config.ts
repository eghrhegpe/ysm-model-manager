/**
 * gate-config.ts — pre-push-gate 静态工具清单**单一配置层**（清单总表 + 展平序）。
 *
 * 设计意图：pre-push-gate.ts 职责是「按域调度检查」，但它长期内联了 4 个工具清单
 * （ALL / DOC / FRONTEND / GO，合计 40+ 项）。新增检查时同时改 gate 和清单的两处描述
 * 极易漂移（ADR-088 Take巧 #3 实证）。本模块把清单数据与 gate 调度逻辑解耦。
 *
 * 结构（2026-10-25 沿真缝拆分，ADR-234 D3 `_lib` 400 行硬红线）：
 *   本文件       —— ALL_STATIC_TOOLS（全量兜底表）+ 五张清单的固定展开序 + flatten
 *   ./gate-tool-types.ts    —— GateTool 判别联合 / GateToolBase / BlockPolicy / debt() 内核
 *   ./gate-config-docs.ts   —— DOC_STATIC_TOOLS + DOC_EXTRA_SCRIPTS
 *   ./gate-config-go.ts     —— GO_STATIC_TOOLS + SCRIPTS_TYPECHECK
 *   ./gate-config-frontend.ts —— FRONTEND_STATIC_TOOLS（最大一簇，并行会话热点）
 *
 * 为什么 ALL 表留在本文件：它是**全量兜底**，也是「只减不增型闸一律双挂」的落点；
 * 契约测试（tests/test_commit_message_gate.ts / test_orphan_exports_smart.ts）以
 * 本文件全文子串断言某些闸必须入册——入册口径钉在这里比钉在域文件更难被搬空。
 *
 * 导出面**保持不变**：域清单经 re-export 从本文件透出，消费方（pre-push-gate /
 * gate-coverage / debt-report / gate-blocks）import 路径零改动。
 *
 * 数量口径（勿沿用旧快照）：ALL_STATIC_TOOLS 唯一条目数与域子集大小每次以脚本实测为准；
 * DOC/FRONTEND/GO 是**域子集**（与 ALL 有重叠，非追加），勿把四张表相加当总数。
 *
 * 结构（每项）：
 *   { tool, args?, autoFix? } → 带参数调用；autoFix=true 时 FAIL 自动跑写盘版刷新后重验
 *
 * 用法：
 *   import { ALL_STATIC_TOOLS, DOC_STATIC_TOOLS, FRONTEND_STATIC_TOOLS, GO_STATIC_TOOLS }
 *     from './_lib/gate-config.ts';
 *
 * 依赖：./gate-tool-types.ts（类型 + debt 内核）/ 三个域清单模块
 */
import { debt, REVIEW_BY_OBSERVE, type GateTool } from "./gate-tool-types.ts";
import { DOC_EXTRA_SCRIPTS, DOC_STATIC_TOOLS } from "./gate-config-docs.ts";
import { GO_STATIC_TOOLS, SCRIPTS_TYPECHECK } from "./gate-config-go.ts";
import { FRONTEND_STATIC_TOOLS } from "./gate-config-frontend.ts";

// 域清单与类型层原样透出：消费方 import 路径不变（拆分零行为变更的保证）。
export type { BlockPolicy, GateTool, GateToolBase } from "./gate-tool-types.ts";
export { debt, REVIEW_BY_LEDGER, REVIEW_BY_OBSERVE } from "./gate-tool-types.ts";
export { DOC_EXTRA_SCRIPTS, DOC_STATIC_TOOLS } from "./gate-config-docs.ts";
export { GO_STATIC_TOOLS, SCRIPTS_TYPECHECK } from "./gate-config-go.ts";
export { FRONTEND_STATIC_TOOLS } from "./gate-config-frontend.ts";

/**
 * 全量模式静态工具清单（doctor --all / pre-push-gate --all）。
 * 覆盖 Go + 前端 + 文档 + 脚本治理全栈；与域检查重叠的项（check-layering / binding-check）已剔除。
 */
export const ALL_STATIC_TOOLS: GateTool[] = [
  { tool: "check-doc-drift.ts", blockPolicy: "hard" },
  { tool: "check-adr-health.ts", blockPolicy: "hard" },
  { tool: "check-resource-manifest.ts", blockPolicy: "hard" },
  // 行数红线闸（2026-10-25 补网）：此前**只**挂 FRONTEND_STATIC_TOOLS，于是两个洞——
  //   ① `doctor --all`（发版前全量闸）从不跑它：ALL 表才是 --all 的执行面；
  //   ② 改 scripts/_lib 的推送 plan.frontend=false → 本地 push 漏检，只剩 CI --static 兜底
  //      （实证：gate-config.ts 509 行破 503 红线，本地 pre-push 仍报 PASS）。
  // 补进 ALL 后 --all / --static 同跑；scripts 域的本地补跑见 gate-blocks/schedule.ts
  // （plan.contractTests 分支，条目仍从本表取，不复制第二份定义）。
  { tool: "check-file-lines.ts", blockPolicy: "hard" },
  {
    // 双挂第二重（「只减不增型闸一律双挂」）：commit-msg 钩子可被 `git commit --no-verify`
    // 整钩绕过（零痕迹），此处按**推送集**复验兜住。
    //
    // 2026-10-25 刀2 开闸（ADR-338-d1 D3 第二步）：blockPolicy debt → hard + args 加 --strict。
    // 阻断面**不是**全部 hard 规则——`BLOCKING_RULES` 白名单只含 subject-empty / subject-prefix
    // （依据：replay 300 里 prefix 命中 4 条全是真阳性、修法是一行加前缀；而 subject-length
    // 占 35% 且多为单主题偏长，硬拒等于让闸「数长度」）。其余 hard 命中照旧只提示。
    // 判定域 = merge-base(origin/main, HEAD)..HEAD（只查本次推送集，不追溯已推历史）。
    tool: "check-commit-message.ts",
    args: ["--range", "auto", "--strict"],
    blockPolicy: "hard",
  },
  {
    tool: "check-boolean-naming.ts",
    blockPolicy: "debt",
    debt: debt("命名启发式命中：值语义需人工判断，规则本身非确定性"),
  },
  {
    tool: "check-circular.ts",
    blockPolicy: "debt",
    debt: debt("全库循环依赖存量；--files 裁剪后只对本次变更面判定"),
  },
  {
    tool: "check-orphan-exports.ts",
    blockPolicy: "debt",
    debt: debt("导出面宽于消费面（多为缺 export 关键字/re-export），需分档回收"),
  },
  {
    tool: "check-deadcode-baseline.ts",
    blockPolicy: "debt",
    debt: debt("knip/jscpd 棘轮账本；噪声已分离，回收需分「删关键字」与「真删码」"),
  },
  {
    tool: "jscpd-go.ts",
    blockPolicy: "debt",
    debt: debt("Go 侧克隆基线；含有意保留的兼容入口，需逐对判断"),
  },
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
  {
    tool: "check-proc-adoption.ts",
    blockPolicy: "debt",
    debt: debt("进程调用收口未完成的存量站点"),
  },
  {
    tool: "check-lib-adoption.ts",
    blockPolicy: "debt",
    debt: debt("共享能力未走 _lib 的存量站点"),
  },
  { tool: "check-workflow-refs.ts", blockPolicy: "hard" },
  { tool: "check-readme-index.ts", blockPolicy: "hard" },
  // docs markdown 裸标签（2026-09-19 接线）：VitePress 用 Vue 编译器解析 md，行内代码之外的
  // 裸 `<tag>` 会让整站构建抛「Element is missing end tag」——Pages 曾因此静默连挂 6 次（漏反引号）
  // 而断链检查/测试/CI 全绿。hard 依据：markdown-it 逐例实测 + 构建探针裁决（见脚本头「实证依据」），
  // 全 docs 语料 0 命中 → 无存量债冒充，确定性规则（同 check-workflow-refs 定位）；配套 tests/test_check_doc_markup.ts。
  { tool: "check-doc-markup.ts", blockPolicy: "hard" },
  { tool: "i18n-check.ts", args: ["--strict"], blockPolicy: "hard" },
  { tool: "i18n-ui-check.ts", blockPolicy: "hard" },
  // i18n 模块级冻结 t()（2026-10-13 第五闸）：顶层 const 初始化区内求值的 t() 把译文焊死在首查
  // 语言包上，lang:changed 不重建模块——既有 i18n 闸查「有没有包 t()」，全对「包得太早」失明。
  // hard 依据：确定性状态机（遮罩+深度跟踪），接闸日存量 15 处全清（无债冒充）；配套 tests/test_i18n_frozen_t_check.ts。
  { tool: "i18n-frozen-t-check.ts", args: ["--strict"], blockPolicy: "hard" },
  { tool: "css-layer-check.ts", args: ["--strict"], blockPolicy: "hard" },
  // a11y 覆盖基线守卫（ADR-308 D3，2026-09-26 接线）：coverage 计数下限（aria-* 按属性名 /
  // role / tabindex / prefers-reduced-motion，只增不减）+ document 级 keydown 散点上限（只减不增，
  // key-router.ts 唯一合法出口豁免）。hard 依据：确定性正则 + baseline 即存量本身，无「债冒充」；配套 tests/test_check_a11y.ts。
  { tool: "check-a11y.ts", blockPolicy: "hard" },
  {
    tool: "check-toast-duration.ts",
    blockPolicy: "debt",
    debt: debt("提示时长口径存量违规，量小但分散"),
  },
  // 设计令牌守规（2026-09 接线）：与 css-layer-check 互补——后者管「样式定义在哪一层生效」，本闸管「样式值是否走了令牌」。
  // 判定面在 FRONTEND_STATIC_TOOLS 的 `--added-lines`（真行级，ADR-256 D1）。此处**只做全库普查**：
  // 不传 --baseline、不传 --strict，恒 exit 0，只把「存量 N 条 / M 个文件」打进推送输出供收债排期。
  //
  // 为什么摘掉 --baseline（2026-10-25）：该模式的键是 `file:line:kind`，行号一动就同时产生
  // 「假新增 + 假消失」（实测 added 60 / gone 62，而真实总量是 112→110 降了 2 条）——
  // 每次 --static 都 FAIL 一条零行动价值的红，等于用噪声训练人忽略门禁。ADR-256 D1 早已
  // 把 baseline 降级为账本，账本就不该站在阻断面；普查数字由本条的 stdout 与 debt-report 承担。
  {
    tool: "check-design-tokens.ts",
    blockPolicy: "debt",
    debt: debt("全库存量普查（只报数字不判定）：110 条 CSS 令牌存量债，收债按 ADR-295 组合档节奏"),
  },
  // i18n 未使用键（2026-09）：全量模式亦挂——死键是全仓性质的，与扫描域裁剪无关。
  {
    tool: "check-i18n-unused.ts",
    args: ["--baseline"],
    blockPolicy: "debt",
    debt: debt("i18n 死键基线；含动态查表启发式成分，无法静态判定"),
  },
  // Android 平台黑名单守卫（2026-09-08 纳入）：T1 编译期差集 / T2 运行期 ADR-047 守卫未登记 → 阻断。
  // 依赖 go 工具链；不可用时脚本降级为 T3/T4（_summary.degraded=true），不会因环境缺 go 而红灯。
  { tool: "check-android-unavailable.ts", blockPolicy: "hard" },
  // ── 2026-10-08 门禁清单对账（锐评复核实测）补挂：原真·未接线的 check-* ──
  // check-comment-history：ADR-234 D1 注释考古（WARN 观察期，非阻断）；实测 176ms，errors=0。
  {
    tool: "check-comment-history.ts",
    blockPolicy: "debt",
    debt: debt("注释考古 WARN 观察期（ADR-234 D1），信号质量未验证", REVIEW_BY_OBSERVE),
  },
  // check-twin-siblings：改动同构同胞探针（纯提醒，走 _summary.warns）；实测 132ms。
  {
    tool: "check-twin-siblings.ts",
    blockPolicy: "debt",
    debt: debt("同构同胞探针为纯提醒（走 _warns），无判定力", REVIEW_BY_OBSERVE),
  },
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
  // check-cap-enabled-duality：cap 私有 enabled 字段是否与 schema 对齐（锐评 2026-10-09 P1）。
  // 确定性规则：正则扫描 + schema 键比对，零存量债。实测全仓 <100ms。
  // 当前 ground-capability 为唯一已知僵尸私有门（知识卡已声明为「暂不动」），
  // 若有新 cap 新增私有 enabled 但不补 schema 对应键，此闸报告债务。
  {
    tool: "check-cap-enabled-duality.ts",
    blockPolicy: "debt",
    debt: debt(
      "ground-capability 僵尸私有门（已声明暂不动）；若有新 cap 补对应 schema 键后 debt 归零可升 hard",
    ),
  },
  // check-env-schema-consumers：ENV_STATE_SCHEMA 键消费审计（幽灵键守卫，锐评 2026-10-09 探索）。
  // 与 check-cap-enabled-duality 互补（那个查「cap 字段必须有 schema 键」，这个查「schema 键
  // 必须有生产消费」）。实测全仓 ~300ms，当前 0 命中（收口后健康）——纯防御，未来加键忘接
  // 消费方即报告。debt 档：当前零违规不阻断，防复发为主。
  {
    tool: "check-env-schema-consumers.ts",
    blockPolicy: "debt",
    debt: debt("幽灵键守卫：当前 0 命中（纯防御），未来新增 schema 键忘接消费方即报告"),
  },
  // check-stale-test-refs：生产源码注释点名的测试引用（TestXxx / x.test.ts）必须真实存在
  // （巡检第 14 轮 F4）。与「注释承诺 > 实现」漂移的镜像形态：注释谎称「守卫 = TestXxx」
  // 但该测试早已改名/消亡，留下一条不存在的机器防线的假声明。上线时全仓清账 7 处
  // （go flow/findinst 假名 + menu 域根迁移旧名 + style ui- 前缀旧名 + fake-image 来历旧名），
  // 现 0 命中，debt 档纯防御——测试改名/删除忘同步点名注释即报告。实测全仓 <300ms。
  {
    tool: "check-stale-test-refs.ts",
    blockPolicy: "debt",
    debt: debt("陈旧测试引用守卫：当前 0 命中（纯防御），测试改名/删除后注释未跟即报告"),
  },
  // check-scene-slot-writers：scene.environment/background 槽位写者白名单闸（ADR-292 D1
  // 「写者唯一」回归红线的机器锁，锐评 2026-10-11 P1-① 补齐——此前红线零闸，仅散文+行为测试）。
  // 确定性规则（子串 + `=[^=]` 判定 + 注释行剔除），零存量债（白名单 = 现存全部合法写者）：
  // 新 cap/管线在白名单外写槽位即阻断，扩白名单须先经锐评/ADR 拍板（WHITELIST 段即拍板记录）。
  { tool: "check-scene-slot-writers.ts", blockPolicy: "hard" },
];

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
  // scripts/ TS 域 typecheck（单条闸、无独立清单，同样是一条「清单条目」——计入阻断构成，否则「44 条 hard+debt」与实况差一）。
  [SCRIPTS_TYPECHECK],
];

/** 五张清单展平（含重复；去重口径由消费方决定）。 */
export function flattenGateTools(): GateTool[] {
  return ALL_GATE_TOOL_LISTS.flatMap((l) => [...l]);
}
