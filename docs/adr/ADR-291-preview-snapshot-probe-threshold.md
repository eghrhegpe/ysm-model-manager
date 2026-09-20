# ADR-291：B 轨快照探针入册门槛（双轨状态镜像的治理边界）

- **状态**：✅ 已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-21
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/state/preview-paths.ts`、`frontend/src/preview-3d/state/preview-state.ts`、`docs/knowledge/preview-menu.md`、`docs/knowledge/preview_paths.md`（routes 卡 `preview-paths.md`）、[ADR-126] P4/P5、[ADR-168] 二期、[ADR-195] 刀2.5

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->
env 菜单的控件显隐走 B 轨铁律：`visibleWhen: (s: PreviewSnapshot) => boolean`——谓词只吃状态层快照，不摸 cap 实例（AGENTS.md「3d菜单只允许 MenuNode schema」的执法面）。而多数参与判定的参数原生住在 `envState`（cap 组字段），不在快照里。于是存在一条**探针桥**：`KNOWN_PATHS` 白名单键 → `bindings` 惰性读写（get 委托 envState/cap getter、set 绕道 cap setter、available 判 cap 在场）。

2026-09-21 地面锐评指出这是「双轨状态镜像」：同一语义两处登记（`envState.groundSourceKind` 原生 + `env.groundSourceKind` 快照键），每加一个参与 visibleWhen 的键要三步走（KNOWN_PATHS / PathValue / bindings），漂移靠人肉。问题：**该为入册立门槛吗？还是三处登记本就是设计内成本？**

盘点（决策当时实测）：全仓 KNOWN_PATHS 共 12 键，其中 cap 派生探针仅 6 条（waterMode / groundSourceKind / groundCanvasStyle / groundOverlay / fogMode / skyGroundCap），且**每一条都有活体 visibleWhen 消费者**（fog near/far×density、ground 三轴、water film/pool、dock requiresEnvironment 门禁）——无囤积、无黑洞键（2026-09 收紧后未落地键编译期即挡）。探针 set 侧另有第二消费者链：`subscribeSettings → menu.refresh()`（面板重算），非纯摆设。

## 2. 决策（Decision）

**维持双轨，不合并、不立法禁止；但为「新增探针」立三条门槛**：

1. **判定依据必须是 cap 态**：只有当 visibleWhen 谓词的判定输入是「cap 内部状态的上浮值」（模式/来源/开关类离散量）时才许入册。若判定输入已在 envState 且有现成快照通路（如 render.* 横切项），直接读，不建第二条桥。
2. **三处登记一步不缺 + 活体消费者守卫**：扩 `KNOWN_PATHS` + 补 `PathValue` 值类型 + 填 `bindings`（get/set/available 三件套）缺一不可；入册 PR 须同时给至少一条真被节点 `visibleWhen`/`subscribeSettings` 消费的用例（防囤积——将来无人消费的键按不变量「零消费者即时删除」退表）。
3. **值域/枚举归一在 binding 内**：探针 set 收到的控件基元（string|number|boolean）由 binding 负责归一与守卫（对齐既有 `ui.mode` 非法回退 shared 范式），谓词侧永远拿到 `PathValue` 精确类型。

**否决的替代方案**：
- *让谓词直吃 envState*：违反 AGENTS.md「visibleWhen 只从快照取数」铁律（cap ⇄ preview-state type 环正是为此才用 ADR-168 叶子拆掉的），开倒车。
- *把全部 envState 键批量镜像进快照*：`previewSnapshot()` 每次渲染逐键求值，全量镜像 = 每次 filter 遍历上百 binding，热路径荒谬；按需探针才是本意。
- *删探针改 cap 闭包（A 轨）*：A 轨 `visible?` 闭包已被 [ADR-126] P5 明令退役（快照冻结类 bug 根源），不可回退。

## 3. 后果（Consequences）

- ✅ 正面：双轨成本被封在「≤ 六个离散模式键」的量级里，新增有明确准入问句（「你的判定输入住哪？」）；三步走 + 编译期白名单使漏登记不可能静默通过。
- ⚠️ 负面/成本：新键入册仍是三处手工登记，比单源方案多两次编辑——接受为铁律（谓词纯度 vs 单一事实源）的兑换价。
- 📌 已知遗留：`ui.activeComponent` 键位保留仅作类型兼容（[ADR-126] 注），待未来触碰时按门槛 2 的「零消费者退表」清理。

## 4. 数据溯源

- 探针清单与两步走契约：`preview-paths.ts|KNOWN_PATHS`、`preview-paths.ts|PathValue`（文件头注释即运行时纪律）。
- binding 实现：`preview-state.ts` 的 `env.waterMode` / `env.groundSourceKind` / `env.fogMode` / `env.skyGroundCap` 等条目（惰性解析 + available 门）。
- 活体消费者：`fog-menu.ts`（exp2/linear 互斥）、`ground-menu.ts`（三轴 paramVisible）、`water-menu.ts`（film/pool）、`menu/engine/defs.ts`（skyGroundCap 门禁）。
- 守卫测试：`preview-state.test.ts`（探针读写/可用性/广播门控）、`node-render.test.ts`（快照谓词渲染臂）。
