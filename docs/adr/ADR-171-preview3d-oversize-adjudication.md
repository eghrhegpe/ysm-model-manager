# ADR-171：preview3d 超大文件裁决式复核：FBXLoader 官方化 / 巨型单体维持

- **状态**：✅ 已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-03
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`mount-preview-core.ts, wasm-decode.ts, caps/, vendor/fbx/FBXLoader.ts`

---

## 1. 背景（Context）

《preview-3d 模块锐评报告》点名 4 处超大文件并建议拆分：caps 巨型文件
（sky 948 / light 968 / environment 907 / postprocessing 896 / water 768，P1）、
wasm-decode 846 行「嵌套 catch 大杂烩」（P1）、mount-preview-core 983 行
「拆完仍巨型」（P2）、vendor FBXLoader 4582 行无同步声明（P2）。

本 ADR 对 4 项逐一做**裁决式复核**（沿真缝查结构、不按行数定拆否），
继承两先例准则：ADR-167（mmd 沿 stage 缝纯搬移拆 9 文件）与知识卡
`3d-oversize-file-codesplit-feasibility` / `mount3d-584-giant` 2026-09-03 复核
（mount-preview-core / ground 判「维持不拆」——**行数不是依据，先查缝**）。

## 2. 决策（Decision）

### 2.1 FBXLoader：vendor 出仓，worker 改官方导入（✅ 采纳，唯一高 ROI 真缝）

溯源实证：vendor/fbx/FBXLoader.ts 首引 commit `4e797730`（ADR-138 上提），
three `^0.185.1` 官方源码副本，**零本地改动**（仅 `// @ts-nocheck` + three 自带
TODO）。**主线程 fbx-adapter.ts:12 已用官方 `three/addons/loaders/FBXLoader.js`**，
仅 fbx-parser.worker.ts:12 仍 import vendor 副本。

→ 删 `frontend/src/preview-3d/vendor/fbx/` 整目录，worker import 改官方子路径。
4582 行第三方代码出仓，由 node_modules 版本管理接管（vendor 与 addons 同源
0.185.1，行为零漂移）。**实施首步 = 小实验验证**：worker import three/addons
在 vite worker 构建 + vitest 下解析正常、纹理捕获 handler 与官方
FBXLoader.loadTexture 的 getHandler 契约仍匹配、真 FBX 冒烟通过，才提交。

### 2.2 mount-preview-core / mount3D：维持不拆（❌ 驳回拆分诉求，复核证据固化）

983 行、mount3D 本体 L285-936 ≈ 652 行——但实体逻辑**已全部外置**为模块级
函数/文件（shared-infra / wasd-camera / unified-pick / unload-model /
input-and-animation / switch-preview / safe-dispose），剩余是**闭包接线编排器**：
6 内嵌闭包（finishSession/closeOverlay/fullCleanup/unloadSessionModel/escH/
animate）+ session/switchCtx/camBridge 胶水，段落共享 15+ 闭包变量，**无 stage
缝**——强行外移 = 15-20 参数 ctx 参数化，行数不降、类型面暴增。与 mmd-adapter
（拆前 stage 已顶层化）不可类比。知识卡 `mount3d-584-giant` 2026-09-03 复核
同判。残余候选仅 P3 ROI 低：fullCleanup(827-890) 拆 `mpFullCleanup(ctx)`、
animate 闭包拆 `mpStartRafLoop`。

### 2.3 wasm-decode：维持单文件（❌ 「嵌套 catch 大杂烩」定性不成立）

846 行实测：**13 处 catch 全部函数级**（每 mdWs* 函数 1 个 try/catch 处理自身
失败），无 catch-in-catch 深链；入口 decodeYsmViaWasm → doDecodeYsmViaWasm
（L798-846，≤70 行主分派 + LRU 缓存守卫）三路分支语义清晰且各有注释：
读文件失败不缓存可重试 / json 分派失败缓存 `_wasmFailed` / wasm 解码失败
返回 null。文件已按 mdWs* 前缀 + 分区注释 + ctx 参数传递结构化（6 interface
聚集文件头、25 顶层函数）。真问题是**单文件 846 行偏长（观感债）非结构债**。
跨文件拆分 ROI 为负：单一导出入口依赖 24/25 函数，types 外提 + 互 import 只
分散行数不降复杂度。

### 2.4 caps 900+ 四文件：维持单文件（❌ 拆分诉求驳回；记段级外提 P3 候选）

caps/ 为能力单元制（29 文件，SceneCapability 一 cap 一文件）。sky/light 实测
内部已分区：params/presets 声明段（light L36-117）+ menu 构建函数段
（lc*×4 L233-346 / skc*×6 sky L206-300，函数级独立）+ class 主体
（light L368-932 ≈ 565 行）+ 尾部纯工具。**可段级外提的是 menu/params 段**
（纯搬移零逻辑改动，对齐 ADR-167），但外提仅减 ~15-20% 行数；体积主体在
class 方法——共享 this 状态，文件级拆分需 mixin/组合大改，**无 stage 缝**。
裁决：维持单文件；「menu 构建段外提 `*-capability.menu.ts`」记 P3 候选，
优先做增量防线（新逻辑先进独立函数，防继续膨胀）。

## 3. 后果（Consequences）

- **正面**：FBXLoader 4582 行 vendor 出仓（若实验通过）；3 项巨型单体复核结论
  固化进 ADR，后续评审不再重复消耗审计轮次（本次锐评 4 条拆分诉求中 3 条撞
  既有复核结论）。
- **负面**：mount3D ~650 行 / caps 900+ / wasm-decode 846 行单文件状态维持，
  观感债仍在；新逻辑须自律（先进独立函数）防膨胀。
- **已知遗留**：fullCleanup / animate 外拆、caps menu 段外提、wasm-decode 段内
  深函数（mdWsHandleYsmJsonSpec 178-270 若有可再整理的嵌套）均 P3。

## 4. 数据溯源

| 项目 | 来源 → 结果 |
|------|-------------|
| FBXLoader 零本地改动 | `git log --follow` 首引 4e797730 → 文件头仅 @ts-nocheck + three 自带 TODO；三处 three 源码 TODO |
| 主线程已官方化 | grep frontend/src → fbx-adapter.ts:12 `three/addons/loaders/FBXLoader.js`；仅 worker fbx-parser.worker.ts:12 用 vendor |
| mount3D 无 stage 缝 | 知识卡 mount3d-584-giant（2026-09-03 复核）：实体逻辑全外置、6 闭包 + 15+ 共享变量 |
| wasm-decode catch 分布 | grep catch → 13 处全函数级、无嵌套深链；L798-846 入口三路分支有注释 |
| caps 段结构 | grep export/function → light：params L36-117 / lc* menu L233-346 / class L368-932；sky：skc* L206-300 同构 |
| wasm-decode 函数级结构化 | grep 顶层 → 6 interface + 25 mdWs* 顶层函数 + ctx 参数传递（MdWsInflightCtx/MdWsProcessModelCtx） |

<!-- 文件名: preview3d-oversize-adjudication.md → 实际文件 ADR-171-preview3d-oversize-adjudication.md -->
