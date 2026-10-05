# 3D 环境设计锐评（设计层整体审视，2026-10-05）

> 报告型文档（非知识卡）：记录本轮**设计层**（概念模型 / 信息架构 / 契约自洽性）审视的结论。
> 与既有 `docs/audit-env-review.md`（23 章，逐面板 UI + 接线**检查项**）分工不同——本报告**不重扫检查项**，
> 只回答「这套环境系统的概念骨架是否自洽、契约是否还成立」。
>
> 方法：主模型一手勘察（组合根 / 6 cap 骨架 / 槽位所有权）+ 1 名独立子代理并行只读取证（开关语义 + 槽位所有权视角），
> 主模型对子代理**最强指控逐条实地抽查**（抽查 2 条，1 条证实、1 条**降级撤销**），全程未改任何源码。
>
> 验证：`environment-capability.test.ts` + `env.test.ts` 实测 **114 passed**（这些病**没有测试能拦住**，
> 无守卫正是它们存活的原因——见 §3）。

---

## §0 总判

**健康度约七成半。** 这套环境系统的**状态层骨架是全仓最干净的部分**——`envState` 单例 + `setEnvState`
中央写入 + `lastWriteSource` 守卫（manual > auto-atmosphere > auto-model）+ schema 值域钳制，
6 cap 统一收口、组过滤派发、单一事实源，主干无异议。子代理独立复核 `scene.environment` ownership
协议后给出判词：**「对称、完整，我确认无缺口」**——本报告背书该结论。

**病灶不在骨架，在「能力总开关」这一个概念的三处裂缝**：

1. **一处未过河**：6 个兄弟 cap 里 5 个已「单门收口」（私有 `enabled` 退役、真值源归 schema 键），
   **唯独 `EnvironmentCapability` 留在对岸**——它是当前**唯一活着**的「私有门 vs schema 键」病灶（§1）。
2. **一个契约被绑错**：`getMasterNodeId()` 承诺「启停整个能力」，但 `ground` 绑的是**可见性**开关（§2）。
3. **一套归属机制缺席**：`getEnvPlacement()` 是「谁是环境成员」的唯一入口，`shadow` 因未实现它而
   在 schema 同族、功能同域的情况下**永久排除**在环境面板外（§4）。

三条同源：**「环境」这个概念缺少一份权威的概念模型**——谁算环境成员、什么算能力开关、开关真值源在哪，
目前是靠 `env.ts` 的收集逻辑 + 各 cap 的自觉声明**隐式**约定的，没有一处写死并受守护。

---

## §1 🔴 F-1 `EnvironmentCapability` 私有门未收口——唯一活着的幽灵键

### 证据（一手 + 实证探针双重确认）

| 检查项 | `environment` | `ground` | `sky`（已收口样板） |
|---|---|---|---|
| 私有 `enabled` 字段 | **YES** | YES | **no** ✅ |
| `saveState` 落 `enabled` | **YES** | no | no |
| `loadState` 恢复 `enabled` | **YES** | — | — |
| schema 有对应键 | **no** | （`groundVisible`） | `skyEnabled` |
| 有 UI 写口 | **YES** | no | YES（走 schema 键） |

实测探针（node 静态扫描，非读注释推断）输出如上表；源码坐标：

- 声明 + 自陈：`environment-capability.ts` 的 `private enabled` 字段，注释原文
  「**能力总开关（不入 envState**，getMasterNodeId 返回 'env-enabled'）」——**自知不入 envState 而仍然这么写**
- 构造：同文件 `this.enabled = opts.enabled ?? true`
- 唯一写口：同文件 `setEnabled(v) { this.enabled = v; this.buildEnvironment(); … }`
- 落盘：`saveState()` 内 `enabled: this.enabled`（`persistState` 直接 `JSON.stringify` → 幽灵键真进 localStorage）
- 恢复：`loadState()` 内 `this.enabled = state.enabled`
- 守卫缺席：`environment-capability.test.ts` 有 30+ 条 save/load 测试，**无一条**断言 `enabled` 幽灵键；
  而 `sky-capability.test.ts` 有专门的防僵尸门守卫
  `expect("enabled" in cap, "能力级开关唯一真值源 = envState.skyEnabled，私有门不得复活").toBe(false)`

### 为什么是病（三条后果，均已确证）

1. **开关状态不走单一事实源。** 它不在 `envState` 里 ⇒ 不参与 `lastWriteSource` 守卫、
   不参与 `dispatchEnvChange` 派发、**任何以 envState 为唯一真相的消费者都看不见它**
   （氛围预设快照 `ATMOSPHERE_PRESETS`、模型默认值 `MODEL_DEFAULTS`、跨 cap 查询）。
2. **幽灵键平行持久化。** 落盘的是无前缀 `enabled`，与全仓「开关真值源 = schema 键」范式平行——
   正是 fog/water/shadow/reflector 四兄弟在 2026-09 陆续清掉的同一种键（sky 注释原话：
   「不再落无前缀 `enabled` 幽灵键——**私有门已退役，键与门不再各说各话**」）。
3. **它还是跨 cap 协调的事实协议。** `isEnabled()` 不只服务用户开关，还被跨 cap 直调消费：
   `light` 靠 `environment.isEnabled()` 决定 ambient 让位系数（×0.5）、
   `sky` 靠 `environment.isEnabled()` 判 `scene.environment` 槽位去留。
   **一个既不是单一事实源、又承担跨 cap 协议角色的方法**——这是本仓历史上「关掉环境贴图、
   天空 IBL 也黑了」那类病的**机制温床**（该病历史上真实发生过，E-4 记录在案）。

### 修复方向（不落补丁，落 ADR）

收编为 schema 键 `envEnabled`（与 `fogEnabled`/`waterEnabled`/`reflectorEnabled`/`shadowEnabled`/`skyEnabled` 同形），
`setEnabled/isEnabled` 降为别名、渲染由 env 组回调落地。**必须保留 legacy 回填**——
`environment-migrations.ts` 的 `envEnabled` 迁移判据正在消费旧键，改名即断链，须同步迁移。
同步把 sky 的防僵尸门守卫**移植成遍历 6 cap 的守护**，让第七个 cap 出生即合规。

---

## §2 🔴 F-2 `getMasterNodeId()` 契约在 ground 上被绑错语义

### 证据

接口契约（`scene-capability.ts`）原话：**「此 cap 有启停整个能力」的唯一真值源**。
而 6 cap 的实报值：

| cap | 实报 | 语义 |
|---|---|---|
| sky | `sky-enabled` | 能力开关 ✅ |
| water | `water-enabled` | 能力开关 ✅ |
| environment | `env-enabled` | 能力开关（但真值源是私有门，见 §1） |
| fog | `fog-enabled` | 能力开关 ✅ |
| reflector | `reflector-enabled` | 能力开关 ✅ |
| **ground** | **`ground-visible`** | **可见性开关** ❌ |

`ground-menu.ts` 自己写着：「**ground 无能力总开关**（visible 是 params 级，非 getMasterToggle 语义）」，
节点绑定的是 `cap.getVisible()/setVisible()` → `envState.groundVisible`。

### 为什么是病

环境面板一级行**把 6 个 cap 排成一列**，行尾 `headerToggle` 全部由 `getMasterNodeId` 升格而来
（`menu/panels/env.ts` 的 `envCapRow`）。用户看到的是一列**同形的开关**，
但 5 个的意思是「开/关这个能力」，1 个（地面）的意思是「这块地面显示/不显示」——
**同形不同义，且 UI 上没有任何区分**。

深层后果：`GroundCapability` 的私有 `enabled`（真实的**能力**开关，`setEnabled` 做的是
完整的挂/摘 mesh 生命周期）**在全仓无 UI 写口**，生产恒 `true`；
而 `getMasterNodeId` 报的这个「可见性」节点，**语义上不该出现在这个位置**。

> ground 对此有长篇自我辩护注释（「僵尸门…防回填闸…真·根治另立 ADR」），
> **该辩护成立**——它已不落盘幽灵键、无写口、恒 `true`，我核实后判「已治但留疤」，
> 与 environment 的**活门**性质不同。但「留疤」的疤正是本节：**契约被绑错**。

### 修复方向

二选一，须拍板：① 承认「环境面板的行尾开关 = 能力开关」，给 ground 补真实的 `ground-enabled`
（收编私有门）并让 `ground-visible` 退回子视图；② 或承认「行尾开关 = 该 cap 的主开关（不保证是能力级）」，
**改接口契约文字**并让 ground 的可见性在 UI 上有别于能力开关（如视觉降级）。
**当前状态是最坏的一种：契约文字说 A，实现做 B，UI 看起来像 C。**

---

## §3 🟡 F-3 `opts.enabled` 是绕过统一写入入口的隐藏第二写口

### 证据

`SceneCapabilityRegistry.createAll` 的 ctx 类型是 `{ scene; renderer; camera }`——
**根本没有 `enabled` 字段**，唯一注入的是 `caps`：

```
const cap = factory({ ...ctx, caps: { getById: (id) => this.getById(id) } });
```

⇒ **生产链路 `opts.enabled` 恒为 `undefined`**。而三个 cap 仍保留该构造参数：
`environment`（写私有字段，即 §1 的病）、`ground`（写私有字段）、`sky`（桥到 `setEnvState`，无害）。

**它是只在测试里生效的参数**——测试可以构造出一个生产永远构造不出的门状态，
于是「测试绿」与「生产行为」之间裂开一道缝。

sky 侧作者自己标注了这个隐患（值得表扬，也说明已被识别为隐患）：
构造期走 `manual` 会打上手改足迹，**「日后给氛围预设加天空能力开关时会静默失效」**。

### 修复方向

删掉 `opts.enabled` 这条路径（启停全局只有一条语义）；确需构造期初值则在组合根显式 `setEnvState`。

---

## §4 🟡 F-4 `getEnvPlacement()` 缺席 = 永久排除——`shadow` 的同族错位

「环境」有两套并行的归属机制，**且无交集验证**：

| 机制 | 载体 | 覆盖面 |
|---|---|---|
| `getEnvPlacement()` | cap 自报 (`ADR-268`) | 环境面板**内部** 6 成员 |
| `CORE_MENU_ITEMS.dockGroup` | 菜单项声明 | 5 个 dock 组 |

`ShadowCapability` **不实现 `getEnvPlacement`**（实测 grep 零命中），其面板在
`CORE_MENU_ITEMS` 里 `dockGroup: "scene"`。但：

- schema 上它与 fog/water/reflector **同族**（`shadowEnabled` 与它们同批「单门收口」，同列 `env-state-schema.ts`）
- 功能上阴影是光照环境的核心组成
- 而 `reflector`（反射）**留在**环境面板

⇒ **分组依据是「面板外壳的历史」，不是语义。** 同类错位还有 `light`（灯光）——
最典型的「环境设计」元素，却在「场景」组。

### 修复方向

明确「环境」的边界定义并写进契约：是「场景观感参数」（则应纳入 light/shadow）
还是「三维场景的物理构件」（则应把 reflector 也划出去）。**当前两种解释都不能自洽解释现状。**

---

## §5 🟢 F-5 测试命名误导（子代理指控，本节降级）

子代理指控：`env.test.ts` 有测试 `"cap 不报 getMasterNodeId（sky）→ 一级行无 headerToggle"`，
而真 `SkyCapability` 早已返回 `"sky-enabled"` ⇒ 「测试与源码脱节，会误导后人」。

**主模型实地抽查的仲裁修正**：该测试用 `makeCap("sky", …)` **手搓 fake cap**
（不实现 `getMasterNodeId`），它测的是**框架对「未报 master 的 cap」的处理**——
**这是有效契约测试**，且实测 114 passed 在跑。
问题**仅在于命名**：拿早已不适用该场景的 `sky` 当反例，会让读者误以为 sky 无总开关。

**定级修正：从「测试脱节=病」降为「测试命名误导=🟢 可读性」。**
修复方向：改用中性 fake cap 名（如 `"nocap"`），零行为改动。

> 用户可见后果为零，故不列为缺陷。

---

## §6 明确撤销 / 判「不成立」的条目（如实登记）

子代理提出并经主模型复核如下条目**不成立或已治**，此处如实撤销以免后人重扫：

| 指控 | 判定 | 依据 |
|---|---|---|
| fog / water / reflector / shadow 双门漂移 | **已治** | 四 cap 均无 `private enabled` 字段，`isEnabled` 直读 schema 键（实测 grep） |
| sky 幽灵键 / schema 键无消费者 | **已治** | `skyEnabled`/`skyGodRaysEnabled`/`skyAutoRotate` 均有生产写口与派发分支 |
| `scene.environment` ownership 不对称 | **不成立** | 三处共用纯函数 `envOwnsSceneEnvironment` 单事实源，协议对称完整 |
| `scene.background` 同族未收口 | **不成立** | env 侧有守卫；sky 不写 background |
| **F-1 附带指控：私有门污染 `dispose()` 槽位守卫** | **撤销（主模型仲裁）** | `envOwnsSceneEnvironment` 是**纯函数**，入参 `[envTexture, skySourcedTex]` 是运行时槽位事实、**不读 `enabled`**——因果链不成立。私有门的真实后果是 §1 那三条，**不含**「冲掉天空 IBL」 |
| `scene.fog` 无 ownership 守卫 | **非病（契约空洞）** | 全仓 `scene.fog` 写者唯一（仅 FogCapability）⇒ 无条件还原当前不可达；但缺「为什么不判所有权」的注释 |

---

## §7 分级建议

| 优先级 | 项 | 性质 | 建议动作 |
|---|---|---|---|
| **P0** | §1 F-1 env 私有门 | 真缺陷，唯一活体 | 立 ADR：**「cap 能力级开关一律 schema 键化，`opts.enabled` 构造参数废除」**——一次收掉 §1/§3 及 ground 留疤；守卫改遍历式 |
| **P0** | §2 F-2 master 语义绑错 | 真缺陷，用户可见 | 拍板二选一（补真能力开关 / 改契约文字），勿留「文字说 A、实现做 B、UI 像 C」 |
| **P1** | §4 F-4 环境边界 | 设计债 | 定义「环境」边界并写入契约；决定 light/shadow 归属 |
| **P2** | §3 F-3 `opts.enabled` | 隐患 | 随 P0 的 ADR 一并删 |
| **P3** | §5 F-5 测试命名 / §6 fog 注释 | 可读性 | 随手清 |

**一句话**：**六兄弟过河五个，`EnvironmentCapability` 留在对岸**；
而比这一条更值得立 ADR 的，是「环境」这个概念至今**没有一份受守护的概念模型**——
成员边界、开关语义、真值源三件事目前都靠隐式约定，
所以同一个根因会以三种不同形态（私有门 / 绑错契约 / 机制缺席）各自复发。

---

## §8 验证与边界

| 项 | 结果 |
|---|---|
| 实测探针（静态扫描 6 cap 的私有门 / 落盘 / schema 键） | 见 §1 表，四行全中 |
| `environment-capability.test.ts` + `env.test.ts` | **114 passed**（全绿，但**不覆盖** §1~§4 任何一条） |
| 子代理抽查 | 2 条：1 条证实（§5 的 fake cap 事实）、1 条撤销（§6 的 dispose 污染） |
| 源码改动 | **零**（本轮只出锐评，修复另开轮次） |

**边界声明**：
- 本报告以**当前源码树**为唯一事实源；`docs/` 下 ADR / 知识卡里的「病」描述是决策时快照，未采信。
- 子代理的 F-1 第 2 条（dispose 触发路径）它自标「未验证」，主模型复核后**撤销**（见 §6）。
- §1 的「幽灵键真进 localStorage」由 `persistState` 的 `JSON.stringify` 直接实现坐实，
  但**未跑端到端刷盘-重载实验**——如需最高证据等级，建议补一条 e2e。

---

## §9 修复轮记录（2026-10-05 同日，提交 `88926c810`）

> 用户「尝试修复，结合相关提交历史」→ 本轮落地 §7 的 P0 项。**修复前先做了历史取证**（见下），
> 因用户明确要求「结合相关提交历史」，且历史正是本轮最关键的证据来源。

### 9.1 历史取证（决定了修复的形态）

| 提交 | 内容 | 对本轮的意义 |
|---|---|---|
| `35c78a558`（2026-09-15） | 「env 一级菜单补齐全部 6 cap 能力主开关」 | **立法时刻**：sky/water 补了真能力开关，**ground 直接复用了既有的 `ground-visible`（可见性）凑数**——§2 的病是**立法即妥协**，非事后漂移 |
| `73bd7dcb0` / `ed5b21b73` / `047f51808`（2026-09-22~23） | shadow → reflector → sky **三度收口** | environment **不在序列里**，直接范本 = sky |
| `56300e506`（2026-10-04） | 「ground 私有门一项经查证驳回」 | ground 的「僵尸门」定性**已被人查证并维持**，本轮**不推翻**（§2 只做措辞校准，不动其结构） |

**最关键的一条历史证据**：知识卡 `preview-env-state.md` 旧版曾把 `environment` 判为
「**原教旨形态，非漏网**」，依据是 `ADR-196` 刀5 的「能力级 enabled 不入 schema 红线」。
而**同一张卡的下一条（sky 收口条）已宣告该红线被 `ADR-250` 判定为误判并推翻**——
即 env 是**被一份自己已作废的判据持续豁免**，才连躲三度收口。
`ADR-250 §2.1` 判词原文：「门禁之所以一度无家可归，是因它被**误判为「能力级挂载」**。
但实际上「是否显示后处理效果」是**用户对可见效果的偏好**，与「cap 是否构造」是两件事」——
**「是否使用环境贴图」与此同构**，故 env 无任何可辩护的理由。

**为何三度收口扫不到它（判据盲区，已记入知识卡）**：前三轮的判据是「**找双键**」
（schema 键存在但零消费者）；而 env 是**单键缺失**——schema 里根本没有 `envEnabled`，
无可计数的键。故须补扫「**私有门 + UI 写口 + 落盘，但 schema 无对应键**」这一形态。

### 9.2 落地（§1 F-1 收口，第四例）

- schema 新增 `envEnabled`（`group:"environment"` 首位，默认 `true` = 被退役私有门有效默认 → **零行为漂移**）
- 删私有 `enabled`；`opts.enabled` 保留形参但桥接 `setEnvState`（照 sky 口径 + 顺序注释）
- 回调新增 `changed.has("envEnabled")` **首分支**（开态 `buildEnvironment()`；关态 `disposeEnvironment()` + 还原 `prevEnvironment` + `applyBackground(null)`；两支补 light 通知 + `notify()`，**先处理 return** 防落入 structural 分支）
- `setEnabled/isEnabled` 收敛为别名；**light 通知自 setter 搬进回调**（§1 所述「isEnabled 兼作跨 cap 协议」的旧形态残留随之收口）
- `saveState` 落 schema 键形；`loadState` 回填无前缀 `enabled`（判据「新键缺失 ∧ 旧键 boolean」）+ 读值 `withLegacy.envEnabled ?? withLegacy.enabled`
- **§2 措辞校准**（不重构 ground，因其「僵尸门」定性已有 `56300e506` 查证背书）：`scene-capability.ts|getMasterNodeId` 契约改为「语义按 cap 而异」并分别点明能力级/参数级；清掉注释里拷自他处的 **「audio」化石主语**；`ground-capability.ts|getVisible` 补层级校准注

### 9.3 验证

| 门禁 | 结果 |
|---|---|
| TDD 红相（新测试对**旧实现**） | **10 failed \| 1 passed**（唯一先绿者旧路径本就正确，保留作对照锚点） |
| `vitest --run src/preview-3d/` | **3151 passed / 168 files**；`git stash` 对照基线 3140 → **+11 零回归** |
| `npx tsc --noEmit` / `npm run typecheck` | **EXIT 0** / **EXIT 0**（两者等价已实证） |
| `npx vite build` | **✓ built in 1.58s** |
| `check-biome --files`（5 文件） | **✅ 通过** |

### 9.4 ⚠️ 一次「假绿灯」自查（方法论留档）

主模型复审时认为「关态分支不传 `extraExclude` 给 `disposeEnvironment()`」可能误释放 sky 直装纹理，
遂补了一条守卫测试。**变异验证（把 `environment-ownership.ts` 的 `skySourcedTex` 排除项去掉）
后测试仍全绿 → 该测试是空转的**，已**删除**，未留在提交里。

**为何空转**：`disposeEnvironment` 只可能 dispose `this.backgroundSrcTex`；`skySourcedTex`
仅作**排除集成员**出现、从不进 dispose 路径，且 sky 直装路径此前已 `applyBackground(null)`
把 `backgroundSrcTex` 置空——故设想的风险**在新分支上不可达**，对该断言而言恒真。

**教训**：新写的守卫测试必须做**变异验证**（改坏实现看是否转红），否则「覆盖率增加」是假象。
本仓「假绿灯三重门」的传统在此再次被证明必要。

### 9.5 未做 / 留待拍板

- **§4（shadow/light 的环境归属）**：属**产品决策**（改变用户可见的信息架构），本轮**未动**。
  实测确认 `ENV_CAP_CLASSES` 是硬编码 6 元素数组，给 shadow 加 `getEnvPlacement()` 即会让它
  出现在环境面板，**无需改守护测试**（但须同步该数组，否则新成员无守护）——即**边界靠硬编码列表维持**。
- **§3（`opts.enabled` 废除）**：sky 先例**也保留**该参数（只桥接），故本轮照抄保留；
  「全仓废除」需单独立 ADR，不混入本批。
- **e2e 视觉验证**：本轮动了 `scene.environment`/`scene.background` 的关态还原路径，
  理论上有视觉回归面。已由单测覆盖（关态还原 `prevEnvironment` / `background` 让位 /
  legacy 中毒救回），但**未跑 e2e 截图**——如需最高证据等级可补。
- **真实旧档样本**：跨代迁移只做了单测级验证（按 `saveState` 历史键形推演），
  未用真实升级用户存档样本核验。
