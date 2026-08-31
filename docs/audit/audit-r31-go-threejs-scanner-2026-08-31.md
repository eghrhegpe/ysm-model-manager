# R31 审核：go/threejs + go/scanner（两模块并行）

> 审核日期：2026-08-31｜审核人：deepseek（主模型）× 2 explore 子代理｜状态：⏳ 修复闭环中
> 前置：R26 installer+recycle+download / R27 sync+dedup / R28 cli+litematic / R29 ysm+geometry / R30 updater+importer

## 范围与岔开依据

**审核**（两模块并行，single 深度，只读）：

| 模块 | 非测试文件 | 规模 | 前置审核 |
|---|---|---|---|
| threejs | 3 个（spec.go 425 + spec-bones.go 286 + spec-cube.go 144） | 855 行 | 无 R 级系统审核 |
| scanner | 3 个（scanner.go 789 + rust_backend.go 45 + rust_backend_stub.go 9） | 843 行 | 无 R 级系统审核 |

**岔开**：R30 完结 updater+importer。threejs 是 3D 渲染规格生成（Three.js + YSMParser WASM 消费端），scanner 是仓库扫描 + 缓存 + 类型分类的入口。两包同属「模型数据转换 + 仓库元数据采集」域，一次性过。

## 总体结论：通过（5 项 P2 + 8 项 P3 + 9 项 P4）

两包代码质量分化显著：

- **go/threejs**：防御性扎实——NaN/Inf 入口守卫、finite 复查多层布防。但 `pivots[name]` map 取值普遍缺失存在性检查（P2 三条 + P3 一条均源于此），是本包最集中的风险点。`parseUV` 传原始 `c.Size`（未 clamp、未 inflate）与 `expandBoxUV` 用几何尺寸计算的 UV 块尺寸不匹配，可能导致纹理采样偏移/拉伸。
- **go/scanner**：注释密度极高、防御性思维到位（代际守卫、single-flight、原子版本戳、TTL/失效分层）。但存在两个真实缺陷：(1) `filepath.WalkDir` 返回 error 被忽略，使「根目录不可读不缓存」的修复在 lstat 失败路径上失效；(2) `InvalidatePath` 不递增祖先 key 版本，导致父目录缓存对子目录失效脏读。`errorSink` 裸变量存在 data race（go race detector 会报）。

## 发现项汇总

| 模块 | P2 | P3 | P4 | deep 复审 |
|---|---|---|---|---|
| threejs | 5 | 4 | 4 | 是（pivots 不变量 + parseUV 精度） |
| scanner | 3 | 5 | 5 | 是（WalkDir error 忽略 + InvalidatePath 祖先脏读） |
| **合计** | **8** | **9** | **9** | — |

## threejs 发现项

### P2（正确性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P2-1 | spec-bones.go:246,249 | `repairBrokenParentChain` 直接从 `pivots` 取值不判存在性；若骨骼名因去重逻辑未写入 `pivots`，会静默拿到零值 `vec3{}`，导致 LocalPosition 偏移到原点。 | 取值后判 `ok, hasPivot`，缺失时保留原 LocalPosition 或用 bone 自身 Pivot 兜底。 |
| P2-2 | spec-bones.go:265-266,277-278 | `attachArms` 中 `pivots["RightArm"]`、`pivots["Arm"]`、`pivots["LeftArm"]` 全部无存在性检查；任意一方缺失即用零向量计算 LocalPosition，产出错误骨骼挂载且无日志。 | 每处取值判 `ok`，缺失则跳过该 attach 并 log 告警。 |
| P2-3 | spec-bones.go:193 | `fillMissingBones` 在 `!found` 分支调用 `localPos = [3]float64{-bp.x, bp.y, bp.z}`，但此时 `bp, hasPivot := pivots[name]` 若 `!hasPivot`，`bp` 是零向量，`localPos` 全 0——纯 parent 引用骨骼会塌到原点。 | `!hasPivot` 时回退到 `model.Bones` 中该骨骼的 `b.Pivot`，或显式跳过该骨骼。 |
| P2-4 | spec.go:210 vs expandBoxUV:312-315 | `parseUV(c, &faceUVs, c.Size[0], c.Size[1], c.Size[2], texW, texH)` 传入原始 `c.Size`（未 clamp、未 inflate），而 `expandBoxUV` 用 `sx/sy/sz` 计算每面 UV 宽高。当 cube 有 inflate 或负 size 被 clamp 后，UV 块尺寸与实际几何尺寸不匹配 → 纹理采样偏移/拉伸。 | `parseUV` 应接收 clamp+inflate 后的 `sx,sy,sz`，或 `expandBoxUV` 改用几何尺寸。 |
| P2-5 | spec.go:339 vs expandBoxUV | `parseFaceUV` 的 `faceNames` 顺序是 `east,west,up,down,south,north`，但 `expandBoxUV` 写入 `faces[0..5]` 的面序由 `data` 数组隐式定义为 face 0..5 对应 east/west/up/down/south/north。两处面序需严格对齐——当前看起来一致，但属隐式契约，无单点常量约束。 | 抽 `faceOrder = [...]string{"east","west","up","down","south","north"}` 共享常量，并在测试里断言。 |

### P3（可靠性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P3-1 | spec-bones.go:84 | `assembleBones` 主循环对每个 bone 无条件取 pivot，若 `collectBonePivots` 因某种原因未写入（理论上去重后总会写入首次），会拿到零向量。当前 `collectBonePivots` 首次必写，故实际安全；但属脆弱契约，`pivots` 与 `first` 分离使不变量不显式。 | 在 `collectBonePivots` 末尾加 `// invariant: pivots contains every bone.Name seen` 注释或断言。 |
| P3-2 | spec.go:88-114 | `BuildMulti` 对 `texIdxBase` 越界回退到 `i`（`:96-99`），但若 `texIdxBase` 元素为负数或重复值，无任何校验 → 前端 `tex_N` 索引错乱。 | 在回退处加 `base >= 0` 守卫，或文档化「texIdxBase 由解析层保证合法」。 |
| P3-3 | spec-cube.go:46-50 | `resolveCubePivot` 中 `cp := [3]float64{c.Pivot[0], c.Pivot[1], c.Pivot[2]}` 然后 `:49 cp[0] = -cp[0]`，但 `:50 if !c.PivotSet { cp = [3]float64{ox + sx*0.5, ...} }`——此分支用 inflate 后的 `ox,sx` 计算中心。未设 pivot 时 cube 旋转中心用 inflated origin，与 Blockbench 行为是否一致需核对。 | 交叉验证 Blockbench parseCube 对 pivot 的 inflate 处理。 |
| P3-4 | spec.go:266-270 | `cubesOverlap` 用 `cubeEpsilon=0.001` 对 Origin/Size/Rotation 三组 [3]float64 做 abs-equal。模型坐标常在 ±32 范围、单位精度 0.001 尚可；但 Rotation 单位是度，0.001° 的差异即判不重叠 → 同名骨骼下旋转差一丁点的 cube 不会被合并替换而是追加，可能产生 z-fighting 重叠面。 | Rotation 比较改用更宽松 eps（如 0.01°）或单独常量。 |

### P4（可维护性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P4-1 | spec-bones.go:16,18-20,22 | `const glowingPrefix = "ysmglow"`（全小写）配合 `:22 strings.ToLower(name)` ——上游是区分大小写的 `startsWith("ysmGlow")`。注释 `:18-20` 解释了放宽理由，但常量值 `"ysmglow"` 与注释里写的 `"ysmGlow"` 不一致，读起来易混淆。 | 常量改 `glowingPrefix = "ysmglow"` 不变，但注释里统一用 `ysmGlow` 并明确「ToLower 后比小写常量」。 |
| P4-2 | spec-bones.go:49-54 vs :92-93 | 两处 overwrite 决策逻辑重复（`collectBonePivots` 和 `assembleBones` 各写一遍），注释声称「完全一致」但实际是手工同步的两份代码。任一处改了另一处漏改即产生 pivot/bone 不一致 bug。 | 抽 `shouldOverwriteBone(existingHasParent, newHasParent, existingHasRot, newHasRot bool) bool` 单一函数。 |
| P4-3 | spec-bones.go:98,112 | `append([]types.Cube2D{}, b.Cubes...)` 每个骨骼都做一次切片拷贝，大模型（数百骨骼 × 数十 cube）下产生大量小切片分配。非 bug，但 `assembleBones` 是热路径。 | 仅在需要隔离时拷贝，或预分配 cap。 |
| P4-4 | spec.go:308-311 | `expandBoxUV` 内部定义 `type uvData struct{...}` 每次调用都重新声明类型，虽无性能问题但可读性略差。 | 轻微，无需改。 |

## scanner 发现项

### P2（正确性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P2-1 | scanner.go:287,504 | `filepath.WalkDir` 的返回 error 被完全忽略。当根目录 `lstat` 失败（权限拒绝/不存在），WalkDir 会返回非 nil error，但此处不接收，导致 `walkFailed` 永远不会被根级 lstat 错误触发——`processScanDirEntry` 的 `err != nil` 分支只在回调内 err 非空时跑，而 WalkDir 在根 lstat 失败时**根本不调用 callback**，直接返回 error。结果：目录不可读时 `walkFailed` 保持 false，空结果照常 Store 进 30s 缓存——正是注释 L283-285 声称已修复的那个 bug，修复对根级 lstat 失效路径不成立。 | `if err := filepath.WalkDir(...); err != nil { walkFailed = true }`，或在 WalkDir 前 `os.Stat(dir)` 单独判定。 |
| P2-2 | scanner.go:250-251 + InvalidatePath:204-211 | `InvalidatePath` 遍历 `keyVersions` 时用 `strings.HasPrefix(key, kstr+sep)` 做父子匹配。若用户扫描 `/a/b` 后调用 `InvalidatePath("/a")`，`keyVersions` 里有 `/a/b` 的条目，前缀匹配 `/a/b` startsWith `/a/` → 递增 `/a/b` 的版本，正确。但反向：`InvalidatePath("/a/b")` 时，`/a` 的版本**不会**被递增（`/a` not startsWith `/a/b/`），而 `scanCache.Range`（L216-222）也只删 `/a/b` 自身及子项。若 `/a` 的缓存条目存在且其内容包含 `/a/b` 子树的状态，则父缓存不会被失效——这是一个**真实的缓存脏读**：父目录扫描结果缓存了 30s，子目录失效不波及父。 | `InvalidatePath` 同时递增所有**祖先** key 的版本，或在 `scanCache` 删除时也按祖先前缀删除。 |
| P2-3 | scanner.go:80,95-97,118 | `errorSink`（L80）裸变量，`SetErrorSink`（L95-97）无锁写入、`emitScanError`（L118）无锁读取——**启动期单写、运行期只读**的约定靠注释维持，实际存在 data race（go race detector 会报）。 | `errorSink` 改 `atomic.Pointer[func(string)]`，或 `sync.RWMutex`。 |

### P3（可靠性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P3-1 | scanner.go:447-455,479 | 全量 SHA256 哈希在 `wantMeta=true` 路径对每个 hashable 文件**同步**读全文件——大库（数万文件 + 数百 MB zip）首屏会整线程卡死。注释 L447-448 说「跳过非 YSM 大文件」但 `ShouldHashExt` 对 `.zip` 返回 true，resourcepack zip 可达数百 MB。`ComputeFileHash`（L479）有 `MaxImportSize` 上限保护，超限返回空——缓解但未消除（500MB 以下仍全量读）。 | 哈希改流式分块或后台 goroutine pool，首屏只返回元数据。 |
| P3-2 | scanner.go:111-116 | `emitScanError` 在每次调用时遍历整个 `dedupSeen` map 清理过期项。若错误类型爆发（如数千个不同文件的权限错误），map 膨胀且每次清理 O(n)。长期运行会话的内存增长被注释声称防住了，但清理是**内联在错误上报热路径**里的——高频错误时退化。 | 清理改为周期性 ticker 或限制 map 容量。 |
| P3-3 | scanner.go:463-472 | `tryStoreScanCache`：`walkFailed` 时不写缓存（正确），但**也不清已有的过期/陈旧缓存条目**。若目录从「可读有内容」变为「不可读」，旧的好结果缓存仍在 30s TTL 内被命中返回陈旧数据。 | `walkFailed` 时主动 `scanCache.Delete(dir)`。 |
| P3-4 | scanner.go:437-443,482 | 损坏文件处理：`processScanDirEntry` L437-443 对 `d.Info()` 失败跳过该文件（诚实），但 `ComputeFileHash`（L482）读文件失败返回空字符串，`e.Hash = ""` 仍进入 entries——同步系统对空哈希静默跳过（注释 L451-452 承认）。用户无感知。 | 哈希失败时给 entry 打标记或排除出同步候选。 |
| P3-5 | scanner.go:653-667 | `GenerateRepoIndex`：先 `InvalidatePath(repoPath)` 再 `ScanEntries`。但 `InvalidatePath` 递增 key 版本，`ScanEntries` 进入时重新 LoadOrStore 拿到新版本——时序正确。不过 `GenerateRepoIndex` 不持 inFlight 航班，若并发调用同一 `repoPath`，两次 `WriteFileAtomic` 会竞争（atomic rename 保证最终一致，但中间态可能让一次写入被覆盖丢弃）。低概率，标 P3。 | 加 `inFlight` 航班或 `sync.Mutex` 串行化同 repoPath 的 GenerateRepoIndex。 |

### P4（可维护性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P4-1 | scanner.go 789 行单文件 | 混载 5 个职责域（缓存/single-flight/作者提取/仓库索引/内嵌 CI 脚本）。`generateIndexWorkflow`（L712-789）是 77 行的 heredoc YAML+Go，与 scanner 逻辑无任何耦合。 | 按职责拆 `cache.go`/`flight.go`/`authors.go`/`repoindex.go`。 |
| P4-2 | scanner.go:287 vs :504 | 两处 WalkDir 闭包结构高度相似但 `wantMeta` 不同，且 Lite 版（L504-514）不设 `walkFailed`、不克隆、不缓存——差异点分散，后续维护易只改一处。 | 合并为内部 `walkScan(dir, wantMeta)` 返回 `(entries, walkFailed)`。 |
| P4-3 | rust_backend.go:14-26 | 注释长段解释「为何合并四份 OS 变体」属 ADR 历史叙事，与函数当前职责（FFI 桥接）混杂。 | 将 ADR 引用压缩为一行，历史背景移到 ADR 文档。 |
| P4-4 | scanner.go:519-521 | `stripDisableSuffix` 是 `types.StripDisableSuffix` 的 1:1 转发壳，仅在 `extractAuthor`（L525）和 `processScanDirEntry`（L417）使用。 | 让调用方直接调 `types.StripDisableSuffix` 消除壳函数。 |
| P4-5 | scanner.go:60,66 | `walkStartHook` / `rustScanHook` 是包级裸变量，注释明确「禁止生产调用」但无 `//go:build test` 约束或 `testing` 包守卫。生产构建中这些变量恒 nil 不会被触发，但**任何人误写 `walkStartHook = someFunc` 都会静默生效**。 | 移到 `_test.go` 支持的注入点或加 build tag 隔离。 |

## 修复状态注记（2026-08-31 闭环进行中）

| 级别 | 位置 | 状态 |
|---|---|---|
| threejs P2-1 (repairBrokenParentChain pivots) | spec-bones.go:246,249 | ⏳ 待修 |
| threejs P2-2 (attachArms pivots) | spec-bones.go:265-266,277-278 | ⏳ 待修 |
| threejs P2-3 (fillMissingBones pivots) | spec-bones.go:193 | ⏳ 待修 |
| threejs P2-4 (parseUV 原始 Size) | spec.go:210 vs expandBoxUV:312-315 | ⏳ 待修 |
| threejs P2-5 (parseFaceUV 面序隐式契约) | spec.go:339 vs expandBoxUV | ⏳ 待修 |
| threejs P3-1~P3-4 | 多处 | ⏳ 待修 |
| threejs P4-1~P4-4 | 多处 | ⏳ 待修 |
| scanner P2-1 (WalkDir error 忽略) | scanner.go:287,504 | ⏳ 待修 |
| scanner P2-2 (InvalidatePath 祖先脏读) | scanner.go:250-251 + InvalidatePath:204-211 | ⏳ 待修 |
| scanner P2-3 (errorSink data race) | scanner.go:80,95-97,118 | ⏳ 待修 |
| scanner P3-1~P3-5 | 多处 | ⏳ 待修 |
| scanner P4-1~P4-5 | 多处 | ⏳ 待修 |
