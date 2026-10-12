# ADR-330：frustum-cull 逐根矩阵置脏：perFrame 契约携带根身份，消除多模型同框全体 updateWorldMatrix

- **状态**：✅ 已采纳（2026-10-12 当轮实施完成：perFrame 契约携根 + 4 动效 adapter 补 `root` + 消费端逐根/保守全体双形态，`render-host-per-root-dirty.test.ts` 四判据执法）
- **日期**：2026-10-12
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **准入理由**：跨 6 adapter 的 perFrame 契约改动（方向+难逆转+性能面），落实 2026-10-11 逐根化留下的消费端全体置脏债
- **相关**：`frontend/src/preview-3d/infra/frustum-cull.ts`（逐根机制）、`frontend/src/preview-3d/infra/render-host.ts`（消费端全体置脏）、`frontend/src/preview-3d/adapters/mount-preview-core.ts`（BaseScene 契约 + setPerFrame 单一调用点）、ADR-093 T5（视锥裁剪）、2026-10-11 `5dd02435f`（frustum-cull 脏标记逐根化——机制侧已备好，消费端未喂根）

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

2026-10-11 `5dd02435f` 把 `frustum-cull` 的矩阵脏标记从「全体」逐根化为 `_dirtyRoots`/`_allDirty`（`markCullMatricesDirty(root?)`：带参=只脏该根，不带参=全体保守兜底），让「剔除开启 + 多模型同框」时静态根可跳过全子树 `updateWorldMatrix(true,true)`。

但**消费端未吃到此收益**：`render-host.ts|animate` 的 rAF 帧循环在「存在任一 perFrame 回调」时仍调**全体**形态 `markCullMatricesDirty()`（render-host.ts L334 注释自认「已知的有意保守」）——因为 `registerPerFrame(f)` 的 perFrame 契约为 `(dt) => void`，**不带根身份**，本循环无法归属某 perFrame 回调改写了哪个根。后果：视锥裁剪开启 + 多模型同框 + 至少一个模型有动画（MMD SpringBone / VRM 骨骼等）时，**所有**注册根每帧被强制全子树矩阵刷新（「一个模型动画、全体静态根陪刷」），逐根化初衷落空。单模型场景走 `length===1` 豁免分支、剔除默认关 → 常态零影响（此为 10-12 探明 P2-#3 在册项）。

## 2. 决策（Decision）

**把根身份沿 perFrame 契约打通，消费端按「本帧实际驱动过哪些根」逐根置脏，无根身份者保守回退全体**——最小安全切法：

1. **契约**：`BaseScene` 增可选数据字段 `root?: THREE.Object3D`（= 该 adapter `registerModelRoot` 注册的同一根对象）；`registerPerFrame(f, root?)` / `SwitchCtx.setPerFrame(f, root?)` 透传。
2. **实施**（4 个动效 adapter 补 `root`：fbx `group` / mmd `c.mesh` / ysm `obj.rootGroup` / vrm `vrm.scene`；静态 adapter 无 `update` 故 perFrame 为 null，不受影响）；`render-host` 帧循环收集本帧 perFrame 携带的根集合：任一回调**无根** → 全体置脏（保守兜底，正确性不变）；全有根 → 仅逐根置脏。
3. **不变量**：`root` 缺省 = 行为与今日完全一致（全体置脏）——改动纯增量、零回归面；frustum-cull 逐根机制与契约测试（`frustum-registration-contract`）不动。
4. 逐根置脏只在「视锥裁剪开启」分支生效（关时 `restoreModelGroupsVisible`，零影响）。

## 3. 后果（Consequences）

**正面**
- 剔除开启 + 多模型 + 有动画的组合下，静态根不再每帧陪刷全子树矩阵（逐根收益真正落地）；
- 根身份走既有 `BaseScene` 数据字段 + 既有 `registerPerFrame` 可选参，无新模块、无新全局态。

**负面 / 已知遗留**
- perFrame 契约面 +1 可选参（`registerPerFrame`/`setPerFrame` 7 处透传点 + 4 adapter + 类型），改动面广但逐点机械；
- 无根身份的回调仍走全体兜底（正确性优先）——未来 adapter 若新增 perFrame 而忘设 `root`，自动回退全体（不劣化于现状）；
- 不解决「perFrame 回调写 uniform 不写变换却仍置脏根」的更细粒度（属后续可选：回调自报 `writesTransforms`）。

## 4. 数据溯源

- 2026-10-11 `5dd02435f`「frustum-cull 脏标记逐根化」→ 机制侧 `_dirtyRoots`/`_allDirty` + `markCullMatricesDirty(root?)` 已落地；
- render-host.ts L326-334 注释自认「此处仍走全体形态，属已知有意保守……要真正吃到逐根收益，需把根身份沿 perFrame 契约打通到 6 个 adapter」→ 本 ADR 即该跨层改动的立项；
- 2026-10-12 探明 P2-#3（新债 #3 记账观察）实数：`_perFrames.length>0` 即置全体，单模型走豁免分支常态零影响。

<!-- 文件名: frustum-per-root-dirty.md → 实际文件 architecture/ADR-330-frustum-per-root-dirty.md（ADR-320 architecture 全量模板） -->
