# frontend/src 架构锐评处置状态（2026-09-03）

> 用户 @long-text「frontend/src 架构锐评」(按等级) 的逐项处置跟踪。
> 锐评原文结论：桌面主链路职责红线守得住，雷集中在 browser parity 层（S2）与 visibleWhen 双轨（S1）。
> 处置铁律：先查证后动手、行为有测试锁定、知识卡同步、commit 白名单纯净。

## 严重（5 项）

| 项 | 条目 | 状态 | 处置 |
|---|---|---|---|
| S1 | dock 可见性走专有布尔（visibleWhen 双轨） | ✅ 闭环 | `1635fcd4` 删三布尔、状态层扩 ui.mode/env.skyGroundCap、dock 与内容级同一 visibleWhen 求值器 |
| S2 | browser-adapter 整层 TS 复刻 Go 扫描/判定 | ⏳ 排期(ADR 已立) | `ADR-174` 已立：类型归属单一源**查证已成立**（Go registry=内嵌 resource_types.json / TS 直读，双端零手写）；真双实现区=格式平移层，以共享 fixtures 对账硬锁（D2）+ 差异分类声明制（D3）+ contract-b1 唯一哨兵（D4）。首轮四函数漂移审计见 ADR 附录 A：SearchModels kw 降级语义/排序未锁为契约、DetectContainerType 上限联动、ExtractYsmSummary Size 口径、voxel TS↔Go 缺 fixture——收口定义=D5 全落地；`0406fbf4` 已锁 B1c（kw 快路径降级语义 = web 契约，Go 差异显式声明）+ web-fs.ts D3/附录 A 三处注释（降级不排除不排序 / 容器探测上限联动）；剩 fixtures 基建（双端语料 + 镜像对账测试，须 go/ 并行静默后动） |
| S3 | 树搜索/排序/筛选在前端本地做 | ✅ 闭环 | 查证：SearchModels 是磁盘级数值范围搜索（adv-filter 消费），树内 search/排序作用在 Go 已交付内存 entries 属 UI 交互——下沉 RPC 不成立；AGENTS.md:22 红线加豁免注脚（输入端归 Go / 展示端豁免）+ render.ts 代码锚点 |
| S4 | preview-3d 反向 import views（层级倒置） | ✅ 闭环 | `edceb408` 6 纯类型迁 content-bridges.ts，preview-3d → views import 清零 |
| S5 | dock 渲染硬编码组专属捷径 | ✅ 闭环 | `f70bbf3f` PreviewMenuGroupDef.directToPanel 静态声明，renderPreviewDock 删 if (g.id==="model")，motion 动态特例显式标注 |

## 一般（6 项）

| 项 | 条目 | 状态 | 处置 |
|---|---|---|---|
| G1 | show 侧手写扩展名分支 | ✅ 闭环 | `870a0c13` EntityPlayer:vrm 复合 key 条目 + statsCardHTML extOf + litematic isContainerExt（顺带修 .7z 蓝图缺陷） |
| G2 | Go 扫描结果二次前端过滤 | ✅ 闭环 | `e264e7ac` previewCandidateExtsOf JSON 派生；查证修正：Go 全 ext 白名单=类型归属语义（下沉破坏），收窄是预览候选语义，正确修法是 JSON 派生非改 Go |
| G3 | 3D 菜单手写 fill* 飞地 | ✅ 闭环 | `bf1459a4` fill* 三函数删除（生产零调用）+ `72573102` renderCustom 构造点审计门（3 豁免白名单锁死） |
| G4 | 渲染链路多通道衰退 | ✅ 闭环 | `383d7c1f` G3 后 fillers 仅 roles 独苗，四路互斥分派注释收敛 + health.test fillers roles-only 白名单守卫 |
| G5 | community 回收站过滤前端复刻 Go | ✅ 闭环 | `39114d99` utils/recycle-path.ts hasRecycleSegment 单一实现（双复刻删并）；口径修正：真对齐对象是 sync.hasRecycleSegment 非 IsRecycleDir |
| G6 | 3D overlay light DOM（全站 Shadow DOM 不一致） | ⏳ 排期(勘察完) | 勘察报告 `frontend-src-critique-g6p1-survey.md`：overlay 链 28 类 token 样式全部集中于 2 个可 adoptedStyleSheets 模块 + render.ts 链内注入块 + 5 无规则语义锚点（内联样式随节点进 shadow 自动生效）——**样式层障碍已排除**；真实障碍收敛为测试选择器（app-tree:296 getElementById / scope() 优先 shadowRoot / e2e 穿透）与样式注入目标迁移。可独立立项 |

## 风格（4 项）

| 项 | 条目 | 状态 | 处置 |
|---|---|---|---|
| P1 | 137 处 style.cssText 内联样式 | 🚧 迁移中 | 勘察报告 `frontend-src-critique-g6p1-survey.md`：实测 139 处中**静态 134（96.4%）、动态仅 5**（cap-controls×3/vrm-bone-ui/skeleton-fill-panel，滑块类插值豁免）——先前"大量动态不可静态化"推断被数据推翻；**范式有链内实证**（render.ts:20 已实践 cssText→类 + `<style>` 注入）。**首批 render.ts 15/16 闭环**（`8d6a2a8b`，2026-09-04）：13 新类（rm-control-row/rm-control-row-lg + 4 label 变体 + toggle/range/num/eye/op 控件类）扩入 ensureMenuStyles 样式块，**双类锚定**（.slide-item/.slide-label 在前）压过 ui 单类规则防注入顺序依赖；body display 折叠态动态豁免留内联（node-render 断言 style.display 切换）加注释。剩 124 处：cap-controls 35/roles 18/env 14/switch 7/core 5…，按文件批次续迁 |
| P2 | fallback 硬编码中文散布（181 处） | 🟡 评估留档 | 查证：三语 key 集一致（locales-consistency 测试）+ LocaleKey 编译守卫，fallback 仅在动态 key 拼错时触发（设计双保险非缺陷）；触发即三语皆缺，改英文仅换受众，181 处搬迁 ROI 负——不动，语义注释已说明 |
| P3 | legacyTestId 永久背负 e2e 兼容映射 | ✅ 设限 | `node-types.ts:148` 定义处标 @deprecated + 淘汰期限 2027-06-30 + 迁移条件（e2e 改选节点 id/panelTestId 派生选择器）+ 过渡期禁新增；届期删字段并移除 core.ts:111,228 / roles.ts:89 映射输出 |
| P4 | mock bridge `as AppBindings` 类型断言 | 🟡 评估留档 | 查证：Proxy 壳将破坏 app.test.ts 2 处 toBe(mockApp) 身份断言 + stub 会引爆 E2E mock「缺失方法静默跳过」依赖；现值 P3 已挡空对象、缺失方法调用已抛 TypeError——低价值高扰动，暂缓 |

## 汇总

- 已闭环 9 项：严重 4/5（S1/S3/S4/S5）+ 一般 5/6（G1-G5）+ 风格 P3 设限——剩 S2（严重）/ G6（一般）/ P1（风格）排期
- 严重项 S2：ADR-174 已立（判定规则单一源查证成立 + 对账硬锁策略 + 首轮四函数漂移审计），剩对账 fixtures 基建排期（收口定义见 ADR D5）
- 待处置：S2 fixtures 基建（B1c 已锁降级语义，ADR-174 D5 剩双端语料+镜像测试）/ G6（可立项）/ P1（迁移中：render.ts 首批已闭环，剩 124 处按批次续）、P2 / P4（评估留档，不铺开）；P3 仅剩「届期清退」动作挂在 2027-06-30
- 状态卡纠错（2026-09-03）：此前汇总误计「一般 6/6 / 共 10 项闭环」——G6（overlay light DOM）实为 ⏳ 排期且 git 无闭环提交，此处修正为 一般 5/6 + 共 9 项闭环
- 兄弟基线遗留：browser-adapter.contract-b2.test.ts:227,241 缺 desc（HEAD 即红，非本锐评引入），push 需兄弟收口或逃生阀
