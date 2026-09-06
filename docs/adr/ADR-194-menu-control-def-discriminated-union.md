# ADR-194：MenuControlDef 判别联合重构：kind 与配置块编译期配对

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-06
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/caps/scene-capability.ts`、`frontend/src/preview-3d/menu/render.ts`、`frontend/src/preview-3d/menu/cap-controls.ts`、ADR-193（相邻刀，不取代；本 ADR 只动控件形制不动面板通道）

---

## 1. 背景（Context）

caps 层锐评（2026-09-06，三子代理体检）确认：`MenuControlDef`（scene-capability.ts:29-106）是**胖接口而非判别联合**，症状两条，均可机器验证：

1. **kind 与配置块无编译期关联**：`kind: MenuControlKind` 与 `slider?`/`select?`/`button?`/`thumb?` 四个全可选配置块挂在同一 interface 上——`kind:"slider"` 却配 `button` 完全合法，拼错/漏配只在运行时静默表现为「控件渲染成空壳或走默认参数」。`[控件原语归一]`（slider.numeric/onCommit、onChange 收编）持续往胖接口塞字段，症状会随功能演进恶化。
2. **渲染端被迫防御式编程**：render.ts:319 `const kind = node.kind as MenuControlKind`（cast 自证类型已失守）+ :360/:370 `if (kind === "slider" && spec)` 式判空分派——每加一种控件 kind 就要抄一条「判 kind + 判配置块存在」的防御臂，cap-controls.ts:546 的 switch 同病。这是胖接口向全部消费端收的税。

根因：形制定义在「一种控件 = kind 字符串 + 若干可选块」的宽表模型上，而 TS 判别联合恰好就是为这个问题生的——语言能力已备，纯欠一次形制迁移。

## 2. 决策（Decision）

**方向：`MenuControlDef` 从胖 interface 重构为判别联合——kind 字面量与配置块在类型层绑定，错配即编译报错。迁移走「工厂先行、渐进替换」，禁止大爆炸重写。**

1. **目标形制**：`type MenuControlDef = ControlBase & (SliderDef | SelectDef | ButtonDef | ThumbDef | ToggleDef | …)`；公共字段（id/labelKey/fallback/group/visibleWhen/getValue/setValue/onChange/settingsOrder）留在 `ControlBase`，各变体携带自身配置为**必填**字段（`SliderDef.kind:"slider"; slider: {...}`），不存在「有 kind 无配置」的状态。
2. **工厂是迁移的主干道**：2026-09-06 已上提的 `makeSliderDef`/`makeColorDef` 共享工厂（scene-capability.ts）是本重构的半成品——工厂收敛了构造点，此后「改工厂产出即全量迁移」。刀序：① 渲染系 `shc/ppc/rc/lc` 四套前缀工厂与 ground/water/其余 cap 的手写控件字面量**全部收敛进共享工厂**（纯机械，先行）；② 工厂内部改产判别联合形制；③ render.ts / cap-controls.ts 分派臂改 exhaustive switch（`assertNever` 兜底，新增 kind 漏臂编译报错）；④ 全部 16 cap 迁完，删除胖接口旧形制。
3. **过渡期双形制并存有界**：旧胖接口保留为「宽容读入」形态（render 端），新联合为「严格产出」形态（cap 端），桥接层一处 cast 并注释退役条件；过渡期时长以刀序 ①→④ 自然推进为准，不设独立排期（ADR 不记进度）。
4. **visibleWhen 铁律不动**：`visibleWhen` 在 `ControlBase` 上，B 轨「全仓唯一条件显隐入口」语义原样保留；本重构只动 kind↔配置块配对，不触碰显隐机制与 ADR-125 状态层协议。

**拒绝的替代方案**：保留胖接口、加运行时校验（defect 仍在，只是从静默变告警，税照收）；一次性改 19 个引用文件的大爆炸（caps + menu 双域 8 个测试文件存量，回归面不对称）；推倒重设计控件协议（ADR-125/126 刚收口，推倒违背长治久安）。

## 3. 后果（Consequences）

**正面**：kind↔配置块错配从运行时静默失效变编译期报错；渲染端防御判空退役，分派臂 exhaustive（新增控件 kind 编译器逼着补全）；新 cap 控件定义只有「调工厂」一条路，与 ADR-193 的「新面板只有导出 schema + 注册一行」同构，选择成本归零。

**负面 / 代价**：触面 19 个文件（含 8 个测试），迁移期间存在新旧双形制读入噪音（有界，见 §2.3）；thumb/button 变体字段多（action/disabled/getHint 等），拆变体时要逐字段核对不丢行为。

**已知遗留**：`PreviewMenuNode`（node-types.ts）是另一套独立 kind 模型（folder/panel/divider…），本 ADR 不动——它归 ADR-193 的节点协议射程；两套 kind 在 render.ts:319 的 cast 桥接处交汇，该 cast 的退役条件即本 ADR ④ 刀的完成标志。

## 4. 数据溯源

- caps 层锐评 2026-09-06（架构核心子代理 P3）→ 本 ADR 立项（胖接口判定 + 「需 ADR」结论）
- `frontend/src/preview-3d/caps/scene-capability.ts:29-106` MenuControlDef 胖接口 + `[控件原语归一]` 注释链 → §1 症状 1
- `frontend/src/preview-3d/menu/render.ts:319,360,370` kind cast + 防御判空分派；`frontend/src/preview-3d/menu/cap-controls.ts:546` switch 分派 → §1 症状 2
- `makeSliderDef`/`makeColorDef` 共享工厂（scene-capability.ts，2026-09-06 上提，commit 74cc9ad9）→ §2.2 工厂主干道判定
- ADR-193 §2 分刀递进 / 拒绝大爆炸的论证范式 → §2 刀序与拒绝方案沿用其框架

<!-- 文件名: menu-control-def-discriminated-union.md → 实际文件 ADR-194-menu-control-def-discriminated-union.md -->
