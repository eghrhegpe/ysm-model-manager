# ADR-174：browser parity 判定规则单一源 + 对账硬锁策略（锐评 S2 处置框架）

- **状态**：✅ 已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-03
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/backend/web-fs.ts, web-fs-container.ts, web-fs-read.ts, web-stats.ts`、`browser-adapter.contract-b1.test.ts`、`resource_types.json`、`go/types/resource.go`、`go/packs/classify.go`、`internal/app/app_scan.go / app_install_import.go`、`go/ysm/summary.go`、`frontend/src/parsers/ysm-header.ts, voxel-parse.ts`、ADR-066/070/071/144/159、锐评处置卡 S2 行

---

## 1. 背景（Context）

锐评 S2：browser parity 层（web-fs.ts 850 行 + container/read/stats 卫星文件 + parsers）以 TS
平移 Go 的 scan/detect/search/voxel，**双实现漂移风险**——桌面 Go 与网页 TS 各自演进即分叉。
处置卡建议：「判定规则抽单一源（JSON/生成物驱动），TS 只做 I/O；parity 靠对账测试硬锁」。

2026-09-03 首轮查证（先查证后决策，逐函数读双端实现）：

1. **类型归属判定已是单一源**。Go 侧 `go/types/resource.go:13`：registry 为**编译期内嵌的
   resource_types.json**（注明"单一事实来源"，曾因不同步导致分类回退弹平）；TS 侧
   `resolveTypeSafe / getExts / previewCandidateExtsOf`（G2 `e264e7ac`）同读 resource_types.json。
   两端判定规则都不手写扩展名表（`go/types/extensions.go:2` 声明同源；前端手写正则已清）。
   → S2 主张的"判定规则抽单一源"对**类型归属层已成立**，无需新造机制。
2. **真正的双实现区 = 格式平移层**：容器内容指纹（DetectContainerType）、YSM 摘要
   （ExtractYsmSummary）、voxel 三视图、pack/shader meta。TS 以「对齐 X」注释 1:1 镜像 Go
   （如 ysm-header.ts MAX_HEADER_LINES=200 对齐 header.go、clampTexDim 对齐 texsize.go），
   行为靠注释 + 散点单测维持，**缺 fixture 级双端对账**。
3. **既有锁定**：contract-b1「代码侦探」以 Go 真实实现为契约反推 TS 偏差，已锁
   SearchModels 关键词 trim/大小写、GetSubDirMap JSON 派生、tags 簇、双环日志等。
4. **存在有意差异（web 降级/上限）**，见附录 A 审计表——部分已在 binding 注释声明 +
   UI 降级提示（consumeWebSearchDegraded），但**未被 contract 测试显式锁为契约**，存在
   「未来被当 bug 误改」或「被当正确语义误认」的双向风险。

## 2. 决策（Decision）

### D1 类型归属：单一源铁律（现状固化为规则）
凡类型归属/扩展名/子目录/预览候选判定，一律走 resource_types.json（Go 编译期内嵌 / TS 直读），
双端零手写判定表。新增 rtype/扩展 = 只改 JSON；改动后 Go/TS 同契约测试守门。
不新增任何 Go 侧手写 ext 表、不新增任何前端手写 ext 分支。

### D2 格式平移层：承认平移必要，以 fixture 对账硬锁
浏览器无 Go，格式知识（zip 指纹 / ysm.json 摘要 / 块状态解码）的 TS 平移是必要实现，**不追求
二次单一源**（把格式知识抽共享 WASM 的成本与收益不成比例，且 Rust 引擎已在演进）。
硬锁手段 = **共享 fixtures 对账测试**：同一 fixture 语料（ysgp / 裸 ysm.json / zip 含/不含
ysm.json / litematic / schematic / nbt / 歧义容器 zip）双端各跑一套测试、断言同黄金值。
新格式逻辑落代码时必须在双端同步落测试（镜像测试纪律，参考 Rust↔Go parity_voxel_test）。

### D3 差异分类声明制：web 允许 ≠ Go，仅限三类且有声
web 模式结果集允许与 Go 不同，**仅当**同时满足：
(a) 由 web 环境硬约束驱动（无本地盘 / Worker 能力 / atob 内存上限）；
(b) 在 binding 注释 + contract 测试**双处显式声明**该差异；
(c) UI 消费方有降级提示或空态（如 consumeWebSearchDegraded）。
**禁止静默无声差异**。符合 (a)-(c) 的差异属契约，contract 测试应锁为"web 契约即降级"，
防未来误当 bug 修。

### D4 contract-b1 为唯一漂移哨兵
新增/修改 parity 判定语义：先扩 contract-b1 再动实现（TDD 式）；
新 binding 平移落地必须带对应 contract 条目。contract 测试失败 = 漂移告警，不是可忽略噪音。

### D5 本轮范围与收口定义
本轮（S2 首步）只立 ADR + 首轮漂移审计（零行为变更，不碰任何实现）。
**S2 收口定义**：附录 A 列出的"待对账/待锁"项全部落地——四函数 fixture 对账测试就位 +
contract-b1 扩 SearchModels 降级语义与排序断言 + DetectContainerType 上限联动注释。
收口前 S2 保持 ⏳ 排期。

## 附录 A：首轮四函数漂移审计表（2026-09-03）

| 函数 | Go 主源 | TS 平移 | 判定规则单一源？ | 已锁定 | 疑点 / 有意差异 | 建议 |
|---|---|---|---|---|---|---|
| DetectResourceType | `go/packs/classify.go:44` ClassifyResource(registry) | `web-fs.ts:719` resolveTypeSafe → 歧义容器指纹兜底 | ✅ registry=内嵌 JSON；TS 直读 JSON（G2 已清手写正则） | contract-b1 GetSubDirMap JSON 派生；getExts JSON 派生 | 容器歧义兜底顺序（.zip/.7z 先 ext null → 指纹）无 fixture 对账 | B1 扩：歧义容器指纹判定用例 |
| DetectContainerType | `app_install_import.go:58`（尾探针优先 → 整包兜底，覆盖至导入上限 500MB） | `web-fs.ts:681`（全量 atob 解码 → 指纹，上限 web MAX_IMPORT_BYTES=100MB） | ⚠️ 内容指纹属格式知识，非 registry | — | 差异1：Go 尾探针（O(4MB) 窗口，50~500MB zip 可探测）；TS 全量解码（atob 内存约束）→ 实现策略差异，结果口径同。差异2：探测上限 100 vs 500MB——**各自与自身导入上限同口径**，非漂移，但 web 导入上限抬升时必须联动 | binding 注释补"尾探针 vs 全量解码"策略说明；fixture 对账（zip64/尾部超窗） |
| ExtractYsmSummary | `go/ysm/summary.go:319`（os.Stat Size；YSGP spec2 短路径；裸 .json 分支 MaxReadLimit 守卫；zip 找 ysm.json；无 ysm 降级 scanZipBasicStats；zip 分支 tips 截 200） | `parsers/ysm-header.ts:328` extractYsmSummaryFromBytes(bytes, source)（YSGP 检测 / PK 头 zip 分发；MAX_HEADER_LINES=200 与 clampTexDim 均对齐注释） | ⚠️ 格式知识 | 散点单测（对齐注释密集） | Size 口径：Go=os.Stat 实际磁盘字节，web 仅字节流无 stat 等价物（emptyYsmSummary size=0）→ 待对账；裸 .json 分支与 zip 分支 tips 截断差异覆盖度待查 | 建 shared ysm fixtures（ysgp/裸json/zip有/无 ysm.json/畸形）双端对账 |
| SearchModels | `internal/app/app_scan.go:62`（TrimSpace+ToLower → name\|path 匹配 → **恒** AnalyzeBedrockModel → BoneCount==0 排除 → 数值过滤 → **Name 主键稳定排序**） | `web-fs.ts:780`→`searchWebModels:297`（kw 快路径降级行：不分析/不排除/不排序，数值 0+hasError:false；数值条件走 worker batchStats） | ⚠️ 过滤规则对齐，分析能力不同 | contract-b1：kw trim/大小写 2 例 | **有意差异（已注释+UI 提示但未锁为契约）**：web kw 快路径含 Go 会排除的不可分析条目、无 stats、无 Name 排序；数值分支 worker 对非 bedrock/分析失败条目的排除语义（hasError vs Go BoneCount==0）需对账 | B1 扩：① 显式锁"降级语义=web 契约"；② 排序断言（Go Name 稳定序 vs web 序）写明差异或对齐 |

## 附录 B：相关锚点

- 单一源实证：`go/types/resource.go:13`（bundledRegistryJSON 编译期内嵌）、`go/types/extensions.go:2`
- 代码侦探范式：`frontend/src/backend/browser-adapter.contract-b1.test.ts`（目标簇头注释列 Go 主源行号）
- 跨引擎对账先例：`go/litematic/parity_voxel_test.go`（Rust↔Go，commit 7cf18599）
- 处置卡：`docs/frontend-src-critique-status.md` S2 行

## 未决 / 后续

- 对账 fixtures 基建（目录约定 + 黄金值管理）单独立项，落地后 S2 才可收口（见 D5）。
- 类型归属"零手写"静态守卫（扫双端 ext 字面量）可作可选加固，非本轮范围。
