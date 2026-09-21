# ADR-290：体积光锥驱动源 schema 化（lightVolumetricDriver）

- **状态**：✅ 已采纳（用户拍板 2026-09-20「两项都做」，与 point candela 补偿同批授权）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-20
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/caps/light-capability.ts`（getSpotLightForCone）、ADR-280（三灯统一实例，activeLight 焦点态引入者）、ADR-281（FLATTEN_MAP 真相源）、ADR-246 D3（体积光折叠卡）、`docs/knowledge/preview_env_state.md`

---

## 1. 背景（Context）

> ⚠️ 本节是「决策当时」的状态快照，评估现状以源码树为准。

[light-type-switch]（ADR-280）把体积光锥的驱动源定为 `getSpotLightForCone()`：
**优先返回「当前正在编辑的灯」（activeLight）若是启用的 spot**，否则回退 key→fill→rim
槽位顺序第一盏启用的 spot。调查（2026-09-20 锐评）确认的病灶：

- `activeLight` 是**运行时 UI 焦点态，刻意不入 envState/存档**；而锥体贴哪盏灯是
  **渲染输出**。影响输出的输入没有 schema 键 = 违反本域「schema ≡ 控件树 ≡ 渲染输入 ≡
  存档四集相等」的对接判据（ADR-281/283 一路立下来的纪律）。
- 症状：两盏 spot 同开时，会话 A 里锥体贴 fill；重启后 activeLight 回缺省 key →
  **同一份存档，锥体贴到另一盏灯**，用户无从知晓更无从修正。卡面 hint 只说「需要一盏
  启用的 spot」，没说「贴哪盏随最后编辑焦点」。
- 污染面核实：`getSpotLightForCone` 生产消费者仅两处——锥体重建（主要）与
  `ShadowCapability.restoreSpot` 兜底路径（低危，多 spot 走 `_spotSnapsList` 不碰此口）；
  截图链 `toScreenshotLights` 逐槽位提取全量参数，**不读 activeLight，无污染**。
- 既有测试「getSpotLightForCone 优先用当前编辑的灯」把该行为钉成了契约——不是漏网 bug，
  是有意设计（当年为对齐「我在调的那盏灯」心智）演化出的存档级漂移源。

## 2. 决策（Decision）

新增 schema 键 `lightVolumetricDriver: enum ["auto","key","fill","rim"]`（默认 `"auto"`），
进 volumetric 组字段全集（FLATTEN_MAP / 持久化 / DEFAULT 派生照常走 ADR-281 通道），
体积光折叠卡内加一行「驱动灯光」select。语义：

| driver 值 | 锥体驱动源 |
|---|---|
| `auto`（缺省） | 按 key→fill→rim 槽位顺序第一盏**启用的 spot** 灯 |
| `key`/`fill`/`rim` | **严格绑定**该槽位；该槽位不是启用的 spot → 无锥（不回落） |

同时 `activeLight` 与锥体**彻底脱钩**：`getSpotLightForCone` 不再读焦点态，
`setActiveLight` 不再收敛锥体（原「切了没反应」内联重建逻辑退役）；driver 字段变更
经既有 envState 派发通道触发 rebuild，与 volumetric.enabled 同路。

**理由**：
1. 存档确定性——同一份存档在任何会话渲染出同一个锥（显式绑定下用户钉死；
   auto 语义下槽位顺序稳定，与 activeLight 无关）。
2. 显式优于隐式——原设计「贴我在编辑的灯」是隐藏耦合（hint 只能文字道歉），升格为
   可存档 select 后成为正常参数，与 ADR-246 D3「不做 visibleWhen 隐藏、参数摊开」同裁量。
3. 严格绑定不回落——回落会让「钉 fill 却因 fill 被关而看到锥体贴 key」的幽灵行为
   复活；无锥即「驱动灯不满足前提」，卡面 hint 承担告知义务。
4. `auto` 缺省 = 现网主路径兼容（旧存档无此键 → schema 默认 → 槽位顺序第一盏，
   与无 activeLight 优先时的旧行为逐字一致）。

**否决的替代**：只砍 activeLight 优先、保留纯槽位顺序（无显式控制权，多 spot 用户仍
无法指定贴哪盏，hint 继续背锅）；activeLight 入存档（焦点态持久化是另一类债，
「上次编辑哪盏」不该决定渲染）。

## 3. 后果（Consequences）

- ✅ 正面：锥体驱动源进「四集相等」闭环；派生防回退闸（控件树写面 ≡ light 组 schema
  字段集）自动覆盖新键，零额外接线。
- ✅ 正面：`setActiveLight` 去掉 rebuild 副作用后回归纯焦点态（与 light-type-switch
  当初「不写 envState」的定性对齐）。
- ⚠️ 负面：破坏一条既有契约测试（activeLight 优先）——按新语义改写而非保留。
- ⚠️ 负面：严格绑定下用户可能困惑「选了 fill 却没锥」（fill 非 spot 时）——hint 文案
  同步改写兜底；旧存档升格为 `auto`，首次感知是菜单多一行 select（增量非突变）。
- 📌 已知遗留：shadow `restoreSpot` 兜底仍经 `getSpotLightForCone`（读 driver 语义，
  行为随本决策同步收敛，不单独处理）。

## 4. 数据溯源

- schema（`lightVolumetricDriver` 声明）→ FLATTEN_MAP.volumetric → 持久化
  volumetric.driver（oneOf 白名单恢复）→ `setVolumetric({driver})` / envState 派发 →
  `getSpotLightForCone` 消费 → 锥体 rebuild / shadow 兜底。
- 缺省链：schema default `"auto"` → `deriveDefaultEnvState` → `DEFAULT_LIGHT_PARAMS`
  （重置锚点自动覆盖，零字面量，ADR-281 通道）。

<!-- 文件名: volumetric-cone-driver.md → 实际文件 ADR-290-volumetric-cone-driver.md -->
