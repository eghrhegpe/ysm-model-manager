# ADR-309：VRM 播 VMD 播放语义收口（锐评 P1-P7 七处修法落定）

- **状态**：✅ 已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-25
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：ADR-243（VMD→VRM 重定向管线）; ADR-306（VMD 表情改道）; ADR-230（代际守卫唯一出口）; `frontend/src/preview-3d/adapters/vrm/vrm-adapter.ts; frontend/src/preview-3d/adapters/vrm/vmd-retarget.ts; frontend/src/preview-3d/adapters/vrm/vmd-expression-map.ts; frontend/src/preview-3d/bone/vrm-foot-ik.ts`

---

## 1. 背景（Context）

ADR-243 / ADR-306 落地后，「VRM 模型播放 MMD 动作（.vmd）」通了，但**播放语义层**仍按 MMD 侧的惯性设计，与 VRM 侧的渲染管线存在七处错位。一轮「VRM 播 VMD 锐评」逐条对账后收出 P1-P7：

| 编号 | 病灶 | 后果 |
|------|------|------|
| **P1** | select 切换动作只 `stop()`，不复位 | 重定向 clip 轨道只覆盖**该 VMD 驱动过**的骨；未覆盖骨停在旧 action 末帧值，归一化骨每帧单向烘回原始骨 ⇒ 残留姿势永久投影（手指锁死在上一段舞蹈的抓握姿势） |
| **P2** | 原生 lookAt 的 target 常驻摄像头 | VMD 带眼轨（左目/右目）时，lookAt 每帧把眼骨拽向摄像头，与动作意图**双向打架** |
| **P3** | positionScale 自动值在**每次菜单构建/复位时重读归一化骨世界位置** | 动画中途重读会读到被动画污染的位姿 ⇒ 「自动值」漂移 |
| **P4** | VMD 的 `propertyKeyFrames[i].ikStates`（IK 开关时间轴）被忽略，足 IK 每帧无差别求解 | 作者**关闭**足 IK 的段落里 CCD 仍在把脚钉向 VMD 目标 ⇒ 抬脚段被强行拖回地面 |
| **P5** | 位移缩放改值 = 重读整库 + 重解析 + 重建 clip + 换绑 action | 一次松手 = 全部 .vmd 重新走一遍 parse+retarget；在途重建可能落在 dispose 之后 |
| **P6** | 自动播放无差别取 `clips[0]`，MMD 动作库（CustomAnim）的 vmd 与同目录 vmd 平权 | 库里的**别人家的**动作被自动播到用户模型上（配布条款雷区），且「列表里有什么」与「自动播了什么」无对应关系 |
| **P7** | 表情映射表两处内容错误：`真顔`→angry、`ウィンク`/`ウインク`→blink；`雰囲気` 漏收 | 「清脸」morph 每次触发 angry（面部乱抖）；MMD 单眼 wink 映成双眼 blink（两眼一起错闭） |

## 2. 决策（Decision）

### D1（P1）：切动作 = 先复位，再 play

`select` 切换时：`stop()` 旧 action → `vrm.humanoid.resetNormalizedPose()`（归一化骨回 rest）→ `vrm.expressionManager?.resetValues()`（表情权重清零）→ 新 action `play()`。横移 MMD 侧 `skeleton.pose()` + `action.reset()` 的既有纪律。未覆盖骨干净停在 rest，新 action 首帧由 mixer 重写覆盖骨。

### D2（P2）：lookAt 让道条件 = `animActive && drivesEyes`

`VrmMotionClipEntry` 新增 `drivesEyes: boolean`（重定向 clip 含左目/右目 quaternion 轨道时为 true；`.vrma` 条目按其 humanoid 轨道是否驱动眼骨判定）。每帧 update：

```
if (vrm.lookAt) vrm.lookAt.autoUpdate = !(animActive && currentEntry.drivesEyes);
```

- 待机态 / 播无眼轨的动作：`autoUpdate=true`，原生 lookAt 照常盯摄像头；
- 播带眼轨的 VMD：`autoUpdate=false`，lookAt 早退（`VRMLookAt.update` 官方实现），眼骨完全交给 mixer 的眼轨；
- 切回无眼轨动作/暂停 → 下一帧恢复 true，眼骨交还 lookAt（无重置跳变：lookAt 首帧 update 即收敛到摄像头方向）。

### D3（P3）：自动缩放创建期快照

`autoPositionScale` 在 `loadMotionClips` 创建期（首帧 mixer.update 前，模型 rest 位姿）算**一次**，存入 `VrmMotionState`。菜单 `current()` / `resetToAuto()` 一律读快照，不再每次重算。与 P5 的 D5 同路径落地。

### D4（P4）：IK 开关时间轴进采样器

重定向器新增 `extractVmdIkTimeline(vmd, ikBoneNames)`：扫 `vmd.propertyKeyFrames` 的 `ikStates`（`[boneName, enabled][]`），对每条命中的 IK 骨名生成**按时间轴升序**的开关段表（`{ from, to, on }[]`），语义 = MMD 侧「该骨 IK 生效区间」。`VmdFootIKTarget` 扩展 `isEnabled?(t): boolean`（缺省 = 全程启用，`.vrma` 与旧数据源零影响）。`vrm-foot-ik.ts` 求解前查开关：关闭段**跳过该侧 solveIK**（足回到 FK 自然位，与 MMD 关闭 IK 时表现一致），开放段照旧 CCD。

### D5（P5）：原地 rescale + 加载代际守卫

- 重定向器在烘焙位移轨**前**快照 `raw`（k=1 原值），产物带 `posTracks: { track, base, raw }[]`；
- `rescaleVmdPositionTracks(handles, k)`：`value = base + (raw − base) × k`，O(值总数) 原地改写——轨道 values 被 mixer interpolant 与 IK 采样器共享引用，下一帧即生效，**免重读、免重解析、免换绑 action**（同一 action 对象存活，播放进度不重置）；
- 滑块**拖动逐 tick 实时 rescale**（`set`），松手（`onCommit`）才落盘持久化；`resetToAuto` 回创建期快照并 rescale；
- `loadMotionClips` 全程挂 `createLoadGuard()`（ADR-230），`dispose` 调 `invalidate()`：在途加载结果不落地。

### D6（P6）：库动作只进列表，不自动播

`VrmMotionClipEntry` 新增 `origin: "local" | "library"` + `path: string`。自动播语义：

- 有 **local** 条目（同目录 .vrma/.vmd）⇒ 自动播**第一个 local**；
- 只有 library 条目（仅 MMD 动作库命中）⇒ **不自动播**（白模待机），库动作只出现在选择列表里，由用户显式 select。

理由：CustomAnim 库是跨模型的共享资产，配布条款常含「MMD 以外使用禁止」等限制（P1a 版权提示已立牌）；自动播 = 替用户做出处置，且可能播到与模型体型/轴系不符的动作。列表平权、自动播收权到 local，是「默认安全」与「功能可达」的折中。

### D7（P7）：表情映射表内容纠错

- `真顔`：MMD 作者的「清脸」morph（恢复默认），VRM preset 无对应物 ⇒ **显式不映射**（早期误映 angry，每次清脸都在生气）；
- `ウィンク`/`ウインク`（无左右标注）：MMD 配布里绝大多数是**单眼**，映双眼 blink 会两眼一起错闭 ⇒ **v1 不映射**，单眼 wink 归二期 `blinkLeft`/`blinkRight`（ADR-306 §3.3 二期项）；
- `雰囲気`：候选表漏收 ⇒ **补回 relaxed**（ADR-306 §2.1 原文即有，代码落地时丢了）。

## 3. 后果（Consequences）

**正面**
- 切动作无残留姿势（P1）、眼轨与 lookAt 不再互撕（P2）、缩放值全生命周期稳定（P3/P5）、IK 关闭段腿行为对齐 MMD 源文件（P4）、滑块零 IO 实时（P5）、库动作不越权自动播（P6）、表情不再乱抖（P7）；
- `posTracks.raw` 快照让 rescale 对任意 k（含 0）可逆，滑块往返拖动零漂移；
- 守卫统一走 ADR-230 出口，dispose 竞面收窄到 loadMotionClips 一段（rescale 本身同步，无竞面）。

**负面 / 代价**
- `VrmMotionClipEntry` 膨胀（drivesEyes/origin/path/posTracks），字段须随条目构造点同步——靠现有测试的条目断言兜底；
- P4 开关段表对「作者全程开 IK」的常见 VMD 生成一个恒定 `on` 段，零额外成本；但极端抖动的 ikStates（逐帧开关）会产生长段表——段表按 keyframe 粒度而非逐帧，上限 = propertyKeyFrameCount，可接受；
- P6 的 `origin` 区分要求 `loadMotionClips` 在合并同目录与库 vmd 时打标——库来源路径经 `listCustomAnimVmd` 单独枚举，天然可分。

**已知遗留（二期）**
- `blinkLeft`/`blinkRight` 单眼 wink 映射（待 VRM 侧表情 preset 覆盖度评估后开）；
- `.vrma` 条目的 `drivesEyes` 判定需读其 humanoid 轨道名——若官方 clip 不含眼轨，恒 false，行为与现状一致；
- P4 的「关闭段足回 FK 自然位」在**长关闭段**下与 MMD 表现可能有细微差（MMD 关闭 IK 时足停在上次 FK 位），v1 先按「CCD 跳过」实现，实机校准后再议。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| 锐评对账（ADR-243/306 落地后首轮全链路走查） | P1-P7 病灶清单 |
| `@pixiv/three-vrm-core` `VRMHumanoid.resetNormalizedPose()` / `VRMExpressionManager.resetValues()` / `VRMLookAt.autoUpdate`（d.ts 实证） | D1/D2 官方 API 存在性 |
| `@moeru/three-mmd` `PropertyKeyFrame.ikStates: [string, boolean][]`（dist/index.d.ts 实证） | D4 数据源 |
| three r185 `KeyframeTrack.createInterpolant` 持 `track.values` 引用（src/animation/KeyframeTrack.js 实证） | D5 原地改写可行性 |
| 决策拍板（用户）：P6 白模待机、P5 拖动实时、P7 wink 移除归二期 | D5/D6/D7 方向 |
