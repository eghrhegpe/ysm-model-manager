# ADR-256-d1：存量债到期制：debt 条目必须带 reason 与 reviewBy，到期由 doctor --all 硬处置

- **状态**：✅ 已采纳（Accepted）
- **日期**：2026-10-09（实施与 CI 验证同日完成，用户逐刀批准）
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **关联主 ADR**：ADR-256
- **相关**：`scripts/_lib/gate-debt.ts / scripts/_lib/gate-config.ts / scripts/_lib/gate-coverage.ts / scripts/pre-push-gate.ts / scripts/debt-report.ts（CI STEP_SUMMARY 呈现出口）`

---

## 背景（一句）

ADR-256 D5 把「行级判定落地后先观察一轮、再议升 hard」写成了一句**手写的意图**——没有日期、没有归属，于是
`blockPolicy: "debt"` 在实践中退化成第三种状态：「没拦也没撤、永远只记一笔」。实测代价（第三轮技术债审计头条）：
增量维度清除优秀、**存量维度接近零**——knip 3 周 +45%、css-token 308 三次触碰零收紧、design-tokens 112
冻结，而体系对外的词是「全绿」。

## 决策（三行）

1. **类型强制**：`GateTool` 拆判别联合，`blockPolicy: "debt"` 分支**必须**携带 `debt: { reason, reviewBy }`
   ——没声明理由/期限的债，`tsc -p scripts/tsconfig.json` 直接编译不过（沿用本仓「用类型消灭隐式约定」的先例）。
2. **可见性常态**：门禁固定尾行新增「阻断构成(N 项清单条目): hard X / debt Y（debt FAIL 只记不拦；
   最近复审（工具名 + 到期日 + 剩余天数））」——「44 项已接入」不再被读成「44 道闸都在拦」；
   debt 项 FAIL 时 note 追加债务期限（`已逾期 N 天，须处置或续期`）。
3. **到期硬处置只发生在 `doctor --all`**：有逾期债 ⇒ 记一条 hard FAIL 逼一次显式决策（修 / 升 hard / 带理由改
   `reviewBy`）；**刻意不进 push 热路径**——存量债与本次变更无关，拿它挡住无关推送者正是本仓反复吃亏的
   「假红训练人忽略红灯」，blast radius 收敛到刻意的全量闸。

## 后果（一句）

债不再能无限期沉默：每笔债带理由与最迟 180 天的复审日（契约测试拒超视界），到期在发版前全量闸变红；
新增成本仅是每条 debt 两行元数据 + 每次运行长一点的尾行。回退方式：`_lib/gate-debt.ts` 与三处接线各自独立，
删尾行构成/删 `--all` 盘点段即回到旧行为（类型强制可单独保留）。

<!-- 文件名: gate-debt-expiry.md → 实际文件 decisions/ADR-256-d1-gate-debt-expiry.md（ADR-320 decisions 轻量模板） -->
