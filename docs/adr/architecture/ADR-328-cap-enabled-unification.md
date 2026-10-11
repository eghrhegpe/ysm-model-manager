# ADR-328：cap 能力总开关统一收编 envState 与 ground 终态

- **状态**：📝 提议中（Proposed）
- **日期**：2026-10-11
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **准入理由**：ground 的 private enabled 字段是 cap-enabled 收口（ADR-250/F-1）遗留的唯一孤岛，是否并入 schema 或降级为常量需架构拍板，方向难逆转且影响持久化/UI 语义。
- **相关**：`frontend/src/preview-3d/caps/ground-capability.ts`；`frontend/src/preview-3d/state/env-state-schema.ts`（`*Enabled` 键族）；`scripts/check-cap-enabled-duality.ts`（债检测器）；`docs/knowledge/preview-env-state.md`（不变量段）

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

`check-cap-enabled-duality`（ADR-250/F-1 收口范式衍生的机器闸）要求：每个 cap 的「能力总开关」要么收编为 `ENV_STATE_SCHEMA` 的 `{capName}Enabled` 键（与 envState 同源轮转、可存档、界面可写），要么彻底去字段。截至 2026-10-11，11 个 cap 中 **10 个已 clean**：sky/water/shadow/reflector/fog/light/postprocessing/environment/scene/render-mode 全部把 enabled 收编进 schema 键（`fogEnabled`/`waterEnabled`/`shadowEnabled`/`reflectorEnabled`/`lightEnabled`/`ppEnabled`…）。

**唯一孤岛 = `ground-capability.ts`**：它仍持一个 `private enabled: boolean` 字段（构造默认 `true`，`setEnabled/isEnabled` 读它），但：
- `ENV_STATE_SCHEMA` **没有 `groundEnabled` 键**（grep 确认 16 个 `*Enabled` 键里无 ground）；
- 该字段**不持久化**（loadState/saveState 不碰它）、**无 UI 写口**（registry 恒不传参，即恒 ON）；
- 文件三处注释（约 L683–691 / L712–714 / L766）明文记载：这是有意暂不收编，且「真·根治（enabled 收编 schema 键，跨 cap 统一议题）**另立 ADR**，不混入本批」。

`ground` 的语义特殊：它是所有模型的默认常驻底（GridHelper + 表面材质层），与其他「可关掉换效果」的 cap 性质不同——关掉 ground 等于「模型悬空无地」。这使它是否该有「用户可见开关」成为真正的架构问题，而非机械收口能决。

## 2. 决策（Decision）

> 状态：📝 提议中（待拍板）。以下为 AI 建议方向与待定项，落地前须人类拍板「待拍板项」。

**建议方向**：消除 `private enabled` 字段（它是债检测器的唯一命中源，且当前恒为 `true` 无运行时意义），但**不盲目套用 `envState.groundEnabled` 别名**——因为 ground 是否开放用户开关是独立的产品决策。分两条候选路径：

- **路径 A（推荐，若 ground 恒在、无用户开关）**：删除 `private enabled` 字段与 `setEnabled/isEnabled` 的字段读写，改为常量语义——`isEnabled()` 恒返回 `true`、移除 `setEnabled` 的字段赋值（或保留方法签名但只驱动内部副作用、不存状态）。这样 `check-cap-enabled-duality` 不再命中（无私有 enabled 字段），且语义回归「ground 常驻」本真，无需在 schema 注入一个永远为 true 的死键。
- **路径 B（若产品要求 ground 可关）**：按 ADR-250/F-1 同口径，在 `ENV_STATE_SCHEMA` 增 `groundEnabled: { type: "boolean", default: true, group: "ground" }`，把 `setEnabled/isEnabled` 收敛为 `envState.groundEnabled` 别名（删私有字段 + 走持久化/UI 同轨）。这是检测器原本建议的范式，副作用是 schema 多一个用户可写的 ground 总开关。

**待拍板项（须人类决策，不在此代答）**：
1. **ground 要不要有用户可见开关**？→ 决定走 A（恒在、去字段）还是 B（收编 schema 键）。这是本 ADR 的核心分歧点，直接决定债的收敛形态。
2. 若走 B：`groundEnabled` 的 `default` 与归档方言（`ENV_KEYS`/`ARCHIVE_ALIAS`）须一并登记，走 `preview-env-state.md` 既有轮转机制。
3. 无论 A/B，`setEnabled/isEnabled` 的方法签名是否保留（Loader 或注册表可能按接口约定调用）——属纯实现细节，拍板方向后由实施者对齐 `SceneCapability` 接口契约。

## 3. 后果（Consequences）

- **正面**：`check-cap-enabled-duality` 从「1 违规」归零，cap-enabled 收口在全域彻底闭合；ground 的开关语义从「不可见的私有字段」变为「要么恒在常量、要么用户可见 schema 键」，消除了「首启无存档时界面开关显示 ON 而实际效果缺失」的理论风险（检测器关注点）。
- **负面 / 成本**：路径 B 会在 envState 注入一个 `groundEnabled` 键并进入持久化/UI 轮转，增加一处用户可操作开关的维护面；路径 A 则把 ground 彻底锁为常驻，失去未来「按需关地」的灵活度（若产品后续想要则需再开 ADR）。
- **已知遗留**：`check-cap-enabled-duality` 目前**只报不拦**（debt 口径、2026-11-08 复审窗口内），故本 ADR 不阻塞推送；但它是 cap-enabled 收口的最后一块拼图，建议在复审窗口内随拍板结论落地。

## 4. 数据溯源

- 现状实证（当前源码树）：
  - 唯一违规：`frontend/src/preview-3d/caps/ground-capability.ts` 的 `private enabled: boolean` 字段（`isEnabled()`/`setEnabled()` 读写），`ENV_STATE_SCHEMA` 无对应 `groundEnabled` 键（`scripts/check-cap-enabled-duality.ts --json` 报 `errors:1`、其余 10 cap `clean`）。
  - 已完成收口的对照样本：`fogEnabled`（ADR-196）、`shadowEnabled`/`reflectorEnabled`（F-1）、`lightEnabled`/`ppEnabled`（ADR-250）、`waterEnabled`（water 同源）均已落 `ENV_STATE_SCHEMA` 键族。
  - ground 有意不收编的注释证据：见 `ground-capability.ts` 约 L683–691 / L712–714 / L766 三处「另立 ADR，不混入本批」记载。
  - 检测器口径：`scripts/check-cap-enabled-duality.ts`（`private enabled` 字段定义 + schema 无 `{capName}Enabled` 键 → 违规）。
- 关联知识卡：实施进度与边界细则见 `docs/knowledge/preview-env-state.md`（不变量段）。

<!-- 文件名: cap-enabled-unification.md → 实际文件 architecture/ADR-328-cap-enabled-unification.md（ADR-320 architecture 全量模板） -->
