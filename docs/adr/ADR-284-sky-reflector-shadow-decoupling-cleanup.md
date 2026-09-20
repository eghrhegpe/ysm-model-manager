# ADR-284：sky 散射参数与模型类别解耦 + reflector/shadow 清除 no-op 与噪声值

- **状态**：📝 提议中（Proposed）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-20
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：
  - `frontend/src/preview-3d/state/model-defaults.ts`（`MODEL_DEFAULTS` 摘除 sky 散射段、reflector opacity/color/撞默认 resolution、shadow `hard` no-op）
  - `frontend/src/preview-3d/caps/sky-capability.ts`（`applyModelPreset` 退化为仅触发 IBL 重建的脉冲）
  - `frontend/src/preview-3d/caps/reflector-capability.ts`（`applyModelPreset` 挑参集收缩）
  - `frontend/src/preview-3d/caps/shadow-capability.ts`（同上）
  - `frontend/src/preview-3d/state/model-defaults.test.ts`（原「sky 段不应被删」反向契约，据本 ADR 重构）
  - `frontend/src/preview-3d/state/env-state-schema.ts`（顺带修重复 `// --- Light ---` 注释）
  - ADR-282（灯光与模型类别解耦——**本 ADR 是同一手术向其余类别的推广**）
  - ADR-196（预设三轴统一，`MODEL_DEFAULTS` 的诞生处）
  - ADR-084 §2.5（类别预设表的原始出处，其「场景尺度辩护」被本 ADR 逐类复核）

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

### 1.1 灯光手术（ADR-282）留下的追问

ADR-282 的「已知遗留」写着：

> 其余 5 个 cap 的类别默认值仍在（`sky` / `fog` / `shadow` / `reflector` / `environment`）。它们同样存在「类别维度是否必要」的质疑空间，但各有场景尺度论据，本 ADR 不动。

「本 ADR 不动」是灯光手术时的一句**未经验证的辩护**，不是已完成的审计。本 ADR 逐类复核它：把灯光的病灶拆成三条可检验标准，对 sky/fog/shadow/reflector/environment 逐值打分。

### 1.2 病灶三标准（承 ADR-282，把「拍脑袋」精确化）

| 代号 | 病灶 | 灯光当年命中 |
|------|------|--------------|
| **A 噪声** | 类别间差异无物理/场景依据（如 key 1.1 vs 1.0） | ✅ |
| **B no-op** | 写进 `MODEL_DEFAULTS` 的值 == schema 默认值，改了等于没改 | ✅ |
| **C 单向陷阱** | `source:"manual"` 夺该键所有权 → `shouldOverwrite` 永久拒绝后续 `auto-model` 覆盖 | ✅（`manualPreset` 冻结） |

**关键澄清：C 是灯光孤例。** 其余五类的 `applyModelPreset` 都走 `source:"auto-model"` + `shouldOverwrite` 的 `auto-model` 轨（`prev==auto-model` 才放行，见 `env-state.ts`），**结构上不存在 C**。所以不能照搬灯光「全砍」的结论——普适病灶是 **A 与 B**。

### 1.3 逐类审计结论

- **fog**：`fogNear/fogFar/fogDensity` 是**场景尺度参数**（litematic 500 格→far 800、mmd-scene→far 1500、vrm 单角色→far 400），量纲随内容体量变，非噪声；**无任何一类写 schema 默认值**（B 全 0）。→ **合法保留，判 ADR-084 的场景尺度辩护成立**。
- **environment**：`envPreset` 是**离散场景选择**（vrm/mmd→studio 吃 PBR HDR、litematic→forest 体素户外、default/ysm→sky），语义不同、非噪声非 no-op。→ **合法保留**。
- **sky**：`skyTurbidity` 6/7.5/8.5/10、`skyRayleigh` 2.0~2.6、`skyMieCoefficient` 0.004/0.005/0.006、`skyExposure` 0.5~0.6、`skySunIntensityScale` 0.7~0.78、`skySunDiscScale` 0.45~0.55、`skyMieDirectionalG` 0.75~0.85——**这七项是大气散射参数**：散射属于天空盒/大气，与「模型是 VRM 还是 MMD」无关（同灯光 1.3「模型类别不入渲染层」的论证）。每档差 0.05 级，无记录在案的技术理由 → **命中 A（噪声）**，与灯光同款。
- **reflector**：`reflectorSize`（60~500）随场景尺度，**有辩护保留**；`reflectorOpacity`（0.2/0.25/0.5）、`reflectorColor`（每类一个「差不多」的白）→ **命中 A（噪声）**；`reflectorResolution` vrm/mmd 写 1024，恰 == schema 默认 → **命中 B（no-op）**。
- **shadow**：唯一类别键 `shadowType`，soft（PBR 角色）有语义、**保留**；default/ysm/litematic 写 `hard` 恰 == schema 默认 → **命中 B（no-op）**。

## 2. 决策（Decision）

### D1：sky 散射参数从 `MODEL_DEFAULTS` 摘除，大气与模型类别解耦

删除 7 个类别块中的整个 sky 段（`skyTurbidity / skyRayleigh / skyMieCoefficient / skyMieDirectionalG / skyExposure / skySunIntensityScale / skySunDiscScale / skyForceEnv` 八键）。大气散射参数此后唯一来源 = schema 默认值 + 用户手动修改（与 ADR-282 灯光同理）。

**`skyForceEnv` 一并从 `MODEL_DEFAULTS` 删除**：经核，它是**未被任何消费者读取的死字段**——`sky-capability.ts` `applyModelPreset` 是硬置 `setEnvState({ ...picked, skyForceEnv: true })`，从不 `pickModelDefaultFields` 挑它（五个 cap 的挑参 keys 列表均不含 `skyForceEnv`），且 `env-state-schema.ts` 的 `skyForceEnv` 默认本就是 `true`。因此「换模型触发 IBL 重建」的真正来源在 **cap 内部硬置**，不依赖 `MODEL_DEFAULTS`。摘掉整个 sky 段后，`applyModelPreset` 仍保留「置脉冲 → 重建环境贴图」，只是不再逐类别改任何大气数值、也不再从表里读 `skyForceEnv`。**诚实标注：这是完整解耦——比灯光更进一步，把类别表里连值都没被读的死字段也清了。**

### D2：reflector 摘除 opacity / color 噪声，resolution 仅去 no-op 写法

- 删除全部类别的 `reflectorOpacity`、`reflectorColor`（纯噪声 A）。
- 删除等于 schema 默认（1024）的 `reflectorResolution` 写法，**保留 512**（大尺寸反射面省显存，有依据）。
- **保留 `reflectorSize`**（场景尺度，D 类辩护成立）。

### D3：shadow 清除 `hard` no-op 写法，保留 `soft`

删除 default/ysm/litematic 的 `shadowType: "hard"`（== schema 默认，B）。这些类别从此不写 `shadowType`，回落 schema `hard`，结果不变、信息不丢。`soft`（vrm/mmd/mmd-scene）有 PBR 软阴影语义，保留。

### D4：fog / environment 明确保留，把辩护写进 ADR（本文件）

它们的逐类差异是**场景尺度/离散语义**，非噪声。原 ADR-084 的问题一半在「数值」，一半在「没记录理由」——本 ADR 补记理由，让下一位会话不必再对着数值猜「是不是又拍脑袋」。

### D5：重构反向契约

`model-defaults.test.ts` 现存断言「每个类别的 `skyForceEnv` 必须为 true，sky 段不应被删」与本决策冲突（且 `skyForceEnv` 实为死字段）。改为防回退闸——**`MODEL_DEFAULTS` 任何类别不得含 `sky` 前缀键 / `reflectorOpacity` / `reflectorColor`；并断言 `shadowType` 若存在只能为 `soft`（`hard` no-op 已清）。**

### D6：顺带修 `env-state-schema.ts` 重复注释

`// --- Light ---` 连写两行（ADR-282 §1.4 病例的孪生），删一行。

## 3. 后果（Consequences）

### 正面

- **sky 大气不再随模型类别漂移**：换 VRM/MMD 天空散射参数恒定，符合「大气是场景属性」的物理直觉。
- **reflector/shadow 噪声与 no-op 清除**：类别预设只剩「有场景尺度/离散语义辩护」的键（size / soft）。
- **fog/environment 的辩护被记录在案**：消除「看着差不多」的怀疑空间。
- **一致性**：与 ADR-282 的解耦方向对齐，`MODEL_DEFAULTS` 整体从「美术目测表」收敛为「仅承载场景尺度与离散语义的最小集」。

### 负面 / 代价

- **失去「换模型自动切换天空观感 / 反射质感」**：此前 vrm 会给更柔的大气 + 更亮反射面。经 1.3 论证这类差异是噪声，且用户可用 sky/reflector 滑块显式表达。
- **sky 段整体摘除（含死字段 `skyForceEnv`）**：需确认 IBL 重建脉冲确由 cap 硬置（已核）；摘后类别表不再携任何 sky 键。

### 已知遗留

- 若将来确需「模型类别相关的外观」，正确形态仍是**模型无关的命名预设**（观感意图为键），而非把类别枚举焊进渲染参数。
- `resourcepack` 类别用 `...DEFAULT_MODEL_STATE` 展开，其 fog/reflector 覆盖随本 ADR 一并收敛。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| ADR-282 已知遗留「其余 5 类各有场景尺度论据」 | 未经审计的笼统辩护 → 本 ADR 逐类复核（1.2、1.3） |
| `env-state.ts` `shouldOverwrite`（`auto-model` 轨 + `isStateLoaded` 守卫） | 证明 C（单向陷阱）为灯光孤例，其余类别仅命中 A/B（1.2） |
| `MODEL_DEFAULTS` sky 段逐值（turbidity 6~10 / exposure 0.5~0.6 等） | 大气散射参数逐类微差、无技术理由记录 → 命中 A（D1） |
| `env-state-schema.ts` `shadowType.default="hard"`、`reflectorResolution.default=1024` | 与 MODEL_DEFAULTS 对应值同值 → 命中 B（D3、D2） |
| fog far 30~800 / reflectorSize 60~500 随场景体量 | 场景尺度辩护成立 → 保留（D4、D2） |
| `model-defaults.test.ts:38`「sky 段不应被删」 | 与 D1 冲突的反向契约 → D5 重构 |
| `sky-capability.ts:499` `applyModelPreset` 硬置 `skyForceEnv:true` | 证明 skyForceEnv 是重建脉冲非外观值 → D1 保留理由 |

<!-- 文件名: sky-reflector-shadow-decoupling-cleanup.md → 实际文件 ADR-284-sky-reflector-shadow-decoupling-cleanup.md -->
