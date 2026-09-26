# ADR-315：水/VRM 适配层拆真缝收编

- **状态**：✅ 已采纳（Adopted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-26
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/caps/water-capability.ts` / `frontend/src/preview-3d/adapters/vrm/vrm-adapter.ts` / `scripts/check-file-lines.ts` / ADR-227（mount-preview-core 同法锁红先例）

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

`check-file-lines` 的规则表只有 1 条硬红线（mount-preview-core.ts ≤1045，ADR-171 §2.2 / ADR-227），而仓内实际存在多个超 1000 行的生产文件游离在门禁之外：

- `preview-3d/caps/water-capability.ts`：1132 行（分派表 + shader 注入 + 倒影子系统 + 类体混杂）
- `preview-3d/adapters/vrm/vrm-adapter.ts`：1401 行（解析/meta/动作通道/感知/菜单节点 5 类职责同居一文件）

「逐文件点名宽免」的模式不扩，只沿真缝拆分后对新尺寸锁红——与 ADR-227 对 mount-preview-core 的处置同法。

## 2. 决策（Decision）

### D1：water-capability 沿真缝拆三刀（行为零变更，纯搬运 + import 重接）

- **① 参数分派表** → `caps/water-params.ts`：`WATER_PARAM_APPLIERS` / `WATER_PARAM_APPLIER_KEYS` / `WATER_NOOP_APPLIER_KEYS` / `WATER_UNIFORM_NAMES` / `WATER_FRAME_READ_KEYS` / `WaterParamKey` / `WaterApplyCtx` / `applyStructuralProfile` / `NOOP_APPLIER`。
  依赖：仅 envState + strategy + patch-guard（原文件既有依赖的子集），零 THREE。
- **② 倒影子系统** → `caps/water-reflect.ts`：`ensureReflector` / `disposeReflector` / `renderReflection` / `applyReflectionUniforms` / `reflectionActive` / `REFLECTOR_CLIP_BIAS_TOLERANCE` + 实例状态（reflector / reflectorClipBias / reflWorldInv）经 `WaterReflectState` 对象移交 cap 持有。
- **③ 类体保留真缝**：`WaterCapability` 类本体（constructor / 渲染应用 / setter 群 / saveState / loadState / dispose / getMenuNodes）留在 `water-capability.ts`；原 4 组导出符号（WATER_PARAM_APPLIER_KEYS 等）经 re-export 垫片保持测试与外部 import 路径零改动（反桶契约豁免：单来源转发，与 ADR-195 刀2 node-types 垫片同口径）。

### D2：vrm-adapter 沿真缝拆三刀（同上纪律）

- **① 动作通道** → `adapters/vrm/vrm-motion.ts`：`loadVrmaClips` / `loadVmdClips` / `listCustomAnimVmd` / `listVmdPathLists` / `loadMotionClips` / `motionLabel` + `VrmMotionClipEntry` / `VrmMotionState` 类型。
- **② 感知层驱动** → `adapters/vrm/vrm-perception.ts`：`buildPerception` / `applyIdlePerception` / `applyAnimationFootIK` / `applyBlinkPerception` / `VrmPerceptionState` / `VrmIdlePerceptionDeps`。
- **③ 菜单节点工厂** → `adapters/vrm/vrm-menu.ts`：`vrmMenuItems` / `vmdPositionScaleNodes` / `VrmMenuItemsOpts` / `VrmPositionScaleControl` / `VRM_PLAY_EMPTY_NODE` / `emptyVrmPlayBridge`；原导出经 re-export 垫片保持 `mount-preview-core.test.ts` 等 30+ 消费者零改动（同 D1 ③）。

### D3：check-file-lines 锁红 + 报错即文档

拆分后把两个瘦身后文件以实测行数 + 小余量登记进 `RULES`（water 845 行 → 红线 860；vrm 764 行 → 红线 790；超限即红，扩肥须走新 ADR）。

**报错即文档**（锐评建议③收口）：`check-file-lines` 的违规/肥膘告警输出内置可执行修复指引——违规附「①沿真缝拆分（默认路径 + 先例清单）/ ②发新 ADR 放宽」二选一指引，肥膘告警附排期入口与「排期写知识卡、不写 ADR」纪律提示。新人 / AI 会话读报错即知修法，执法细节从 AGENTS.md 下沉至门禁输出。

## 3. 后果（Consequences）

- 正面：1132/1401 行巨型文件降至红线内；「逐文件点名宽免」模式不扩散；新缝全部是零行为变更搬运（契约测试全量绿）。
- 负面：新增 5 个 seam 文件 + 2 处 re-export 垫片，import 图变宽；seam 文件间循环依赖风险由 check-circular 兜底。
- 已知遗留：sky-capability（992）/ web-fs（1030）仍超 1000 行，未登记 RULES——本 ADR 不代决策，待后续同类处置。
- 执行 3 落地验证：违规路径实测（临时放宽 maxLines 触发红 → 输出修复指引二选一 → 恢复绿）；
  肥膘告警路径实测（11 个 scripts 文件超阈 → 排期情报块输出，exit 0 不阻断）。

## 4. 数据溯源

- 触发：check-file-lines 现状（RULES 仅 1 条）+ 生产文件 >800 行实测清单（water 1132 / vrm 1401 / web-fs 1030 / sky 992）。
- 先例：ADR-227 D1（mount-preview-core 沿 preview-shell / session-ledger 真缝抽取后锁红 1045）；ADR-195 刀2（re-export 垫片保消费者 import 零改动）。

<!-- 文件名: vrm.md → 实际文件 ADR-315-vrm.md -->
