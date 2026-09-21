# ADR-293：灯光能力总开关 schema 化、helper 可见性控件化与面板响应

- **状态**：✅ 已采纳（Implemented；含复核 P0 修订，见 D3 重入安全前提）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-22
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/caps/light-capability.ts` / `light-controls.ts` / `light-persist.ts` / `state/env-state-schema.ts` / `menu/panels/settings.ts` / `screenshot/screenshot-lights.ts`；前例 ADR-250（ppEnabled）、ADR-196（fogEnabled 单一 gate）、ADR-290（渲染输入 schema 化）

---

## 1. 背景（Context）

灯光菜单「锐评」定位到三处参数对接的结构性裂缝：

1. **能力总开关双轨**。`LightCapability.enabled` 是 cap 私有布尔字段——不入 envState、不受 source 优先级/钳制/派发纪律管辖；而兄弟 cap 早已收口：`ppEnabled`（ADR-250 明言「唯一真值源 = envState.ppEnabled」）、`fogEnabled`（ADR-196 同款手术，注释原话「旧私有 enabled 恒 true 造成 master toggle 显示 ON 而 scene.fog 恒 null 的脱节」）。light-controls 注释宣称「与 shadow/pp 同构」，实际 pp/fog 已入 schema、light/shadow 骑墙——同组三个面板三种口径。
2. **helper 是渲染输出里的不可见维度**。三盏灯的 `DirectionalLightHelper/SpotLightHelper/PointLightHelper` 无条件挂场景、恒随 enabled 显隐——无 schema 键、无控件、无持久化。这正是 ADR-290 给锥体驱动源（activeLight 焦点态）清偿的同款债：渲染输入未显式化，用户无法关掉污染视口的线框。附带发现：`rebuildConeIfNeeded` 不检查总开关——总开关关闭时翻体积光开关，会挂出一只没有光源的悬浮光锥；`toScreenshotLights` 也不看总开关——预览全黑而截图灯火通明。
3. **面板不响应 cap 侧离散变更**。env 面板有 `rebuildEnvSubs`（cap.subscribe → menu.refresh()）活刷新链；light cap 连 `subscribe` 都没有（fog/ground/water 三先例均有），场景组面板只能靠 `refreshOnChange` 自摸——外部程序化写灯（跨会话共享 cap、未来联动）时面板值与场景静默脱节。

## 2. 决策（Decision）

**D1 `lightEnabled` 入 schema，cap 删私有 enabled**。新增 `lightEnabled`（boolean, default true, group "light"）。`setEnabled → setEnvState`，副作用（mount/detach）经 `onEnvChanged` 分派；构造入参 `opts.enabled` 对齐 ADR-250 口径（显式给定时才写状态层）。持久化顶层 `enabled` 键格式不变（旧存档零迁移）。

**D2 `lightHelperVisible` 入 schema + 控件化**。新增 `lightHelperVisible`（boolean, default **true**——保持现状观感，纯增撤销能力）。灯光面板 `light-select` 下方加 `light-helper` toggle。helper 显隐公式统一：`灯.enabled && lightHelperVisible`（总开关关闭走 detach 整串移除，不入公式）。**同刀补两处总开关门**：`rebuildConeIfNeeded` 在总开关 off 时不挂锥；`toScreenshotLights` 在总开关 off 时输出三灯 enabled=false + ambient 0（截图与预览同黑）。

**D3 light cap 补 `subscribe` + 离散键 notify，场景面板接 `menu.refresh()`**。对齐 fog 契约：仅离散键（总开关/各槽 type/enabled/体积光 enabled/driver/helper）变更触发 notify，**连续滑块（intensity/azimuth/…）恒不 notify**——拖动中途重建面板会掐断指针捕获。`buildLightingSchema` 接受 menu 句柄，按 env.ts 的 per-menu WeakMap 样板重绑订阅；`dispose` 时经 `disposeSceneCapSubscriptions` 退订。

**D3 修订（复核 P0，2026-09-22）**：env 样板照搬进灯光面板即死循环——notify 处于 setEnvState 同步派发栈内，订阅者 `menu.refresh()` 同步重入 schema 渲染再跑重绑；`createListenerSet.notify` 是活 Set 迭代，「退订旧+订阅新」产生的新监听器被同一轮 notify 触达 → refresh → 重绑 → 无穷自激（探针实测一次 notify 501 次重建，页面冻结；607 用例全绿因该路径零覆盖）。env 先例不死只因结构性巧合：其重绑点（环境一级）与 notify 触发控件（二级子视图）永不同帧。裁定**双保险立法**：① `createListenerSet.notify` 改快照迭代（原语级根治，DOM EventTarget 同语义，惠及全部六消费者）；② `rebindSceneCapSubs` 幂等——同 (menu, cap) 只绑一次，重复渲染零 churn。回归测试锁死闭环（listener-set 两条重入用例 + preview-state「面板重入收敛」带熔断探针）。

**不动的**：shadow 总开关（同病，另刀）；`activeLight` 焦点态（UI-only 是 ADR-290 裁定后的既成语义）；氛围预设的手抄字面量（参数值表，非结构对接问题）。

## 3. 后果（Consequences）

- **正面**：灯组写路径全部过 `setEnvState` 四件套（钳制/优先级/派发/中间件）；「参数面 ≡ 控件面」运行时探测闸自动覆盖两个新键（总开关从此有 schema 写面证据）；截图/锥体/helper 三处「总开关旁观」补门。
- **负面**：`lightEnabled` 属 group "light"，`getPresetKeys("light")` 键集 +2——任何按组扫描消费 light 键集的下标协议须容忍布尔总开关键（已 grep：灯光域无此类下标协议；MODEL_DEFAULTS 防回退闸本就禁止 light 键）。
- **已知遗留**：shadow-enabled 仍是私有态；helper 无槽位级粒度（一盏总开关管三副线框，够用为止）；氛围预设写灯值不 notify（预设切换发生在环境面板，灯光面板打开即重建取新值，单栈菜单无同屏脱节窗口）。

## 4. 数据溯源

`ENV_STATE_SCHEMA.lightEnabled / lightHelperVisible`（声明）→ `setEnvState` 唯一写入口（钳制+派发）→ `LightCapability.onEnvChanged`（Three 应用 + 离散 notify）→ `light-controls.ts` toggle 节点（控件面）→ `light-persist.ts`（顶层 `enabled`/`helperVisible` 键，typeof 校验恢复）→ `screenshot-lights.ts`（WYSIWYG 同门）。
