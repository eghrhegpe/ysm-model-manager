# ADR-208：features 层治理收口：seam 门禁 / 400 行红线 / 菜单事实源 / i18n

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-09
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-040(≤400行) / ADR-190(D1a DOM模板归views, D2 注入真化) / ADR-021 B(菜单即数据) / ADR-045(i18n三语); frontend/src/features; scripts/check-layering.ts`

---

## 1. 背景（Context）

features 层模块锐评（2026-09）发现四条「红线靠注释、不靠门禁」的治理债：

1. **seam 门禁缺位**：ADR-190 D2「注入真化」建了三个组合根 seam（`backend-deps` / `community-deps` /
   `context-menu-deps`，文件头自声明「禁止业务代码绕过本模块直接 import backend/app」），
   但 `dialogs/rename`、`dialogs/adv-filter`、`dialogs/tag-editor`（生产默认 `getApp`）与
   `maintenance/recycle-bin`（PROD_DEPS）四处仍直接 import `@/backend/app.ts`。条款只活在注释里，
   无 check-layering 兜底（既有 R0-R4 只判五层方向，`backend/` 不入层天然豁免）。
2. **ADR-040 400 行尺度的两处越线存量**（口径校准：该红线条文为「**拆分后**每文件 ≤400 行」——
   附着于拆分产物，非对任意文件的持续约束；实际执行面 = `api-break`/`audit-split --redline`
   在 ref 对比时检查 modified+added 中 >400 行文件，**不在 pre-push 全量闸内**，未触碰的超限文件
   处于休眠态）：`community/download-queue-store.ts` 438 行——知识卡明记「ADR-040 红线拆分产物」，
   谱系内真实违规；`dialogs/batch-rename.ts` 499 行——非拆分产物、休眠态，但其中 44 行内嵌 HTML
   字符串与 ADR-190 D1a「DOM 模板归 views，组合根注入，features 不自渲染」相悖（`recycle-bin`
   已按 D1a 落地，dialogs 域未跟）。P4 改动会使两文件进入发布 diff → 收口到 ≤400 行一次答清。
3. **workshop 右键幽灵菜单绕过菜单事实源**：`community/events.ts` 手搓 `menu:show` 载荷，
   四条 `onClick: () => {}` 空动作，且完全绕开 `menu-defs.ts`（ADR-021 B 唯一事实来源）与
   `context-menus.ts` 的过滤链（visibleWhen 护栏 / canWebAction viewer 过滤 / divider 折叠）。
4. **i18n 硬编码漏网**：`community/events.ts` 与 `import/executor.ts` 各有一处 toast 文案
   裸写中文，绕过 ADR-045 三语言包纪律（`workshop.downloading` 键已存在、语义等价却未被复用）。

## 2. 决策（Decision）

- **D1（seam 门禁化）**：check-layering 新增 **R5（零容忍）**：`features/**` 生产文件（测试文件已由
  扫描层豁免）运行时 import `backend/app.ts` 即违规；唯一白名单 = features 下 `*-deps.ts` seam 文件
  （根 `backend-deps.ts` + 目录级 `community-deps.ts` / `context-menu-deps.ts`）。
  配套迁移：四债务文件的「生产默认 getApp」一律改经根 seam `backendGetApp()`（ADR-190 D2 注入真化的
  既定形态——`deps?.fn || seamDefault`），迁移后 R5 零基线落地（无需 TRACKED 反向边文件）。
  理由：seam 是「注入替身 + 模块层 vi.mock」双通道测试的前提；白名单按文件名（`*-deps.ts`）而非路径
  枚举，新增目录级 seam 零改门禁。
- **D2（400 行尺度存量收口，不开新闸）**：只收敛上述两处存量，不新建持续 LOC 门禁（400 行检查保留在
  `api-break`/`audit-split --redline` 的 ref 对比执行面，pre-push 不纳入——diff 级检查对休眠存量无感，
  持续闸误报成本高于收益）；两处均因 P4 改动本身进入发布 diff，收口到 ≤400 行：
  - `batch-rename.ts`：内嵌 HTML 模板（表单 + 预览行）按 D1a 先例抽到
    `views/app-tree/tpl-batch-rename.ts`，经 `showBatchRenameDialog` 新增的注入参数传入（缺省 fail-loud，
    同 `RecycleDeps.renderListHtml` 先例）；超限残部按关注点拆兄弟文件，两文件均 ≤400 行。
  - `download-queue-store.ts`：web 平台下载入库分支（ADR-123 P1 的 fetch→IDB/直链兜底链路，含
    `triggerAnchorDownload` 与两个 WEB_DOWNLOAD 常量）抽独立模块；store 保留 STATE 单一写入纪律 +
    ADR-039 §2.2 Events.On 豁免注册块（注册位置不动，风险最小）。
- **D3（workshop 菜单移植 menu-defs，杀灭幽灵菜单）**：`CtxShowPayload.type` 联合扩
  `"workshop"`（闭集扩展，消费端 `buildMenuItems` 按 type 查表，无穷尽 switch 消费者，新增成员
  零回归）；`menu-defs.ts` 增 workshop 声明（4 条展示项挂既有 `"noop"` action——纯展示语义
  行为与现状等价，UX 不变、事实源归一）；模型细节经可选 payload 字段
  `workshop?: { name; path; hash?; size? }` 传递。`community/events.ts` 的 contextmenu 绑定改发
  `ctx:show`（走 orchestrator 过滤链），删除裸发 `menu:show` + 空 onClick 项 + `m.size!` 断言。
  理由：AGENTS 红线「新增 UI 功能必须可被菜单体系调用，审核专门杀灭或移植相关菜单」；
  noop 展示项是 `instance`/`batch` 标题项的既有模式，移植即合规。
- **D4（i18n 收口）**：`events.ts` 硬编码串复用既有键 `workshop.downloading`（「正在下载中，请稍候」
  语义等价）；`executor.ts` 超限提示新增键 `import.fileTooLargeSkipped`（参数 name/mb），三语言包
  同步补齐（`locales-consistency.test` 兜底）。

## 3. 后果（Consequences）

- **正面**：四条自声明红线全部获得可执行门禁/结构兜底；`features → backend/app.ts` 边收敛到
  3 个 seam 文件（可从 7 处直接 import 证明）；menu-defs 契约测试（`expectItemsMatchDef` 遍历全表）
  自动覆盖新 workshop 声明；batch-rename 与 store 回到 ADR-040 红线下。
- **负面 / 代价**：`showBatchRenameDialog` 签名加注入参数（`views/app-tree/bus-handlers.ts` 需同步
  传入 tpl；features 测试注入桩模板）；`CtxShowPayload` 扩联合成员——任何未来对 type 做穷尽
  switch 的新消费者需感知 `"workshop"`；check-layering 新增 R5 后，后续新增 features 文件误引
  `backend/app.ts` 会直接红（这是预期行为，不是误报）。
- **已知遗留**：dialogs 域其余内嵌 HTML 文件（rename/adv-filter/tag-editor，均 <400 行未越红线）
  暂不做 D1a 模板外抽——按「改动即顺手收敛」原则，留待下次触碰时迁移，避免 23 文件大爆炸；
  ADR-039 §2.2 Events.On 常驻注册豁免本身不变（生命周期=应用生命周期）。

## 4. 数据溯源

| 来源 | 结果 |
|---|---|
| 模块锐评：`features` 全量 import 矩阵（46 实现文件 / 7.1k LOC / 33 测试文件） | 债务清单：4 处 backend/app 直引 + 2 处 >400 行 + 1 处幽灵菜单 + 2 处 i18n 硬编码 |
| `scripts/check-layering.ts` L43-59（LAYER_ORDER 不含 backend） | R5 必须独立于五层判定，按目标精确匹配 `backend/app.ts` |
| `recycle-bin.ts` `RecycleDeps.renderListHtml` fail-loud 先例（ADR-190 D1a） | D2 注入缺省 throw 范式 |
| `menu-defs.ts` MENU_ACTIONS 含 `"noop"`（instance/batch 标题项先例） | D3 展示项合规挂法 |
| `locales` 三语 `workshop.downloading` 既有键 | D4 复用不新增 |

<!-- 文件名: features-governance.md → 实际文件 ADR-208-features-governance.md -->
