# ADR-247：后处理收口：联动读意图而非可见性、SSR 抑制态显式化、总闸门禁内移

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-16
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/caps/postprocessing-capability.ts, frontend/src/preview-3d/state/preview-state.ts, ADR-196, ADR-246, ADR-126`

---

## 1. 背景（Context）

对后处理能力做同类「开关撒谎」排查（承接 ADR-246 对体积光的结论）后，确认三项缺陷。
后处理本身比体积光健康——**无空壳开关、无死逻辑、20 个参数全部有控件可达**——但存在下列问题：

1. **联动开关在默认配置下恒不生效（真缺陷）**。ADR-246 D1 把 Bloom 联动的门禁收紧为
   `volumetric.enabled`（此前读一个被引擎强制关闭的 `opacity`，更荒谬）。但
   `ppBloomFollowVolumetric` 默认 `true` 而 `lightVolumetricEnabled` 默认 `false`，
   故默认配置下 `gain` 恒为 0：**开关显示「开」，却从不联动**。这恰是 ADR-246 要根治的
   「开关撒谎」，只是从体积光搬到了 bloom 联动上。根因是把「用户偏好」与「另一功能的运行时
   可见性」耦合——可见性取决于聚光灯这一物理前置，不该静默撤销用户偏好。

2. **SSR/Reflector 抑制态用单变量承载双重语义**。`reflectorPrevEnabled: boolean | undefined`
   同时表达「压制前的值」与「是否正在压制」，哨兵 `undefined` 与合法值 `false` 混淆；
   且该同步是 pull 式（仅由 postprocessing 侧事件触发），无法观测用户手动拨动 reflector。
   后果：用户压制期间手动重开 reflector 后，SSR 关闭会用陈旧值抹掉用户选择。

3. **总闸的「不抹门禁」保护落在调用方**。ADR-196 删除 `params.enabled` 双写后，
   per-type 门禁与生效开关共用 `this.enabled`；门禁之所以存活，全靠
   `preview-state.ts` 那行 `setMasterEnabled(v ? getParams().enabled : false)` 把门禁值
   回读再传回。约束在 cap 之外（cap 内注释还引用了已删除的 `params.enabled`），
   任何绕过该行的新代码都会破坏「off→on 循环可恢复」这一已修复回归。

## 2. 决策（Decision）

### D1：联动读「浓度意图」，与「此刻是否可见」解耦

`syncBloomPass` 的 `gain` 直接取 `volumetric.opacity`，门禁只看 `ppBloomFollowVolumetric`
开关本身。

**理由**：联动语义是「是否接受体积光浓度调制 bloom」的**用户偏好**；`opacity` 是用户设定的
浓度意图，恒有值。用「可见性」做门禁，等于让一个 UI 偏好开关继承另一功能的运行时状态——
「A 开关的效果依赖 B 开关」的组合一律有此风险（体积光↔聚光灯、SSR↔reflector 同属此类）。

### D2：SSR 抑制态拆为显式两字段，解除时按「归属」判定

`reflectorSuppressing: boolean`（本 cap 是否持有压制）+ `reflectorPrevEnabled: boolean`
（压制前值）。解除压制时：

- reflector 仍为关闭 → 压制仍由本 cap 持有 → 还原 `reflectorPrevEnabled`
- reflector 已被用户开回 → 本 cap 已非持有者 → **保留用户选择**，不回放陈旧值

两种情况都清空抑制态，保证下一轮 SSR 能重新记录基准。`dispose()` 同口径。

**理由**：压制是「借走一个能力，事后归还」，必须能回答「借条还在谁手上」。单变量无法表达
`false`（借走时本来就是关的）与 `undefined`（没借过）的区别。

### D3：总闸与门禁恢复为 cap 内的正交字段

新增 `perTypeGate`（模型类别预设是否允许）与 `perfMaster`（性能档位总闸）两个私有字段，
生效开关 = `perfMaster && perTypeGate`，由 `syncEffectiveEnabled()` 统一重算并落地副作用。
`setMasterEnabled(v)` 只写总闸；`applyPostProcDefaults` 只写门禁；手动开关 `setEnabled`
绕过二者（保持既有「手动开关不受此限」语义）。

**理由**：门禁保护必须是**自持的不变量**，不能依赖调用方的表达式正确。调用方只应传
「档位意图」，其余由 cap 裁决。

## 3. 后果（Consequences）

**正面**
- 联动开关在默认配置下真正生效，消灭一处「默认即坏」的开关撒谎。
- SSR/Reflector 的归还语义可回答归属问题，用户手动覆盖不再被静默抹掉。
- 总闸门禁保护内移，`preview-state.ts` 的调用简化为传意图，注释不再引用已删除字段。

**负面 / 已知遗留**
- `postprocessing-capability.test.ts` 与 `preview-state.test.ts` 中镜像真实 cap 的 fake
  需同步更新——`preview-state.test.ts` 的 fake 此前保留 `params.enabled` 独立字段，
  **镜像的是 ADR-196 之前的架构**（测试与真实实现存在契约漂移），本次一并校正。
- 构造参数 `enabled` 同时作为门禁初值（`perTypeGate = this.enabled`），以保证构造后
  「生效 = 总闸 && 门禁」立即自洽；否则 `setMasterEnabled` 会因门禁初值 false 而无声失效。
  这是构造语义的轻微重载，已在代码内注释说明。
- 三项修复均以「先写测试 → 确认测试能抓住缺陷 → 再修实现」推进；其中 D2 的首个测试用例
  经反证发现是空洞的（压制前为「开」时，回放 prev 与用户选择恰好相同，无法区分两条路径），
  已改为「压制前关、期间手动开」才真正区分。

## 3.1 独立审查补强（同批修复）

初版实现经子代理对抗式审查后，确认两处真实缺陷并补强，一处为**阻断级**：

**R1（阻断，D3 引入的回归）**：构造器以 `perTypeGate = this.enabled` 播种门禁，但
`loadState` 只恢复 `this.enabled`、不写门禁，二者永久失配。当存档 `enabled=true` 而构造
入参为默认 `false` 时，门禁停在 `false`：总闸 off→on 后被陈旧门禁无声否决，**后处理再也开
不回来**——恰是本 ADR 声称要保护的「off→on 可恢复」不变量。因
`POSTPROC_PRESETS.default = {}`（`postprocessing-state.ts`）不写门禁，且
`shared-infra.ts` 传原始 `adapter.id`，任何六个预设之外的模型类型必踩。
**修复**：`loadState` 的 `enabled` 恢复分支同步写 `this.perTypeGate`。已补两条回归测试
（含 `applyPostProcDefaults("default")` 组合场景），修复前均转红。

**R2（D1 移除守卫）**：原式 `vol.enabled ? vol.opacity : 0` 在体积光关闭时短路为 0，
顺带掩盖了 `opacity` 缺失；改为直读后，`undefined` 经乘法扩散为 `NaN` 写入
`bloomPass.strength/threshold`（无 clamp）永久污染 bloom。生产路径
`light-capability.readVolParams` 恒出数值，但 `syncBloomPass` 接受外部 `LightCapability`
stub，须自守。**修复**：加 `typeof raw === "number" && Number.isFinite(raw) ? raw : 0`
守卫，并补 4 例参数化测试（undefined / NaN / null / 字符串），去守卫后转红。

**R3（非缺陷，补测试锁定）**：SSR 活动期间用户手动重开 reflector 会被下一次同步再次压制。
经核验这是「SSR 活动时 reflector 必须关闭」的**预期功能语义**（`applyReflectorSync` 六处
调用点均为 pull 式，SSR 活动即重新施加压制），并非 D2 的漏洞——D2 只负责解除时的归属判定。
已补测试锁定该预期，避免后续被误当缺陷「修掉」。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `postprocessing-capability.ts` `syncBloomPass` + `env-state-schema.ts` 默认值 | 确认联动默认 on、体积光默认 off ⇒ gain 恒 0，开关撒谎 |
| `postprocessing-capability.ts` `applyReflectorSync` / `dispose` | 确认单变量哨兵 `undefined` 与合法 `false` 混淆 |
| `reflector-capability.ts` `setEnabled` | 确认用户面板 toggle 可写回，故覆盖路径真实可达 |
| `preview-state.ts` `render.bloom` set 分支 | 确认门禁保护在调用方表达式，cap 内无门禁字段 |
| `postprocessing-capability.ts` 注释「不触碰 per-type 门禁 params.enabled」 | 确认该字段已随 ADR-196 删除，注释为陈旧引用 |
| `preview-state.test.ts` fake 的 `params.enabled` 独立字段 | 确认测试镜像的是 ADR-196 之前的架构（契约漂移） |

<!-- 文件名: postproc-linkage-gate.md → 实际文件 ADR-247-postproc-linkage-gate.md -->
