# 灯光-体积光简化方案（待拍板）

> 设定前提：**体积光是聚光灯的附属效果，必须开启聚光灯才有效**。
> 目标：砍掉不存在的抽象、把参数从 5 个收成 3 个语义滑块、补真正的可视化（helper 线框）、修「顶光」译名。
> 用户裁定：**不做条件显隐**（聚光灯与体积光合并进一个折叠卡即可）。

## 一、现状病灶（已核实，附文件:行号）

| # | 病灶 | 证据 |
|---|------|------|
| 1 | **postprocess 引擎是空壳**：选它立刻关体积光，而管线里无任何体积光 pass | `light-capability.ts:482-493`（`engine==="postprocess"` → `lightVolumetricEnabled=false`）；`postprocessing-capability.ts:23-27` pass 清单只有 Output/Render/SSAO/SSR/UnrealBloom |
| 2 | **切回 cone 会强行打开体积光**，覆盖用户意愿 | `light-capability.ts:488-490` |
| 3 | **测试在守 bug**：专门有回归绕开「引擎恢复误开体积光」 | `light-capability.test.ts:495-507` |
| 4 | **31 个 light schema 键，菜单只露 8 个参数**；体积光 5 个视觉参数 UI 全不可达 | `env-state-schema.ts:208-243` vs `light-controls.ts:45-128` |
| 5 | **「锥角」滑块挂在 spotlight.angle 上**，体积光自身零参数 | `light-controls.ts:105-116` |
| 6 | zh「顶光」≠ en "Spotlight" / ja「スポットライト」，语义断 | `locales/zh-CN.ts:1150` |
| 7 | 无 helper、无 hint，拖滑块靠肉眼猜 | 全仓 `preview-3d` 无 `SpotLightHelper` |
| 8 | 挂载六态状态机复杂度几乎全服务于不存在的引擎 | `light-cone.ts` 六态 + `light-capability.ts:285-317` 三处双开判定 + `loadState:561-576` ④步 |

## 二、刀1：砍假引擎（删 postprocess）

删除清单：
- `light-capability.ts:203, 482-497, 534, 561-576` — `volumetricEngine` 字段、`set/getVolumetricEngine`、`saveState` 写入、`loadState` ④步
- `light-controls.ts:12-15, 95-104` — `LIGHT_ENGINE_OPTIONS` + `light-engine` 节点
- `env-state-schema.ts:238-243` — `lightVolumetricEngine` 字段
- `light-capability.test.ts:391-425, 495-507, 529-535` — 绕坑用例（改为直接断言「体积光开关跨会话保持」）
- `postprocessing-capability.ts:211-218` — `needComposer` 的 volumetric 分支；`:360-368` bloom 联动改为只读 `volumetric.enabled` 判空语义
- `locales/{zh-CN,en,ja}.ts` — 删 `preview.volumetricEngine`
- `litematic-3d.test.ts:301` — mock 的 `getVolumetricEngine` 摘除

**收益**：`light-capability.ts` 减 ~25 行、`loadState` 从 4 步降为 3 步、状态机「引擎切换」维度整体消失。

## 三、刀2：体积光参数 5 → 3（语义收编）

保留 `VolumetricParams` 内部 5 字段不动（shader 契约 + 预设表兼容），只在**菜单层**收编为 3 个语义滑块：

| 滑块 | i18n | 映射 | 范围 |
|------|------|------|------|
| 浓度 | `preview.volumetricDensity` | `opacity` | 0–1, step 0.05 |
| 衰减 | `preview.volumetricFalloff` | `fogPower` | 0.5–3.0, step 0.1 |
| 边缘羽化 | `preview.volumetricEdgeFade` | `edgeFade` | 0–1, step 0.05 |

`baseStrength` / `tipStrength` **合并为「上下亮度比」**（单一 ratio 派生两者）：
- `ratio ∈ [0,1]` → `tipStrength = baseStrength * ratio`
- 默认值 `baseStrength=0.9, tipStrength=0.25` ⇒ `ratio ≈ 0.28`，行为与现状等价

⚠️ 若坚持「最精简」可只留浓度+软硬 2 个；当前按用户选择走 **3 滑块**（第 3 个 = 边缘羽化）。

## 四、刀3：可视化

1. **SpotLightHelper 线框**：`light-capability.ts` 新增 helper，`applySpotlightToThree`（`:589-597`）同步 `helper.update()`；开关绑到聚光灯 toggle（开聚光灯即显线框）。`dispose()`（`:618`）释放。
2. **译名修正**：`zh-CN.ts:1150` `preview.spotlight` 「顶光」→「聚光灯」。
3. **折叠卡**：`light-controls.ts` 把 `light-spotlight` / `light-volumetric` / 3 个体积光滑块 / 锥角 收进 `kind:"card", collapsible:true` 的「聚光灯与体积光」卡（**不做 visibleWhen 隐藏**）。

## 五、i18n 新增 key（三语同步，否则 `locales-consistency.test.ts` 报）

`preview.volumetricDensity` / `preview.volumetricFalloff` / `preview.volumetricEdgeFade` /
`preview.spotlightVolume`（卡标题）→ zh / en / ja 各 4 条。

## 六、风险与验证

- **破坏性**：`getVolumetricEngine` 有 5 处外部消费者（含 2 个测试 mock），须一次性摘净，否则 typecheck 红。
- **预设兼容**：`model-defaults.ts` 的 `lightVolumetric*` 键不动，老存档 `loadState` 仍可读。
- 验证：`cd frontend && npx vite build && npm run typecheck` + `npx vitest --run light-capability postprocessing-capability` + `node scripts/check-biome.ts --files <改动文件>`。

## 七、待确认

- 是否同步写 ADR（刀1 删 schema 字段 + 公开 API，属架构级）。
