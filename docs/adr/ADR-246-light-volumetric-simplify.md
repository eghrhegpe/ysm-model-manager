# ADR-246：灯光-体积光简化：删除空壳 postprocess 引擎、参数语义收编、补可视化

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-16
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/caps/light-capability.ts, frontend/src/preview-3d/caps/light-controls.ts, frontend/src/preview-3d/caps/light-cone.ts, frontend/src/preview-3d/state/env-state-schema.ts, ADR-081, ADR-177, ADR-196`

---

## 1. 背景（Context）

体积光（volumetric）是聚光灯的可视化附属，设定上**必须开启聚光灯才有效**（`light-cone.ts:144`
`if (!sp.enabled || !vm.enabled) return;`）。该设定本身正确，但实现层积累了四类病灶：

1. **postprocess 引擎是空壳**。ADR-081 L1 预留 `setVolumetricEngine("cone" | "postprocess")`
   枚举，声称「后续可平滑升级 post-process 体积光管线」，但后处理管线始终只有
   Output / Render / SSAO / SSR / UnrealBloom 五个 pass，**没有任何体积光 pass**。
   选 `postprocess` 的唯一实际效果是 `setVolumetricEngine` 立即把 `lightVolumetricEnabled`
   置 false（`light-capability.ts:485`）——即「选了就关掉」，用户看到体积光凭空消失。
   更严重的是切回 `cone` 时会**强行把体积光打开**（`:490`），覆盖用户原本的关闭意图，
   以至于 `light-capability.test.ts:495-507` 专门写了一条「审核修复回归」用例来绕这个坑
   ——**测试在守 bug 而非守功能**。

2. **`needComposer` 的 volumetric 分支是死逻辑**。`postprocessing-capability.ts:211-218`
   要求 `engine === "postprocess" && volumetric.enabled`，而写入 `postprocess` 的同时
   该 enabled 已被置 false，条件恒不成立。

3. **参数面与可调面严重脱节**。`env-state-schema.ts:208-243` 定义 31 个 light 键，
   而 `light-controls.ts:45-128` 只暴露 10 个控件、约 8 个真参数。体积光的 5 个视觉参数
   （opacity / fogPower / edgeFade / baseStrength / tipStrength）在 UI 上**完全不可达**，
   只能靠 `model-defaults.ts` 预设表硬编码。菜单里唯一的「锥角」滑块实际写的是
   `spotlight.angle`——**旋钮挂在错误的对象上，体积光自身零可调参数**。

4. **可视化能力为零**。全仓 `preview-3d` 无 `SpotLightHelper`，无 hintKey 引导
   （对照 `sky-menu.ts:102` 的 godrays hintKey）。用户拖动锥角滑块时没有任何空间参照。

加之挂载状态机（`rebuild/attach/detach/hasGroup/isMounted/syncPosition` 六态 +
`onEnvChanged` 三处重复双开判定 + `loadState` ④步引擎恢复）的复杂度**几乎全部服务于
这个不存在的引擎**。

## 2. 决策（Decision）

### D1：删除 postprocess 引擎抽象（回归单引擎）

删除 `setVolumetricEngine` / `getVolumetricEngine` / 内部 `volumetricEngine` 字段 /
菜单「锥引擎」下拉 / `env-state-schema` 的 `lightVolumetricEngine` 字段 /
`saveState` 写入 / `loadState` ④步引擎恢复 / `needComposer` 的 volumetric 分支。
同时修正 `postprocessing-capability` 的 Bloom 联动——原逻辑读的是一个在 postprocess
模式下必然被关闭的 `volumetric.opacity`，语义为空；改为只在 `volumetric.enabled` 为真时联动。

**理由**：一个没有实现的抽象不是「预留」，是负债。它污染了公开 API、schema、
持久化格式、状态机与测试契约五处，且对外暴露为「选了就坏的按钮」。
若将来真要做后处理体积光，届时应以**新增 pass** 的方式引入，
而非复活一个语义为「切换渲染器」的开关。

### D2：体积光参数 5 → 3 语义滑块（菜单层收编，不动内部契约）

`VolumetricParams` 的 5 个内部字段**保持不变**（shader uniform 契约与预设表兼容），
仅在菜单层收编为三个语义化滑块：

| 滑块 | 映射字段 | 含义 |
|------|----------|------|
| 浓度 | `opacity` | 最大不透明度 |
| 衰减 | `fogPower` | 空气散射幂次（越大越集中底部） |
| 边缘羽化 | `edgeFade` | 径向边缘软化 |

`baseStrength` / `tipStrength` 两个参数由**单一「上下亮度比」派生**：
`tipStrength = baseStrength * ratio`，默认 `0.9 / 0.25` ⇒ `ratio ≈ 0.28`，与现状视觉等价。

**理由**：`baseStrength`/`tipStrength` 是 shader 实现细节（`mix()` 的两端），
对用户不是可理解的概念；暴露它们等于把实现泄漏成配置。三个语义滑块覆盖
「多浓 / 衰减多快 / 边缘多软」这三个用户真正会问的问题。

### D3：补可视化——SpotLightHelper 线框 + 译名修正 + 聚光灯/体积光合并折叠卡

- 新增 `THREE.SpotLightHelper`，随聚光灯开关显隐，`applySpotlightToThree` 内 `update()`，
  `dispose()` 内释放。
- `zh-CN` 的 `preview.spotlight` 由「顶光」改为「聚光灯」（en/ja 本已正确）。
- 菜单层把聚光灯与体积光相关控件收进同一个可折叠卡。

**不做条件显隐**（用户裁定）：不引入 `visibleWhen` 隐藏逻辑，只做折叠分组。
**理由**：隐藏逻辑会让「参数为什么不见了」成为新的困惑源；折叠是用户可控的，
隐藏是系统替用户决定的。

## 3. 后果（Consequences）

**正面**
- 公开 API 面收窄，`light-capability.ts` 复杂度显著下降（删约 25 行 + `loadState` 去掉①步）。
- 消灭「选了就关掉体积光」的欺骗性控件，以及 3 条为绕 bug 而存在的回归测试。
- 体积光 5 个参数从「UI 不可达」变为「3 个语义滑块可达」，预设表不再是无 UI 情况下的唯一调节途径。
- 获得空间参照（helper），调参从盲拖变为可视。

**负面 / 已知遗留**
- `getVolumetricEngine` 为公开 API，有 5 处外部消费者（含测试 mock），一次性摘除，属破坏性变更。
- 老存档中的 `volumetricEngine` 持久化字段成为惰性数据（`loadState` 不再读取），
  不主动清理——read 时忽略即可，避免迁移代码。
- `ratio` 派生使 `baseStrength`/`tipStrength` 失去独立可调性；若未来确有需求，
  应在高级组恢复两个滑块，而非回退到「暴露实现细节」的现状。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `light-capability.ts:482-493` `setVolumetricEngine` 实现 | 确认 postprocess 分支只置 `lightVolumetricEnabled=false`，无渲染副作用 |
| `postprocessing-capability.ts:23-27` pass 导入清单 | 确认无体积光 pass，postprocess 引擎为空壳 |
| `postprocessing-capability.ts:211-218` `needComposer` | 确认 volumetric 分支恒 false（死逻辑） |
| `env-state-schema.ts:208-243` vs `light-controls.ts:45-128` | 31 键 vs 10 控件，确认 5 个体积光参数 UI 不可达 |
| `light-capability.test.ts:495-507` 「审核修复回归」注释 | 确认存在为绕开引擎恢复副作用而写的回归用例 |
| `zh-CN.ts:1150` / `en.ts:1169` / `ja.ts:1184` | 确认仅中文译名失准（「顶光」） |

<!-- 文件名: light-volumetric-simplify.md → 实际文件 ADR-246-light-volumetric-simplify.md -->
