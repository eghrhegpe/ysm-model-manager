# frontend/src 架构锐评处置状态（2026-09-03）

> 用户 @long-text「frontend/src 架构锐评」(按等级) 的逐项处置跟踪。
> 锐评原文结论：桌面主链路职责红线守得住，雷集中在 browser parity 层（S2）与 visibleWhen 双轨（S1）。
> 处置铁律：先查证后动手、行为有测试锁定、知识卡同步、commit 白名单纯净。

## 严重（5 项）

| 项 | 条目 | 状态 | 处置 |
|---|---|---|---|
| S1 | dock 可见性走专有布尔（visibleWhen 双轨） | ✅ 闭环 | `1635fcd4` 删三布尔、状态层扩 ui.mode/env.skyGroundCap、dock 与内容级同一 visibleWhen 求值器 |
| S2 | browser-adapter 整层 TS 复刻 Go 扫描/判定 | ⏳ 排期 | web-fs.ts DetectResourceType/ExtractYsmSummary/SearchModels/voxel RPC；parity 靠对账测试硬锁。建议立 ADR：判定规则抽单一源（JSON/生成物驱动），TS 只做 I/O |
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
| G6 | 3D overlay light DOM（全站 Shadow DOM 不一致） | ⏳ 排期 | overlay/菜单外壳迁 shadow root 或 adoptedStyleSheet；影响事件/样式/测试面大，建议单独立项 |

## 风格（4 项）

| 项 | 条目 | 状态 | 处置 |
|---|---|---|---|
| P1 | 137 处 style.cssText 内联样式 | ⏳ 排期 | 集中样式模块（ui-components-styles.ts 范式），机械搬迁面大 |
| P2 | fallback 硬编码中文散布（181 处） | 🟡 评估留档 | 查证：三语 key 集一致（locales-consistency 测试）+ LocaleKey 编译守卫，fallback 仅在动态 key 拼错时触发（设计双保险非缺陷）；触发即三语皆缺，改英文仅换受众，181 处搬迁 ROI 负——不动，语义注释已说明 |
| P3 | legacyTestId 永久背负 e2e 兼容映射 | ⏳ 排期 | 应设淘汰期限 |
| P4 | mock bridge `as AppBindings` 类型断言 | 🟡 评估留档 | 查证：Proxy 壳将破坏 app.test.ts 2 处 toBe(mockApp) 身份断言 + stub 会引爆 E2E mock「缺失方法静默跳过」依赖；现值 P3 已挡空对象、缺失方法调用已抛 TypeError——低价值高扰动，暂缓 |

## 汇总

- 已闭环 10 项：严重 4/5（S1/S3/S4/S5）+ 一般 6/6（G1-G6）——仅剩 S2（严重）排期
- 严重项仅剩 S2（parity 复刻）排期——web-fs.ts 整层 TS 平移 Go，建议立 ADR：判定规则抽单一源（JSON/生成物驱动），TS 只做 I/O
- 待处置：S2 / G6 / P1 / P3（排期）、P2 / P4（评估留档，不铺开）
- 兄弟基线遗留：browser-adapter.contract-b2.test.ts:227,241 缺 desc（HEAD 即红，非本锐评引入），push 需兄弟收口或逃生阀
