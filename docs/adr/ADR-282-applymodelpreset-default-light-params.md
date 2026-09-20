# ADR-282：灯光与模型类别解耦：退役 applyModelPreset，重置锚定单一 DEFAULT_LIGHT_PARAMS

- **状态**：📝 提议中（Proposed）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-20
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：
  - `frontend/src/preview-3d/state/model-defaults.ts`（`MODEL_DEFAULTS` 移除全部 `light*` 键）
  - `frontend/src/preview-3d/caps/light-capability.ts`（退役 `applyModelPreset` / `manualPreset` / `currentPreset`，新增 `resetLightParams`）
  - `frontend/src/preview-3d/caps/light-presets.ts`（重置锚点 `DEFAULT_LIGHT_PARAMS`；`LIGHT_ENV_KEYS` / `VOLUMETRIC_ENV_KEYS` 随之退役）
  - `frontend/src/preview-3d/caps/light-controls.ts`（删预设下拉，加「重置灯光」）
  - `frontend/src/preview-3d/adapters/shared-infra.ts`（`applyModelDefaults` 摘掉 light）
  - ADR-280（三灯统一实例——`spotlight` 灯删除后，预设失去唯一实质区分轴）
  - ADR-281（灯光字段全集单一真相源——**其 D4 被本 ADR 取代**）
  - ADR-084（个人灯光——§2.5 六类 `LIGHT_PRESETS` 的出处，本 ADR 废除其类别维度）
  - ADR-196（预设三轴统一——`LIGHT_PRESETS` 并入 `MODEL_DEFAULTS` 的动刀处）

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

### 1.1 用户提出的质疑

> 「所有模型在 three 的渲染表现是一样的吧，为啥要根据模型类别设置（灯光）重置呢，这不是搞漂移源吗」

### 1.2 质疑成立：类别维度的技术理由从未存在

`ADR-084 §2.5` 是这些值的出处，原文表格：

| id | key | fill | rim | spotlight |
|----|-----|------|-----|-----------|
| default | 1.0 | 0.3 | 0.25 | 关 |
| ysm | 1.1 | 0.35 | 0.3 | **开 2.0** |
| vrm | 1.1 | 0.4 | 0.35 | 关 |
| mmd | 1.1 | 0.4 | 0.35 | 关 |
| litematic | 0.9 | 0.35 | 0.3 | 关 |
| resourcepack | 1.3 | 0.4 | 0.35 | **开 1.8** |

- **`vrm` 与 `mmd` 逐字相同** —— 类别维度在诞生时就没有真实区分力。
- ADR 全篇未记录任何「VRM 材质需要 1.1」这类技术理由；这些数字是**美术目测微调**。
- **唯一的实质区分轴是 `spotlight` 开关**（+2.0 / 1.8 强度），而 `spotlight` 灯已在 **ADR-280 被删除**，统一成每盏灯的 `type` 字段。
- 于是预设的全部剩余内容 = **三个光强数字**（外加 litematic 六个角度、两个类别的体积光参数）。

### 1.3 渲染器层面：模型类别不存在

Three.js 是**场景图 + 光源**模型，不认识「YSM / VRM / MMD / 体素 / 块包」。灯光是**场景属性**，不是模型属性。

灯光唯一合法的模型相关输入是**包围盒**——它决定灯位半径（`targetHeight = max(maxDim*0.8, 6)`）与靶点中心，进而影响 spot 灯到目标的物理距离与坎德拉补偿。而这条链路**已由 `setTarget()` / `setTargetHeight()` 动态处理**，每次换模型实时重算，**不需要预设代劳**。

因此按类别预置灯光是**双重错位**：给一个与类别无关的系统喂类别相关的值。

### 1.4 病灶：`default` 已退化成「纯 no-op + 永久副作用」

`MODEL_DEFAULTS.default`（`DEFAULT_MODEL_STATE`）的 light 段现状：

```ts
// --- light (来自 LIGHT_PRESETS.default) ---
// --- light (来自 LIGHT_PRESETS.default) ---   ← 重复行
lightVolumetricEnabled: false,
```

**只剩一个键**，且：

1. 原表的 `default` 强度（1.0 / 0.3 / 0.25）**在 ADR-196 并表时静默丢失**；
2. `env-state-schema.ts` 中 `lightVolumetricEnabled` 的 default **本来就是 `false`**（`DEFAULT_VOLUMETRIC.enabled = false`）——写 `false` 覆盖 `false`，**可见效果为零**。

但选择「默认」并非无害：

- `source: "manual"` 使 `shouldOverwrite` 放行并**夺取该键的手动所有权**；
- `manualPreset = "default"` → **永久冻结**该 cap 后续所有模型预设，且**持久化跨会话**；
- 无任何 UI 可解除（下拉只有 6 个模型类别，没有「跟随模型」项）。

**净效果：改了等于没改，却把开关焊死。**

### 1.5 双重的「手动优先」表达（锐评 🟡 项）

同一意图被两套机制重复表达：

- **细粒度**：`shouldOverwrite` 按 key 记 `_writeSource`，`manual > auto-atmosphere > auto-model` ——用户拖过的键在下一次 `auto-model` 写入时自动豁免。**这是用户微调真正的保护机制。**
- **粗粒度**：`manualPreset` 一旦设置就整体早退，压制 `applyModelPreset` 的全部键。**其唯一生产来源就是这个下拉。**

粗粒度机制不但冗余，而且**有害**：它把「保护我调过的」升级成「永远别碰灯光」，且用一次性的下拉选择永久兑现。

### 1.6 孤例性

`sky` / `fog` / `shadow` / `reflector` / `environment` **全都**有 `applyModelPreset(modelType)`，但**没有一个**向用户暴露类别选择器——它们只在换模型时自动套用。**只有 light 把内部 `ModelType` 枚举漏成了 UI 控件。**

## 2. 决策（Decision）

### D1：`MODEL_DEFAULTS` 移除全部 `light*` 键，灯光不再随模型类别漂移

删除 7 个类别块中的 light 段（含注释与重复行）：`DEFAULT_MODEL_STATE` / `ysm` / `vrm` / `mmd` / `mmd-scene` / `litematic` / `resourcepack`。

灯光参数此后**只有一个来源**：`envState` 的 schema 默认值（即 `DEFAULT_LIGHT_PARAMS`）+ 用户手动修改。

> `model-defaults.ts` 保留其余 5 个 cap 的类别默认值——它们有场景尺度辩护（litematic 是 500 格大场景，线性雾 30~800、反射面 500 讲得通），不属本 ADR 范围。

### D2：`LightCapability.applyModelPreset` 退役

灯光不再是「模型预设」的关注点：

- `shared-infra.ts` 的 `applyModelDefaults` 摘掉 `deps.light?.applyModelPreset(modelType)`，预 apply cap 从 **6 → 5**（sky / fog / shadow / reflector / environment）。
- 随之退役：`opts.manual`、`manualPreset` 字段、`currentPreset` 字段、`getCurrentPreset()`、saveState/loadState 中这两个键。
- `pickModelDefaultFields` 保留（其余 6 个 cap 仍消费）。

### D3：重置锚定单一 `DEFAULT_LIGHT_PARAMS`，而非任何类别预设

新增 `LightCapability.resetLightParams()`：把三盏灯 + 体积光写回 `DEFAULT_LIGHT_PARAMS`，`source: "manual"`（尊重「用户显式重置」的意图，与拖滑块同源）。

**锚点必须是模型无关的规范基线**——否则等于把刚砍掉的类别耦合换个名字请回来。`DEFAULT_LIGHT_PARAMS` 正是 `envState` 的初始值来源，语义自洽：**「重置」= 回到「从没动过」的状态**。

### D4：UI —— 删下拉，加「重置灯光」按钮

`light-controls.ts` 删除 `light-preset` select 节点；新增一个按钮节点（`MenuNode` schema，遵守「3D 菜单只用 MenuNode」红线）。
i18n 删 7 个 `preview.lightPreset*` 键 × 3 语言，新增重置键。

### D5：结构守卫 —— 用测试把解耦钉死

新增数据契约测试：**`MODEL_DEFAULTS` 的任何类别都不得含 `light` 前缀键**。
这是防回退的关键——否则将来有人「顺手」加一行 `lightKeyIntensity` 就能悄悄复活漂移源。

### D6：ADR-281 D4 被本 ADR 取代

ADR-281 D4 把 `applyModelPreset` 的挑参范围改为 `[...LIGHT_ENV_KEYS, ...VOLUMETRIC_ENV_KEYS]`。该函数退役后：

- `LIGHT_ENV_KEYS` / `VOLUMETRIC_ENV_KEYS` **失去唯一消费者 → 删除**（含测试），否则成为孤儿导出（`check-orphan-exports` 红灯）。
- ADR-281 的其余部分（`FLATTEN_MAP` 作为字段全集真相源、`readLightParams` 去 `as`、`lightEnvKeys` 驱动变更集、`LIGHT_SLOTS`）**完全保留且仍然有效**。

## 3. 后果（Consequences）

### 正面

- **漂移源消除**：换模型不再改动任何灯光参数；灯光行为只由「规范默认 + 用户微调」决定，可预测、可解释。
- **「默认」陷阱消失**：不再有「选了等于没选、却永久冻结」的中间态。
- **双重手动优先收敛为一套**：只剩 `shouldOverwrite` 的按 key 保护——细粒度、符合直觉、无需理解一个隐藏枚举。
- **UI 不再泄漏内部枚举**：`ModelType` 回归内部概念。
- **light 与其余 5 cap 的接口形状对齐**：不再有一个多出来的 `opts.manual` 参数与两个持久化键。
- **代码净减**：一个下拉 + 一个公开方法 + 两个私有字段 + 一个 getter + 两个持久化键 + 两个派生常量 + 7×3 i18n 键 + 大量预设测试。

### 负面 / 代价

- **失去「一键切换到某类别的观感」**：此前用户可借下拉把灯光调成 VRM/MMD 风格。经 1.2 论证，这类差异本就是任意数字，且可用三盏灯的滑块直接表达；判断该能力无实际价值。
- **灯光编辑器的「起点」变得单一**：所有模型都从 `DEFAULT_LIGHT_PARAMS` 起步。若某类场景确实需要不同布光，须用户自行调整（或未来引入**模型无关的命名灯光预设**——见已知遗留）。
- **存档字段作废**：`manualPreset` / `currentPreset` 不再写入。`restoreState` 对未知键宽容，旧存档不会报错，但这两个键从此成为死数据（可接受：无迁移负担）。
- **`LIGHT_ENV_KEYS` / `VOLUMETRIC_ENV_KEYS` 生命周期极短**（ADR-281 引入 → ADR-282 删除），对 ADR-281 的直接读者构成一次认知更新成本。

### 已知遗留

- **若将来确实需要「灯光风格预设」**，其正确形态是**模型无关的命名布光**（如 `三点布光 / 舞台 / 逆光`），键是*观感意图*而非*模型类别*，且不携带粘性冻结机制。本 ADR 只废除错误的那一种，不预先设计对的那一种。
- 其余 5 个 cap 的类别默认值仍在（`sky` / `fog` / `shadow` / `reflector` / `environment`）。它们同样存在「类别维度是否必要」的质疑空间，但各有场景尺度论据，本 ADR 不动。
- `lightVolumetric*` 归入灯光一并解耦（体积光锥由 spot 灯驱动，属灯光系统）。其中 `lightVolumetricEnabled` 在所有类别中恒为 `false`，与 schema 默认同值，删除零信息损失。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| 用户质疑（2026-09-20）：「所有模型在 three 的渲染表现是一样的吧……这不是搞漂移源吗」 | 触发本 ADR；推翻类别维度 |
| `ADR-084 §2.5` 六类预设表 | 证明类别值系美术目测（vrm≡mmd，无技术理由记录）——D1 的事实依据 |
| ADR-280 删除独立 `spotlight` 灯 | 预设失去唯一实质区分轴，退化为三个光强数字 |
| `DEFAULT_MODEL_STATE` 仅剩 `lightVolumetricEnabled: false`，且与 `env-state-schema.ts` 默认同值 | 证明 `default` 为纯 no-op；而其 `manualPreset` 副作用真实——1.4 与 D1/D2 的核心依据 |
| `env-state.ts` `shouldOverwrite` 按 key 记 `manual` 并豁免 `auto-model` | 用户微调保护**已由细粒度机制满足**，`manualPreset` 粗粒度机制冗余（1.5、D2） |
| Three.js 场景图：模型类别不入渲染模型；灯光唯一模型相关输入 = 包围盒 | 类别耦合在渲染层无根据；bbox 已由 `setTarget`/`setTargetHeight` 动态处理（1.3、D3） |
| `sky`/`fog`/`shadow`/`reflector`/`environment` 均无类别选择器 UI | 证明下拉是孤例（1.6） |
| ADR-281 `LIGHT_ENV_KEYS`/`VOLUMETRIC_ENV_KEYS` 唯一消费者 = `applyModelPreset` | 该函数退役后二者成孤儿，须一并删除（D6） |
| AGENTS.md「3d菜单只允许使用 MenuNode schema」 | D4 重置按钮以菜单节点实现 |

<!-- 文件名: applymodelpreset-default-light-params.md → 实际文件 ADR-282-applymodelpreset-default-light-params.md -->
