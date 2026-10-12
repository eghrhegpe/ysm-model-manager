# ADR-328：cap 能力总开关统一收编 envState 与 ground 终态

- **状态**：✅ 已采纳（Accepted；路径 C `mounted` 收编已落地 2026-10-12）
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

> 状态：📝 提议中（待拍板）。下面三条路径的**可行性已实测**（2026-10-11 落地最小切片 + 跑测试），结论如下。

**路径 A（去字段、isEnabled 恒 true）—— 实测不可行**：`setEnabled(v)` 驱动的是 mesh 物理挂/摘生命周期（非纯状态切换），`ground-capability.test.ts` 强断言 `setEnabled(false)` 摘 mesh、`setEnabled(true)` 重挂；且 `GroundOverlay(() => this.enabled)` 闭包依赖 `enabled` 可变。强行恒 true 会破坏 81 个测试里的挂摘断言。

**路径 B（收编 `envState.groundEnabled` schema 键）—— 语义有缺陷**：`ground-menu.ts` 的 `buildGroundNodes` 只暴露参数级 `ground-visible`（绑 `getVisible()`→`envState.groundVisible`），**没有 `ground-enabled` toggle 节点**——ground 刻意能力级开关无 UI 抓手。收编会注入一个用户碰不到的死键，且把「挂载态」错当「用户开关」。

**路径 C（挂载态语义澄清）—— 实测可行（推荐收敛方向）**：ground 的 `enabled` 本质是 **cap 挂载态**（mount/unmount mesh），不是用户能力开关——这正解释它为何故意不进 schema、无 UI 写口、生产恒 true。`setEnabled/isEnabled` 方法签名保留（测试/生命周期 API 契约不变），仅将私有字段 `private enabled: boolean` 改名为 `private mounted: boolean`（及其 7 处内部读写）。检测器正则只认 `enabled` 字段名，改名即自然放过，`check-cap-enabled-duality` 归零；语义上把「挂载态」与「用户能力开关」区分开，与 ground 的设计意图一致。

**建议方向**：采纳路径 C。债检测器对 ground 的判定，本质是把「能力挂载态」与「用户能力开关」混为一谈；ground 的挂载态是生命周期内部状态，不应被持久化或用户操控，故不应进 schema（与 ADR-250/F-1 的「用户开关收编」范式正交，不是漏登）。

**待拍板项（须人类决策，不在此代答）**：
1. 是否确认 ground 的 `enabled` 按「挂载态」语义处理（路径 C：改名 `mounted`），而非套用用户能力开关范式？这是本 ADR 的核心分歧点。
2. 若确认 C：`mounted` 字段是否进一步加 `readonly` 或固化「挂载态非开关」注释约定（纯实现细节，不影响检测器判定）。

## 3. 后果（Consequences）

- **正面（路径 C）**：`check-cap-enabled-duality` 从「1 违规」归零（实测 `clean:11`），cap-enabled 收口在全域彻底闭合；ground 的 `enabled` 语义从「被检测器误判为未对齐 schema 的能力开关」澄清为「生命周期挂载态」，与 ground 刻意不进 schema、无 UI 写口的设计意图一致。
- **负面 / 成本（路径 C）**：`mounted` 字段与 `setEnabled/isEnabled` 方法名形成「名（enabled）实（mounted）分离」——方法名仍带 enabled 因其对外是 cap 生命周期 API；这是有意的命名分层，需在代码注释固化以免后人误把 `setEnabled` 当成用户开关接入 UI。
- **替代路径的代价**：路径 B 会在 envState 注入一个用户碰不到的 `groundEnabled` 死键并进入持久化/UI 轮转；路径 A 已实测破坏挂摘测试，不可行。
- **已知遗留**：`check-cap-enabled-duality` 目前**只报不拦**（debt 口径、2026-11-08 复审窗口内），故本 ADR 不阻塞推送；路径 C 实测已验证可干净落地，建议在复审窗口内随本 ADR 拍板一并提交。

## 4. 数据溯源

- 现状实证（当前源码树）：
  - 唯一违规：`frontend/src/preview-3d/caps/ground-capability.ts` 的 `private enabled: boolean` 字段（`isEnabled()`/`setEnabled()` 读写），`ENV_STATE_SCHEMA` 无对应 `groundEnabled` 键（`scripts/check-cap-enabled-duality.ts --json` 报 `errors:1`、其余 10 cap `clean`）。
  - 已完成收口的对照样本：`fogEnabled`（ADR-196）、`shadowEnabled`/`reflectorEnabled`（F-1）、`lightEnabled`/`ppEnabled`（ADR-250）、`waterEnabled`（water 同源）均已落 `ENV_STATE_SCHEMA` 键族。
  - ground 有意不收编的注释证据：见 `ground-capability.ts` 约 L683–691 / L712–714 / L766 三处「另立 ADR，不混入本批」记载。
  - 检测器口径：`scripts/check-cap-enabled-duality.ts`（`private enabled` 字段定义 + schema 无 `{capName}Enabled` 键 → 违规）。
- **路径可行性实测（2026-10-11）**：
  - 路径 A 实测：把 `enabled` 改为恒 true 常量会破坏 `ground-capability.test.ts` 的 `setEnabled(false)` 摘 mesh / `setEnabled(true)` 重挂断言（约 L135 / L474–497），且 `GroundOverlay` 闭包依赖可变 `enabled`——不可行。
  - 路径 B 缺陷：`ground-menu.ts` 的 `buildGroundNodes` 仅暴露 `ground-visible`（绑 `getVisible()`→`envState.groundVisible`），无 `ground-enabled` toggle；收编 `groundEnabled` 键将成无 UI 抓手的死键。
  - 路径 C 实测：`private enabled` → `private mounted`（7 处内部读写同步改名），`setEnabled/isEnabled` 方法签名保留；跑 `check-cap-enabled-duality` 得 `errors:0, clean:11`，ground 测试 `81 passed`，`typecheck` + `vite build` 全绿。
- 关联知识卡：实施进度与边界细则见 `docs/knowledge/preview-env-state.md`（不变量段）。

<!-- 文件名: cap-enabled-unification.md → 实际文件 architecture/ADR-328-cap-enabled-unification.md（ADR-320 architecture 全量模板） -->
