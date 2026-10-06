---
kind: redline-enforcement-grade
name: 唯一入口红线执法等级表（37 条审计）
tier: architecture
category: core
status: active
source_files:
  - frontend/src/preview-3d/menu/engine/core.ts
  - scripts/check-redlines.ts
  - frontend/src/preview-3d/menu/schema/menu-node-types.ts
  - frontend/src/views/app-content/settings/stg-card.ts
  - frontend/src/utils/resource/schema.ts
invariant_anchors:
  - scripts/check-redlines.ts|W6
  - scripts/check-redlines.ts|W9
  - scripts/check-redlines.ts|R7
  - scripts/check-redlines.ts|R11
  - frontend/src/preview-3d/menu/schema/menu-node-types.ts|visibleWhen
affected: false
---

# 唯一入口红线执法等级表（37 条审计）

> 审计方法（ADR-162 精神）：只看**当前源码树** + `check-redlines` 机器闸，不采信 ADR 背景或文档注释当现状。37 条取自 `routes-quick.md` 里物种为「唯一入口类」的红线（"必须走 Y，禁止 X"）。
> 配套说明见 `routes-quick.md` 顶部物种分流注。

## 等级定义

- **A** = 类型/编译期唯一入口——第二条路结构性不可能（如删除旧字段、schema 强制、单一事实源类型）。
- **B** = 机器闸——CI/运行期 fail-fast 拒绝第二条路（`check-redlines` blocking 规则、源码扫描闸、registry 强制注册、id 冲突抛错）。
- **C** = 单一入口设计存在，但只靠约定/测试约束，无编译期或 CI 兜底——裸奔面。
- **D** = 连单一入口都未收敛，纯自然语言"禁止"——高危靶子。

## 关键闸事实（决定 B 级含金量）

`check-redlines` 的 12 条规则（R1–R11 / W1–W9）中，映射本批红线的只有 **W6（bypass dialogs）/ W9（settings 卡片唯一造法）/ R7（资源类型魔法串）/ R11（资源类型清单单一同步源）**。其中 W6/W9/R7/R11 均**不在 WARN 集**（`const WARN_RULES = new Set(["R2","R5","R7","R4","W1"])` 实际含 R7，但 W6/W9 不在），属 pre-push 阻断规则。但 `check-redlines` **只在本地 pre-push 跑，CI `--static` 不跑 redlines**，可被 `git push --no-verify` 绕过——这是 B 级普遍存在的"闸可被绕过"盲区，需后续把 redlines 接入 CI。

## 逐条审计结果（37 条）

等级 | 行号 | 唯一入口 Y | Y 真实存在 | 证据(file|symbol) | 判定理由
---|---|---|---|---|---
A | 992 | 3D 菜单 visibleWhen | 是 | `frontend/src/preview-3d/menu/schema/menu-node-types.ts`\|visibleWhen | 旧 `visible` 闭包已整体删除（2026-09），写旧字段即 TS 编译错，编译期唯一入口
B | 20 | setAdapterItems 注入根菜单 | 是 | `frontend/src/preview-3d/menu/engine/core.ts`\|:685-696 重复 id 冲突即 throw | 运行期 fail-fast 守门，内联第二项被 id 冲突打断
B | 23 | 同 #20 | 是 | `mount-preview-core.ts`\|setAdapterItems | 与 #20 同一机器闸，重复注入即抛错
B | 148 | modal-core/createDialog | 是 | `scripts/check-redlines.ts`\|W6 | 弹窗收敛于 modal-core，W6 阻断 dialogs/ 外手写 dlg-overlay
B | 152 | 同 #148 | 是 | `scripts/check-redlines.ts`\|W6 | 高级筛选复用 modal-core，W6 守住手写 dlg-overlay
B | 430 | stgCard() | 是 | `scripts/check-redlines.ts`\|W9 | W9 在 pre-push 基线拦截 settings 域手写 stg-card 字面量
B | 438 | schema.ts allResourceTypes | 是 | `scripts/check-redlines.ts`\|R7+R11 | R11 封杀 RPC 旁路、R7 封杀手写类型映射，双机器闸
B | 608 | 同 #430 | 是 | `scripts/check-redlines.ts`\|W9 | 与 #430 同一条 W9（routes-quick 重复条目）
C | 15 | model2d.ts renderModel2D | 是 | `frontend/src/views/app-preview/model2d/model2d.ts`\|:54 | 入口收敛，无 CI/编译闸，靠约定
C | 17 | perception createXxxController | 是 | `frontend/src/preview-3d/adapters/shared/perception/core.ts`\|:31 | 控制器单点收敛，无机器闸防第二路
C | 18 | go/threejs spec.go BuildMulti | 是 | `go/threejs/spec.go` | spec 转换单点，无闸禁止第二套转换
C | 29 | envState/setEnvState | 是 | `frontend/src/preview-3d/state/env-state.ts`\|:14 | 状态层收敛，无闸防 this.params 私有化复活
C | 32 | DecodeYSM 注入点 | 是 | `go/ysm/decode_inject.go`\|:32 | 注入点唯一，无机器闸禁止新建 Node 桥
C | 38 | mount3D 会话外壳 | 是 | `frontend/src/preview-3d/adapters/mount-preview-core.ts`\|:369 | 会话外壳收敛，截图走独立离屏 renderer 例外，无闸
C | 40 | light-cone.ts VolumetricCone | 是 | `frontend/src/preview-3d/caps/light-cone.ts`\|:142 | 光锥单点且被复用，无机器闸防外挂第二套
C | 60 | ground-menu.ts buildGroundNodes | 是 | `frontend/src/preview-3d/caps/ground-menu.ts`\|:364 | 菜单直产单点，无闸防手写控件结构
C | 68 | go/avatar ExtractAvatarURI | 是 | `go/avatar/avatar_extract.go`\|:22 | Go 提取单点，前端仍做路径拼接，无闸
C | 88 | matchTypeByExt 注册表 | 是 | `frontend/src/utils/resource/types.ts`\|:267 | 注册表驱动入口存在，R7 只扫魔法串不扫内联正则
C | 108 | ik-solver solveIK | 是 | `frontend/src/preview-3d/adapters/shared/ik-solver.ts`\|:105 | CCD 求解器已收敛，无编译期/CI 闸
C | 133 | wasm/ysm-parser decodeYsmFile | 是 | `frontend/src/wasm/ysm-parser.ts`\|:169 | 全量解码收敛于 WASM，存在已授权手写头部解析，无闸
C | 179 | slide-menu createSlideMenu | 是 | `frontend/src/preview-3d/menu/shell/slide-menu.ts`\|:83 | 外壳唯一构造点，无机器闸
C | 181 | toast-ms TOAST_MS | 是 | `frontend/src/utils/dom/toast-ms.ts` | 收敛于常量/函数，无 check-redlines 强制
C | 204 | btnBaseCSS | 是 | `frontend/src/utils/dom/css.ts`\|:1 | 按钮样式收敛，无机器闸强制"必须走"
C | 216 | array moveItemMut | 是(名微差) | `frontend/src/utils/base/pure/array.ts`\|:8 | 移动工具存在但红线名不符，41 处 splice 无闸区分用途
C | 219 | icon.ts fileIcon | 是 | `frontend/src/utils/icon/icon.ts`\|:31 | 图标映射收敛，无机器闸扫描手写映射
C | 222 | format.ts formatBytes/fmtDate | 是 | `frontend/src/utils/format/format.ts`\|:13 | 格式化收敛，无闸强制
C | 223 | display.ts renderDisplayName | 是 | `frontend/src/utils/model-name/display.ts`\|:129 | 文件名展示收敛，R8 仅白名单豁免非排他强制
C | 250 | mc-format.ts renderFormattedText | 是 | `frontend/src/utils/html/mc-format.ts`\|:45 | § 颜色解析收敛，R8 仅白名单豁免非排他强制
C | 288 | go/container Open | 是 | `go/container/container.go`\|:154 | 桌面走 Go，web 模式保留 fflate 平移副本，无 check-redlines 闸
C | 298 | go/packs classify.go ClassifyResource | 是 | `go/packs/classify.go`\|:44 | 桌面调 Go，web 有内容指纹平移副本，无机器闸
C | 303 | go/packs mcmeta.go ReadPackMeta | 是 | `go/packs/mcmeta.go`\|:34 | web 模式存在文档化 TS 平移副本（pack-meta.ts），"前端禁止手写"前提失真
C | 321 | go/ysm parse.go AnalyzeYSMModel | 是 | `go/ysm/parse.go`\|:45 | 桌面走 Go、web 走 WASM，parity 测试非 fail-fast 闸
C | 341 | go/paths IsInside | 是 | `go/paths/safe.go`\|:51 | 路径安全收敛 Go，web 交浏览器沙箱，无 CI 扫描闸
C | 429 | go/updater CheckUpdate | 是 | `go/updater/updater.go` | 前端只编排 UI、下载归 Go，设计收敛无机器闸
C | 476 | tpl-summary.ts summaryCardHTML | 是(引用文件错) | `frontend/src/views/app-preview/tpl-summary.ts`\|:153 | 真实入口非红线所述 summarize.ts（glob 零命中）；无机器闸
D | 87 | render-federation（仅文档） | 否 | 仅 `docs/knowledge/render-federation.md` | 命名入口不存在，等价收敛靠约定，高危
D | 184 | ui-components（无收口） | 否 | `glob frontend/src/**/ui-components*.ts` 零命中 | "复用 helper"无单一收敛点，纯自然语言约束、高危

## 汇总

- **A 级 1 条**（992）：治本，编译期封死。
- **B 级 8 条**（20/23/148/152/430/438/608 + 同义重复）：有机器闸，但 redlines 未进 CI、可被 `--no-verify` 绕过。
- **C 级 26 条**：单一入口存在，仅约定/测试约束，无机器兜底——裸奔面主体。其中 **#476 红线引用文件已失效**（summarize.ts 不存在，应为 tpl-summary.ts），属文档漂移，需修正 `routes-quick.md` 该行文。
- **D 级 2 条**（87/184）：连单一入口都未收敛——最高危靶子。

## 升级路线图（本卡只列清单，不在此升级；按你选"先列清单不升级"）

1. **优先消除 D 级**：#87 落地为真实收敛模块（render-federation 当前仅为概念，等价收敛散落 mount3D/shared-infra/render-loop）；#184 补出具体 helper 收口文件。
2. **C 级 → B 级**：把 #29/#38/#40/#60/#68/#88/#133/#288/#298/#303/#321 等无闸条目，逐条套 stg-card W9 范式——加 `check-redlines` 扫描闸（如"前端禁止手写 X"对应路径/符号正则，命中即阻断）。注意 web 模式平移副本（#288/#298/#303/#321）应走"基线路径豁免"而非纯禁止。
3. **B 级 → 进 CI**：把 `check-redlines` 接入 CI `--static` 或独立 CI job，消除"本地闸、可绕过"盲区。
4. **文档漂移修复**：#476 红线文本 `summarize.ts` → `tpl-summary.ts`；#216 红线 `moveItem` → `moveItemMut`。

## 相关

- `routes-quick.md`（索引，顶部物种分流注 + 列改名"主 ADR(如有)"）
- `scripts/check-redlines.ts`（W6/W9/R7/R11 规则）
- `scripts/gen-routes-quick.ts`（列头/说明生成源）
