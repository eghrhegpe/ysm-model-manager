# ADR-189：frontend 内核目录收敛——断 core⇄backend 环、消 utils/core 与 feedback 双撞名

- **状态**：✅ 已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-05
- **决策人**：Jieling（人类首席架构师）、AI 代理（Riku，鲸鱼架构师）
- **相关**：
  - 关联代码：`frontend/src/core/`（6 源 + 6 测试，686 源码行）、`frontend/src/utils/core/`（917 行）、`frontend/src/utils/dom/feedback.ts`、`frontend/src/backend/`
  - 前置规则：AGENTS.md「查证优先」「大改动先写 ADR 再动手」
  - 反向引用：
    - [ADR-185](./ADR-185-core-features-core-features.md)（core⇄features 包级环治理——本 ADR 为同序列第二环：core⇄backend）
    - [ADR-186](./ADR-186-i18n-tr-locale-core.md)（i18n 治理：`tr` 单轨 + locale 数据外移 core——本 ADR 不动 i18n 内部，只定 core 目录准入）
    - [ADR-187](./ADR-187-features-modal-ts.md)（目录归位与上帝文件拆分范式参照）

---

## 1. 背景（Context）

ADR-185 已消 `core⇄features` 环；2026-09-05 对 `src/core` 锐评实测显示，**同一类分层病在另外两条边上复发**，且叠加两处命名冲突。

实测数据（`frontend/src` 为准）：

| 现象 | 实证 |
|------|------|
| **P1 目录级循环依赖** | `core/error-diary.ts:4` → `backend/app.ts`（`getApp()`/`AddOpLog`）；反向 `backend/web-fs.ts:35`、`web-fs-auth.ts:7`、`web-community.ts:19` → `core/i18n/t.ts`。core 名义为内核，实依赖 Wails 绑定层，靠 ESM 求值顺序侥幸不崩 |
| **P1 双 core 撞名** | `src/core`（686 源码行）与 `src/utils/core`（917 行，ADR-191 去桶化产物）同名并存；`core/error-diary.ts:6` 单行内同时出现两个 core 语义：`from "../utils/core/log.ts"`。非测试引用面 27 文件 |
| **P2 feedback 撞名** | `core/feedback.ts`（toast 原语，10 处引用）与 `utils/dom/feedback.ts`（`flashBtn` 原地闪烁原语）同名不同义；且 `core/feedback.ts:4-8` 注释自陈「放 utils 的理由已被现网证伪」——决策未落锤的活化石 |
| **P2 core 名不副实** | 6 文件 686 行撑一级目录；i18n 占 276 行（40%）为实质内容，`error-diary`（副作用注册）与 `feedback`（DOM 反馈）归属更合理的层 |
| **P3 缓存人工记账** | `core/i18n/locale.ts` 的 `_activeBundle` 靠 `refreshActiveBundle()` 在 3 处（:83/:124/:171）手动刷新；`getBundle(lang?)` 带参/无参走两条路径 |
| **P3 无界缓存** | `core/i18n/t.ts:19-28` `placeholderCache: Map<string, RegExp>` 无上限、无淘汰，安全前提（key 须为代码常量）只写在注释里，而 `interpolate` 是导出 API |
| **P3 约定无机制** | `core/page-store.ts:56` 模块求值期副作用读 localStorage；「唯一写入点」纯靠注释约束（:6-9） |
| **P4 悬空 ADR 引用** | `frontend/src` 3 处引用 `ADR-191`（`ui/ui-card.ts:2`、`utils/core/async.ts:2`、`utils/core/clamp.ts:2`），而 `docs/adr/` 实际最大编号为 188——编号不存在 |

同时**地基是好的**，故整顿而非推倒：6 文件 **67 测试全绿**（1.07s）；测试 717 行 > 源码 686 行；`t(key: LocaleKey)` 以 zh-CN 为单一类型源；`doLoadLocale` 失败不缓存空包（避 `{}` truthy 陷阱）、`setLang` 代际计数、`error-diary` 的 `.catch` 截断防日志死循环——防御性细节在仓内属上乘。

## 2. 决策（Decision）

### D1 断环：`error-diary` 改依赖注入（采纳）

`core/error-diary.ts` 不再 `import` 任何 `backend/*`。改为注入式签名：

```ts
/** 日记落盘通道（由装配层注入，core 不感知 Wails） */
export type DiarySink = (e: DiaryEntry) => void | Promise<void>;
export function registerErrorDiary(sink: DiarySink): void;
```

`AddOpLog` 适配在装配层构造（`getApp()` 归装配层职责），沿用 D1 后的 `core/i18n/t.ts` 单向被依赖格局。日志净化/去重/截断策略**留在 core**（属内核策略，非 IO）。

理由：环的根因是「内核反向索取上层能力」，注入是把依赖方向一次掰正的最小切口；文件位置是次要问题，留在 core 不再构成环。

### D2 改名：`utils/core` → `utils/base`（采纳）

消除 `src/core` 与 `src/utils/core` 的同名歧义。`base` 语义为「零依赖基元层」（`async`/`clamp`/`debounce`/`disposable`/`log`/`nbt-guards` 均为叶子模块），与「应用内核 `core`」区分。纯路径替换，非测试引用面 27 文件；`utils/core/*.test.ts` 同步迁移。

### D3 归位：`core/feedback.ts` → `utils/dom/toast.ts`（采纳）

与 `utils/dom/toast-ms.ts` 同域合并，同时消除与 `utils/dom/feedback.ts`（flashBtn）的撞名。导入侧机械替换（10 处引用面）。`core/feedback.ts:4-8` 那段自我否定的考古注释随迁移删除。

### D4 core 准入准则（采纳）

执行 D1–D3 后 `src/core` 剩 `i18n/`（276 行）+ `page-store.ts`（77 行）+ `error-diary.ts`（注入后无上层依赖）。**保留 `src/core` 目录**，但立准入准则写入 AGENTS.md：

> `core/` 只收「引擎无关、且不依赖 `backend/` `views/` `features/` 的内核能力」；需要上层能力的模块一律走注入，不得直接 import。新增模块先问：它能不能在没有 Wails、没有 DOM 的情况下单测？不能 → 不进 core。

i18n 与 page-store 留守（前者由 ADR-186 定调、后者是纯状态）；`error-diary` 经 D1 后满足准则。

### D5 附带加固（采纳，独立于目录迁移）

| 项 | 方向 |
|---|---|
| `locale.ts` 缓存 | `_activeBundle` 改派生 getter 或统一 invalidate 入口，消灭 3 处人工刷新；`getBundle(lang?)` 两条路径合一 |
| `t.ts` 插值 | 去掉 `placeholderCache` + `new RegExp`，改 `split('{k}').join(v)`——性能同级、无界风险归零 |
| `page-store.ts` | 状态闭包化 + 单一 setter，把「唯一写入点」从注释约定升级为编译期事实 |
| `error-diary.ts:104` | `status: string` 收窄为 `"failed" \| "warn"` 联合类型 |
| 悬空引用 | `frontend/src` 3 处 `ADR-191` 更正为实际编号或删除（随 D2 一并处理） |

### D6 注释纪律（采纳）

审核结论（「P2 修复（审核）」「措辞订正（2026-09-05 增量深评）」等）沉淀至知识卡 / 本 ADR；代码内只保留一句 why + 指向 ADR/知识卡的链接。`error-diary.ts` 注释占比近 45%，是首个治理样本。

## 3. 后果（Consequences）

**正面**

- `core` 依赖出边收敛为 `bus` + `utils` + `locales`，**目录级环清零**，`core` 可脱离 Wails 单测
- 双 core / feedback 撞名消除，AI 与新人定位成本下降；`utils/base` 名实相符（叶子基元）
- D5 消除 2 处「缓存靠人记账」隐患与 1 处无界 Map

**负面 / 成本**

- D2 触达 27 文件、D3 触达 10 文件，为纯机械替换但 diff 面大；须与并行会话错峰，避免与兄弟 AI 改动互卷
- D1 引入注入签名，装配层（app 启动处）增加一处适配代码——换来的是 core 可测性
- 目录迁移期 `git blame` 断裂，需 `--follow` 追溯

**已知遗留**

- `src/core` 体量仍小（约 350 行）；若后续再次萎缩至仅 i18n，届时评估是否升为 `src/i18n/` 并撤销 `core`——本 ADR 不预设该结论
- `utils/core/async.ts` 等文件的 ADR-191 引用属历史笔误，实为去桶化动作；D5 只更正编号，不回溯追责

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `wc -l` on `frontend/src/core/**` | 12 文件 1403 行 = 源码 686 + 测试 717；`i18n/` 276 行 |
| `grep -rn "core/" backend/` + core 出边扫描 | 双向依赖实证：`error-diary.ts:4` ↔ `web-fs.ts:35` / `web-fs-auth.ts:7` / `web-community.ts:19` |
| `grep -rl "utils/core/" --include=*.ts frontend/src \| grep -v test` | 非测试引用面 27 文件（D2 成本） |
| `grep -rl "core/feedback" --include=*.ts frontend/src \| grep -v test` | 引用面 10 文件（D3 成本） |
| `ls utils/dom/ \| grep -i feedback` | 撞名实证：`utils/dom/feedback.ts`（60 行 `flashBtn`） |
| `ls docs/adr/ \| grep -c ADR-191` | 0 → `frontend/src` 3 处引用为悬空编号 |
| `npx vitest run src/core` | 6 文件 67 测试全绿（1.07s）——整顿前地基已绿，迁移后须保持同数量级通过 |
| `node scripts/new-adr.ts` | 最大编号 188 → 占号 ADR-189 |
