# ADR-154：Go-TS 解析层 golden 对拍（双端互锁契约）

- **状态**：✅ 已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-02
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`go/types/extensions.go:257 MatchZipEntry`、`go/types/parity_test.go`（既有双端互锁范式）、`go/packs/classify.go:83 DetectByEntries`、`frontend/src/utils/resource/types.ts:376 matchZipEntryTS`、`frontend/src/backend/extract.ts:196 detectZipType`、`go/packs/testdata/classify-golden.json`

---

## 1. 背景（Context）

网页版（无 Go 壳）把整层 Go 解析逻辑平移成 TS 影子层（ADR-049 web 豁免 + ADR-070/066/082 的「TS 镜像 Go」范式）：类型判定（`detectZipType`/`matchZipEntryTS`）、体素解析（`nbt-parse`/`voxel-parse`）、YSM 头部/摘要（`ysm-header`）、包 meta（`pack-meta`）、方块配色（`voxel-colors`）全部在 TS 侧 1:1 复刻 Go 实现。

风险：这是**双实现漂移的永久负债**。TS 侧每个函数都靠 `// 对齐 go/xxx.go:NN` 注释手工声明等价，但没有任何机制保证与 Go 同步——Go 改了 `DetectByEntries`/`MatchZipEntry`/`MapColor` 的口径，TS 侧不会失败、不会告警，只会静默漂移。现有 contract-b1/b2/b3 契约测试只能锁「web 自述语义」，无法锁「web == Go」。

已确认一个**真实漂移点**（现状恰好同向，但结构上随时可分叉）：
- Go `DetectZipType`（`go/importer/importer_file.go:149`）→ 委托 `packs.DetectByEntries`（`go/packs/classify.go:83`），按 **(priority desc, id asc) 裁决**，注册表顺序无关；
- TS `matchZipEntryTS`（`types.ts:376`）按**注册表顺序首命中**，**完全忽略 priority 字段**。
  当前 resource_types.json 中仅 maid-model(10)/blueprint(5)/litematic(5) 设 priority 且顺序恰好同向，但任何人新增「低 priority 但靠前的类型」或调整 zipEntries 就会分叉——这正是 golden 对拍要暴露的第一类问题。

## 2. 决策（Decision）

引入 **Go-TS 解析层 golden 对拍**：以共享 fixture（`tests/parity/*.json`）为双端互锁契约，Go 测试与 TS 测试读取**同一份** fixture，锁死纯解析函数的 input→output 对。

### 2.1 范式：完全对齐既有 `go-rust-predicates.json` 双端互锁先例
- 既有先例 `tests/parity/go-rust-predicates.json` + `go/types/parity_test.go`（Go 端从包目录逐级向上找仓库根）+ Rust 端同读——**本项目已有成熟范式**，pilot 不得另起炉灶（新脚手架 / 新存放位置 / 新加载方式一律禁止）。
- 新增 fixture 放 `tests/parity/`，命名 `go-ts-<域>.json`，头部 `_comment` 注明双端消费方。

### 2.2 双端互锁（硬性要求，非可选项）
每个 golden fixture 必须被**两端**断言：
- Go 侧：新增 `*_test.go` 读 fixture，断言「当前 Go 输出 == fixture 期望」；
- TS 侧：新增 `*.parity.test.ts` 读同一 fixture，断言「当前 TS 输出 == fixture 期望」。
任一端改口径，另一端测试当场红。**禁止只做 web 单侧对拍**——那是死快照，防不住 Go 侧漂移（本方案的核心动机）。

### 2.3 范围（纯函数层）
只对「字节/字符串 → 结构化结果」的**纯函数**做 golden；装配层（IDB 读写）、路径语义（`/web`）、Worker 编排**不纳入**（Go 与 TS 输入面不同，无法对拍）。识别层指纹（`MatchZipEntry` ↔ `matchZipEntryTS`）与方块配色（`MapColor`/`ResolveBlockName` ↔ TS `mapColor`/`resolveBlockName`）为首批落地域；ysm-header / nbt-parse 三视图 / pack-meta / 容器级 detectZipType 为后续扩展域。具体落地与进度见知识卡 `go_ts_golden`。

### 2.4 priority 裁决差异处理
pilot 1 阶段**只对拍 `MatchZipEntry` 单条指纹**（两端语义一致，可直接互锁）；**不直接对拍容器级 `detectZipType`**——TS 侧缺 priority 裁决，直接对拍会因算法层级不同而误报。容器级对拍列为后续项，前置动作是给 TS 侧补 (priority desc, id asc) 裁决（与 Go `betterCandidate` 同构），补齐后再对拍 `detectZipType`。

### 2.5 更新口径（维护）
- Go 行为变更（有意）→ 两端各自重跑测试，**同一批 fixture 期望值同时更新**并提交。
- 生成物（`voxel-colors-data.json` 等由 Go 生成的 JSON）→ golden 测试即生成物过期检测器：Go 源表变化而生成物未重新生成 → Go 侧测试红。
- 禁止「重跑一次 Go 覆盖 golden 后不 review」：fixture 期望值变更必须带 diff 审查（与 `go-rust-predicates.json` 维护纪律一致）。

### 2.6 CI 挂载
golden 对拍并入既有验证链路，不新增独立 gate：
- Go 侧：并入 `go test ./go/...`（pre-push 已含）；
- TS 侧：并入 `npx vitest run`（backend 测试集）。
不引入新的 CI 步骤/工作流。

## 3. 后果（Consequences）

### 正面
- 把「对齐 go/xxx.go:NN」从注释提升为可执行契约——Go 改口径 TS 立即红，漂移不再静默。
- 复用既有双端互锁范式，pilot 1/2 成本低（各约 1-2 个测试文件 + 1 份 fixture）。
- 顺带把 `voxel-colors-data.json` 生成物纳入过期检测。

### 负面 / 代价
- 每份 fixture 都是新增维护面：Go 行为变更必须显式同步两端，流程上多一步。
- 覆盖范围有限：只锁纯函数，不锁装配层/路径语义（那些继续靠 contract-b1/b2/b3 手写契约）。

### 已知遗留
- `detectZipType` 容器级对拍待 TS 补 priority 裁决后纳入（见 2.4）。
- `scanWebModels`/`searchWebModels` 等装配层永久无法 golden（输入面不同），漂移风险由契约测试 + 代码审查承担。

## 4. 数据溯源

- 影子层全量清单：`frontend/src/backend/`（nbt-parse/voxel-parse/ysm-header/pack-meta/extract/voxel-colors）。
- Go 对拍点：`go/types/extensions.go:257 MatchZipEntry`（↔ TS `types.ts:376 matchZipEntryTS`）；`go/litematic/block_colors.go:10 MapColor`（↔ TS `voxel-colors.ts:92`）；`go/litematic/block_ids.go:12 ResolveBlockName`（↔ TS `voxel-colors.ts:107`）。
- 双端互锁范式：`go/types/parity_test.go` + `tests/parity/go-rust-predicates.json`（Go↔Rust，ADR-038 D2 单一权威）。
- 语料来源：`go/packs/testdata/classify-golden.json`（entries 字段）、`go/litematic/block_ids.go`（id:data 表）。
