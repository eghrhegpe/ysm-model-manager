# ADR-146：TS 路径别名与反桶契约

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-01
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-138-preview-3d-to-src.md`、`frontend/tsconfig.json`、`frontend/AGENTS.md`、`scripts/doctor.ts`

---

## 1. 背景（Context）

### 1.1 路径深度本身是健康的，痛点不在深度

全量扫描 `frontend/src`（720 个 `.ts`，2607 条 import）显示目录层级很浅：

| 指标 | 实测 |
|------|------|
| 文件目录深度（相对 `src/`） | 0 层 9 / 1 层 225 / 2 层 428 / 3 层 58，平均 1.74，**无 ≥4 层** |
| import 上跳 ≥5 级 | **0 条** |
| import 上跳 4 级 | 12 条，全部指向仓库根 `resource_types.json` / `bindings/**`（跨出 frontend 边界） |
| import 上跳 3 级 | 194 条（7.4%），其中 src 内部 153 条 |
| 路径别名 | **无**（`tsconfig.json` 无 `paths`，vite 无 `resolve.alias`，100% 裸相对路径） |

结论：不存在"路径太深看不懂"的问题。153 条内部三级上跳集中在两个自己就在第三层的目录（`views/app-content/{diagnostics,site}` 113 条、`utils/dom/dialogs/*` 22 条），是结构产物，不是腐坏。

### 1.2 真实痛点是「迁移代价」，不是「阅读代价」

ADR-138 把 `features/preview-3d` 上提为 `src/preview-3d` 时，代价是**全量相对引用重写 + 38 张知识卡 `source_files` 批量替换**。因为没有别名，物理路径与引用路径强绑定，任何目录移动都等价于一次全仓级 diff。这类迁移每发生一次，就要付一次 ADR-138 级的代价。

### 1.3 反例：catch-all 别名是神桶的温床

外部项目 MikuMikuAR（ADR-191「神桶 `@/core/utils` 去桶化」）的事故链，是本 ADR 最重要的输入：

- 别名配置为 `"@/*": ["src/*"]`（catch-all），导致写 `@/core/utils`（聚合桶，792 行）与写 `@/core/clamp`（零依赖叶）的**心理摩擦完全相同**；
- 摩擦消失后桶持续膨胀，顶部拖入 `dom` / `state` / `fileservice` / `i18n` / `feedback` / `menus` / `logger` 整套应用层；
- 纯几何模块 `skirt-analyzer.ts` 只为取一个 `clampInt` 从桶导入 → ESM 组合求值强制拉起整条应用层依赖链 → pending 微任务 → vitest fork worker 永不退出 → 测试批 **EXIT=124 被强杀**，表现为"一改就炸"；
- 最终以六档重构、抽 15 个零依赖叶、整体删除 `core/utils.ts` 收场。

**元凶不是别名，是「catch-all 别名 + 无门禁的聚合桶」这个组合。**

### 1.4 本仓处在窗口期：桶文化尚未形成

`frontend/src` 下 9 个 `index.ts`，**re-export 行数均为 0**——它们是 `app-sidebar` 551 行、`app-tree` 487 行、`app-nav` 331 行这类领域入口（各含 0–3 行普通 `export`，无一行 `export ... from`），没有一个是 barrel。

**唯一现存的 barrel 是 `src/utils/types-re-export.ts`**：13 行、re-export 占比 100%，但只从 **1 个目标模块**（`bindings/.../go/types/models.ts`）转发 5 个类型符号，注释写明职责是"bindings 深路径收口垫层——生成路径变化只需改此处"。这是**转发垫层**而非**聚合桶**：价值恰恰在于把易变路径收口成单一事实来源，与 ADR-191 那种"从十几个模块聚合一切"的神桶性质相反。该样本直接决定 D3/R1 的度量口径（按 re-export 来源模块数判定，不按行数——它只有 13 行，行数阈值会漏报）。

这给了本仓后发优势：别名尚未引入、聚合桶尚未长出。**引入别名的同时把桶掐死，是成本最低的时点**；等 `utils/dom` 这类天然聚集地自然膨胀后再治理，就是复刻 ADR-191 的六档工程。

---

## 2. 决策（Decision）

### D1. 只做目录级别名，永久禁止 catch-all

`frontend/tsconfig.json` 的 `paths` 与 `vite.config.js` 的 `resolve.alias` 同步登记**顶层目录白名单**：

| 别名 | 目标 | 说明 |
|------|------|------|
| `@/preview-3d/*` `@/views/*` `@/utils/*` `@/backend/*` `@/core/*` `@/ui/*` `@/features/*` `@/workers/*` `@/services/*` `@/wasm/*` `@/test-utils/*` | `src/<同名目录>/*` | 手写源码顶层目录，逐一显式登记 |
| `#root/*` | 仓库根 `../*` | **过渡措施，只减不增**。消灭 `../../../../resource_types.json` 类跨仓根引用，仅存量可切换（见下方约束） |
| ~~`@/*`~~ | — | **禁止**。不得配置通配到 `src` 任意深度的 catch-all |

理由：catch-all 让"引桶"和"引叶"成本相同，是 §1.3 神桶的直接成因。目录级白名单保留了「必须写到具体模块」的那一丝摩擦，这丝摩擦就是刹车片。新增顶层目录须同步登记别名，由 D3 门禁核对白名单与磁盘目录一致。

**bindings 不纳入别名**：`bindings/**` 由既有 `vite-wails-bindings-resolve.ts` 插件解析（Wails 生成物，非手写源码）。若实施时验证确认别名与插件无冲突，可另行追加 `#bindings/*`；有冲突则维持插件解析，不为其破坏既有链路。

#### `#root/*` 过渡性约束

`#root/*` 压低的是**症状的音量**（`../../../../resource_types.json` 之所以刺眼，不只是长，是它在语义上喊"frontend 在越界读仓库根"），耦合本身并未消除。因此它必须有收敛方向，不能成为又一个永久兜底：

1. **过渡措施，不是终态**。终态是 frontend 经 binding / bridge 由 Wails 侧注入这些数据，不再直接读仓库根 JSON。本 ADR 不锁定终态时间点。
2. **只减不增**：仅允许存量 **14 条**跨仓根引用切换（`resource_types.json` 9 + `creators.json` 1 + `workshop-github.json` 1 + `workshop_sites.json` 1 + `e2e/mock-data.ts` 2）；**任何新建文件不得新增跨仓根引用**。
3. **机器强制**：收敛由 D3 的 R4 冻结基线把关，不依赖人工记忆或 code review 自觉。
4. 别名落地后 `src/utils/types-re-export.ts` 这类垫层**继续保留**——它是 bindings 路径的单一事实来源，与别名互补而非冲突。

### D2. 反桶契约（写入 `frontend/AGENTS.md`）

1. **禁桶**：不新增任何以 re-export 为主体的聚合文件——**不限于 `index.ts`**，含 `*-re-export.ts` 这类命名（`src/utils/types-re-export.ts` 证明桶不一定叫 index）。现有 9 个入口 `index.ts` 保持真模块身份；`src/utils/types-re-export.ts` 作为来源模块数为 1 的 bindings 转发垫层，列为白名单存量允许保留。
2. **叶契约**：零依赖 / 纯模块禁止从聚合模块导入，必须引具体叶。照搬 ADR-191 决策 1 的判定——新建叶须零依赖（import 仅自身或同为叶）。
3. **不为省一行 import 建桶**：需要多符号时逐个 import 具体模块，禁止新建"公共出口"聚合文件。
4. **聚合模块若已存在**，只许在**同层**被引用（业务层引业务层），不得被更底层的纯 / 叶模块反向引用。

### D3. 门禁 `scripts/check-path-hygiene.ts` 接 doctor

五条规则，阈值即契约：

| 规则 | 判定 | 级别 | 白名单 |
|------|------|------|--------|
| ~~R0 别名闸~~ | ~~（已随闸二删除，2026-09-01）~~ | — | — |
| **R1 聚合桶嫌疑** | 单文件 re-export **来源模块数 ≥ 3** | WARN（观察期） | `src/utils/types-re-export.ts`（转发垫层，来源数=1，天然不触发） |
| **R2 目录深度** | 相对 `src/` 深度 ≤ 3 | WARN（观察期） | 无 |
| **R3 import 上跳** | ≤ 3 级 | WARN（观察期） | 跨仓根资源允许 4 级（`resource_types.json` / `creators.json` / `workshop*.json` / `bindings/**` / `e2e/mock-data.ts`） |
| **R4 跨仓根冻结** | 越过 `frontend/src` 边界且非 bindings 的引用条数 ≤ 冻结基线 | **FAIL** | 基线清单（脚本首跑冻结，当前非 bindings 部分 14 条） |

**R1 度量口径——按 re-export 来源模块数，不按行数或占比。** 本仓样本 `types-re-export.ts` 只有 13 行、re-export 占比 100%，任何带行数下限的阈值都会漏报它；而 ADR-191 神桶的本质特征是"从多个模块聚合一切"。按来源数判定可以同时做到：放过兼容垫层（来源数 1）与二元转发（来源数 2），抓住真正的聚合桶。

**R4 直接 FAIL，不进观察期。** 理由：冻结基线是确定事实（当前 14 条），不存在阈值误判问题；"只减不增"若靠人工记忆必然失守，必须由机器在首次违规时就拦住。

**WARN 升级判据（防"永久 WARN"）**：观察期 **≤ 2 周**。满足以下全部则升 FAIL——① R1/R2/R3 零误杀（9 个真模块 `index.ts` 与 `types-re-export.ts` 均不触发）；② 零漏报（抽检确认无新增聚合桶）。出现误杀则调整阈值并**重启 2 周观察期**。定这条判据的理由：WARN 起步最大的风险是永久 WARN——人人都看得见警告、没人当回事，最终门禁等于没有，比不设门禁更危险。

### D4. 别名解析是别名的前置条件；启用分两闸

`auto-import*` 家族、`check-layering`、`check-circular`、`check-tpl-refs` 等按路径文本解析的脚本，必须先支持别名解析，**然后才开闸启用别名**。顺序颠倒会让门禁集体失明——别名一上，所有基于相对路径的环检测 / 分层检测都静默失效。

但脚本改造不是一次提交能完成的（裸相对路径文本匹配 → 别名感知解析，本身是一次有风险的重构）。改造中途若已有代码使用别名，环检测与分层检测会出现**假阴性**：不是报错，而是"检测不到"。假阴性比 catch-all 更危险——门禁看起来仍在正常运转，实际已经瞎了。因此启用必须分两闸：

| 闸 | 内容 | R0 状态 |
|----|------|---------|
| **闸一（配置闸）** | 登记 `tsconfig.paths` + `vite.resolve.alias`，类型检查与构建可用；**尚无任何代码使用别名** | 生效：含别名的 import → FAIL |
| **闸二（使用闸）** | 脚本别名解析改造完成 + 单测全绿 → 撤销 R0 → 启动 D5 增量迁移 | 整条规则删除 |

- **闸二准入条件**：上述脚本全部支持别名解析，且有单测覆盖别名路径的解析。
- **撤销 R0 的提交须同时删除 R0 规则本身**，不留死规则占位。
- **与 D5 的关系**：D5「新文件一律用别名」自**闸二**起生效；闸一期间新文件仍写相对路径。两闸之间不存在"别名已可用但门禁看不见"的窗口期。

### D5. 增量迁移，禁止一次性 codemod 全量重写

- **新文件**一律用别名（自 D4 闸二起生效，闸一期间仍写相对路径）；
- **存量文件**保持相对路径，仅当该文件因其他原因被修改时，顺手把该文件内全部 import 切成别名（保持单文件内一致，不产生混用）；
- **禁止**跨文件批量 codemod。理由：全量重写等于再来一次 ADR-138 级 diff，收益（消除 153 条三级上跳）与风险不匹配。

---

## 3. 后果（Consequences）

**正面**

- 目录移动不再等于全仓重写：别名切断物理路径与引用路径的强绑定，ADR-138 那样的迁移代价不再重复发生。
- `#root/*` 消灭 14 条跨仓根引用中最刺眼的一批（含 5 条四级上跳）：`../../../../resource_types.json` → `#root/resource_types.json`，且 R4 冻结基线使其只减不增。
- 桶被掐死在窗口期：9 个 `index.ts` 的 re-export 行数均为 0，唯一 barrel 样本 `types-re-export.ts` 是来源数为 1 的转发垫层（R1 不误杀），门禁从零违规基线起步。
- 门禁让"深度 ≤3、无桶"这个现状变成可回归的契约，而非口头共识。

**负面 / 代价**

- 双写成本：`tsconfig.paths` 与 `vite.resolve.alias` 必须保持一致，漏配一侧会导致类型检查通过但构建失败（或反之）。由 D3 增加一致性校验对冲。
- 存量混用期：D5 的增量策略意味着别名与相对路径将长期共存，静态阅读时两套风格并存。
- 脚本改造面：D4 涉及的脚本数量需要逐个确认解析逻辑，是本 ADR 中工程量最不确定的一项。
- `#root/*` 越过 frontend 边界引用仓库根 JSON，本质上仍是跨层依赖，别名只改善可读性、压低症状音量，不消除耦合——故 D1 明定其为过渡措施并配 R4 收敛。
- R1 按"re-export 来源模块数"判定，对**人为拆桶规避**无效（把聚合桶拆成 3 个文件、各 re-export 1 个模块即可绕过阈值）。门禁拦的是自然生长的桶，不拦蓄意规避；这类情况仍依赖 D2 契约与 review。

**遗留 / 不做的事**

- 不做 catch-all `@/*`——§1.3 已证明其代价。
- 不做存量全量迁移——见 D5。
- 不改 bindings 解析链路——见 D1，除非验证无冲突。
- `#root/*` 是过渡措施不是终态，只减不增，终态由 Wails 侧 bridge 注入——见 D1 约束，本 ADR 不锁定终态时间点。
- 不解决 `views/app-content` 与 `utils/dom/dialogs` 的第三层结构本身：那 153 条上跳在别名落地后依然存在（只是变短），若未来要治，属另一决策。

---

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `tmp/path-depth.mjs`（720 个 `.ts` 全量扫描） | 目录深度 0:9 / 1:225 / 2:428 / 3:58，平均 1.74，≥4 层 0 个 |
| 同上（2607 条 import 正则扫描） | 上跳分布 0:1169 / 1:490 / 2:754 / 3:182 / 4:12；≥5 为 0 |
| `tmp/path-depth2.mjs`（内部 ≥3 上跳目录对） | views→utils 60、views→core 19、views→backend 19、views→bus 15；utils→utils 9、utils→core 8 |
| `scripts/analyze-knowledge-refs.ts --json --no-write` | 450 条 source_files 引用，深度 ≥5 的 43 个（ADR-138 时期基线 72 个），断链 0 |
| `find frontend/src -name index.ts` + `export` / `export ... from` 分别计数 | 9 个 `index.ts`：**re-export 行数均为 0**，普通 `export` 0–3 行（`app-tree` 3、`app-sync-manager` 2、`test-utils` 8 等） |
| `tmp/cross-boundary.mjs`（越过 `src` 边界解析） | 51 条（含 1 条注释误报，实际 **50 条**）：`bindings/**` 36 / `resource_types.json` 9 / `e2e/mock-data.ts` 2 / `creators.json` 1 / `workshop-github.json` 1 / `workshop_sites.json` 1；涉及 39 个文件 → 非 bindings 部分 14 条 = R4 冻结基线 |
| `src/utils/types-re-export.ts` 全文 | 13 行、re-export 占比 100%、**来源模块数 1** → R1 度量口径校准样本（行数阈值会漏报它，来源数阈值会放过它） |
| `frontend/tsconfig.json` / `vite.config.js` | 无 `paths`、无 `resolve.alias`；bindings 由 `wailsBindingsResolve` 插件解析 |
| 外部经验 MikuMikuAR `docs/adr/adr-191-god-barrel-debarreling.md` | `@/*` catch-all + 792 行聚合桶 → ESM 组合求值 → vitest EXIT=124 |
