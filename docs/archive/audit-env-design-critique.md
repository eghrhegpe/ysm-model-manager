# 3D 环境设计锐评（设计层，2026-10-05）〔已归档〕

> ⚠️ **本文件已归档（2026-10-05）**，正文内容**已并入 [`../audit-env-review.md`](../audit-env-review.md) §5**
> （「设计层审：概念骨架」）——活文档以那份为准，此处仅存史。
> 归档理由：全仓 0 外部消费者（唯一提及它的 `audit-env-review.md` 本就是同批审计的兄弟报告，非内容依赖）。
>
> 报告型快照，非事实源；现状一律以当前源码树 + 知识卡为准。
> 与 `audit-env-review.md`（23 章逐面板检查项）分工：本报告**不重扫检查项**，只审
> 「环境」的**概念骨架**（成员边界 / 开关语义 / 真值源）是否自洽。
> 方法：主模型一手勘察 + 1 名独立子代理并行只读取证；对其最强指控**逐条实地抽查**
> （2 条：1 证实、1 **降级撤销**）。修复轮见 §5。

## §0 总判

**健康度约七成半。** 状态层骨架（`envState` 单例 + `setEnvState` 中央写入 +
`lastWriteSource` 守卫 + schema 钳制）是全仓最干净的部分；`scene.environment` ownership
协议经独立复核判「**对称、完整，无缺口**」。

**病灶在「能力总开关」一个概念的三处裂缝**（同源）：

| # | 裂缝 | 定级 | 状态 |
|---|------|------|------|
| F-1 | `EnvironmentCapability` 私有 `enabled` 未收口——6 兄弟过河五个，它留对岸 | 🔴 | ✅ 已收口（§5） |
| F-2 | `getMasterNodeId()` 契约被绑错：ground 报的是**可见性**不是能力级 | 🔴 | ✅ 措辞已校准 |
| F-4 | `getEnvPlacement()` 缺席 = 永久排除：`shadow` 同族却被划在环境面板外 | 🟡 | ⏳ 待拍板 |
| F-3 | `opts.enabled` 绕过统一写入入口（生产恒 `undefined`，只在测试生效） | 🟡 | ⏳ 随 ADR |
| F-5 | `env.test.ts` 用早已不适用的 sky 当反例（命名误导，零行为影响） | 🟢 | 可随手清 |

**更值得立 ADR 的不是某一条**：「环境」至今**没有一份受守护的概念模型**——成员边界、
开关语义、真值源全靠 `env.ts` 收集逻辑 + 各 cap 自觉声明**隐式**约定，故同一根因会以
三种形态各自复发。

## §1 F-1 env 私有门（唯一活着的幽灵键）

**证据（静态探针实测，非读注释推断）**：

| 检查项 | `environment` | `ground` | `sky`（已收口样板） |
|---|---|---|---|
| 私有 `enabled` 字段 | **YES** | YES | **no** ✅ |
| `saveState` 落 `enabled` | **YES** | no | no |
| `loadState` 恢复 | **YES** | — | — |
| schema 有对应键 | **no** | （`groundVisible`） | `skyEnabled` |
| 有 UI 写口 | **YES** | no | YES（走 schema 键） |

**四条后果**：① 开关状态不入单一事实源（不参与守卫/派发，预设与模型默认看不见它）；
② `saveState` 落无前缀 `enabled` 幽灵键（`persistState` 直接 `JSON.stringify` → 真进 localStorage）；
③ `isEnabled()` 兼作**跨 cap 协议**（light 让位系数、sky 槽位去留都读它），而它既非单一事实源
又承担协议角色；④ **无守卫**——`environment-capability.test.ts` 有 30+ 条 save/load 测试，
零条断言该幽灵键，而 sky 有专门的 `expect("enabled" in cap).toBe(false)` 防僵尸门守卫。

**收口内容**见知识卡 `preview-env-state.md` 的「四度收口」条（schema 键 `envEnabled` +
回调 `changed.has()` 分支 + 别名 + loadState 回填）。

⚠️ **跨代承重（改此处必读）**：`migrateEnvSource` 判据①读 `envEnabled === false` 作
「用户关掉整个环境贴图功能」的**唯一证据**（迁 `envSource="sky"` 的强信号）。
回填断了 → 升级用户的 `false` 永久失传 → 画面从天空 IBL 静默掉回 env 预设。
守卫 = 两条迁移回归（仍迁 sky ／ `true` 不得被放大误迁）。

## §2 F-2 master 契约绑错（ground）

接口契约原文「此 cap 有**启停整个能力**的唯一真值源」，而实报值：

`sky/water/environment/fog/reflector` → `*-enabled`（能力级）；
**`ground` → `ground-visible`（可见性，`groundVisible`）**。

ground 侧**自知且自洽**（`ground-menu.ts` 明写「ground 无能力总开关，visible 是 params 级」），
其真实能力级私有 `enabled` 无 UI 写口、生产恒 `true`。故这不是实现 bug，而是
**契约措辞未覆盖合法用法** + `preview-menu.md` 曾把它错归为「能力主开关」。
**处置**：校准 `scene-capability.ts|getMasterNodeId` 注释（分列两种语义，并清掉注释里
拷自他处的 **「audio」化石主语**）+ `ground-capability.ts|getVisible` 补层级校准注。
**未重构 ground**——其「僵尸门」定性已有 `56300e506` 查证背书，不推翻。
**若未来需机器区分两种语义，须另立字段（如 `masterKind`）**。

## §3 F-3 / F-5（次要）

- **F-3 `opts.enabled`**：`registry.createAll` 的 ctx **无该字段** ⇒ 生产恒 `undefined`，
  只在测试生效（测试能造出生产造不出的门状态）。sky 先例**也保留**该参数（只桥接），
  故本批照抄；「全仓废除」需单独立 ADR。
- **F-5 测试命名误导**：子代理指控 `env.test.ts` 以 sky 为「不报 master id」反例而真 sky
  早已返回 `sky-enabled`。**主模型抽查后降级**：该测试用 `makeCap` 手搓 fake，
  测的是**框架对未报 master 的 cap 的处理**——有效契约测试，**仅命名误导**（零行为影响）。
  修复：改中性名。

## §4 F-4 环境边界（待拍板）

两套并行归属机制、无交集验证：`getEnvPlacement()`（cap 自报 → 环境面板 6 成员）
vs `CORE_MENU_ITEMS.dockGroup`（5 个 dock 组）。后果：

- `ShadowCapability` **不实现** `getEnvPlacement` ⇒ 尽管与 fog/water/reflector **schema 同族**
  （同批单门收口）、功能同域，仍**永久排除**在环境面板外；而 `reflector` 留在里面。
- `light`（灯光）同样在「场景」组。
- **实测**：`env.test.ts` 的 `ENV_CAP_CLASSES` 是**硬编码 6 元素数组**——给 shadow 加
  `getEnvPlacement()` 即会显示，无需改守护测试（但须同步该数组，否则新成员无守护）。
  ⇒ **边界靠硬编码列表维持。**

## §5 修复轮（同日，`88926c810` + `099f1b0b3`）

**为何修复形态如此——历史取证**（用户要求「结合相关提交历史」，历史恰是关键证据）：

| 提交 | 给出的事实 |
|---|---|
| `35c78a558`（09-15） | 「6 cap 补齐主开关」**立法时刻**：sky/water 补真开关，**ground 直接拿既有可见性 toggle 凑数** ⇒ §2 是**立法即妥协**，非事后漂移 |
| `73bd7dcb0`/`ed5b21b73`/`047f51808` | shadow→reflector→sky **三度收口序列**，env 不在其中；sky 是直接范本 |
| `56300e506`（10-04） | ground 私有门「经查证**驳回**」⇒ 本轮不推翻其定性 |

**最能解释「为何连躲三度收口」**：知识卡旧版把 env 判为「原教旨形态，非漏网」，
依据 `ADR-196` 刀5 的「能力级 enabled 不入 schema 红线」——而**同一张卡的下一条已宣告
该红线被 `ADR-250` 判定为误判并推翻**。即 env **被一份自己已作废的判据持续豁免**。
（`ADR-250 §2.1`：「门禁…被误判为『能力级挂载』。但实际上『是否显示后处理效果』是
**用户对可见效果的偏好**」——「是否使用环境贴图」与之同构。）
**判据盲区**：前三轮扫「**找双键**」，而 env 是「**单键缺失**」（schema 无该键，
无可计数）⇒ 须补扫「私有门 + UI 写口 + 落盘，但 schema 无对应键」这一形态。

**验证**：TDD 红相 `10 failed | 1 passed`（唯一先绿者旧路径本就正确，留作对照锚点）；
`vitest src/preview-3d/` **3152 passed / 168 files**（`git stash` 对照 +12 零回归）；
tsc / `npm run typecheck` EXIT 0；vite build ✓；biome ✅。

### ⚠️ 两次「假绿灯」自查（方法论，值得记）

主模型两次补写守卫测试，**都做变异验证，两次均不转红**：

1. 「关态误释放 sky 纹身」→ 设想风险**在新分支不可达**（`disposeEnvironment` 只 dispose
   `backgroundSrcTex`，`skySourcedTex` 仅作排除集成员）⇒ 断言恒真，**删除**。
2. 「early return 防回潮」→ `structural` 不含 `envEnabled` 时 fall-through **恰好良性**，
   行为前后相同 ⇒ 纯行为断言无法捕获该 return，**如实降级为「行为快照」**并在注释写明
   「不宣称有测试保护」。

独立复核子代理亦独立发现同一现象（其变异3），并用 `git show 88926c810^` 跑父版本探针，
证明「loadState 恢复 `envEnabled=false` 时不通知 light」是 **pre-existing 非本提交引入**，
且本提交反而修复了相邻一处（父版本下直写 envState 不通知 light）。

**未做（登记在案，非遗漏）**：§4 边界属产品决策（未动）；§3 `opts.enabled` 废除需 ADR；
e2e 视觉未跑（关态还原路径已由单测覆盖，理论有视觉回归面）；
真实旧档样本未核（迁移仅单测级验证）。
