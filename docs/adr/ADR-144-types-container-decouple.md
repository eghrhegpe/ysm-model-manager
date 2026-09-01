# ADR-144：types 解耦 container：识别大脑下沉 packs

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-01
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`go/types/classify.go, go/types/extensions.go, go/packs, go/container/container.go`

---

## 1. 背景（Context）

依赖方向图扫描发现共享类型层倒挂：

```
go/types ──依赖──▶ go/container（.zip/.7z/目录 容器 IO 基础设施）
```

具体耦合点：

1. `go/types/classify.go`（378 行，规范分类器 / 单一识别大脑）直接调
   `container.Open` / `container.Entry` 做容器内容指纹裁决。
2. `go/types/extensions.go` 的 `IsTypeModelFile` 用 `container.ZipMatchesEntries`
   做 zipentry 类型指纹判定。
3. **直接代价**：`go/container/container.go:144-153` 被迫内联 `stripDisableSuffix`
   （注释明说「本包不能引 types（types 依赖 container，循环依赖）」）——
   方向倒挂逼出代码重复，`types.StripDisableSuffix` 无法被复用。

`types` 的定位是「跨包共享类型层」，应只放类型/注册表/纯扩展名判定；
识别大脑（开容器、枚举条目、指纹裁决）属于识别领域逻辑，不该住在共享类型层。

## 2. 决策（Decision）

把依赖 `container` 的识别逻辑从 `types` 下沉到 `packs`（识别领域包，
已持有 `DetectResourceType` 识别入口，顺带把薄壳变实心）：

1. `go/types/classify.go` 整体搬迁 → `go/packs/classify.go`（package 改 packs）。
   符号加 `types.` 前缀引用纯类型/注册表/扩展名函数；`container` 依赖随行。
2. `go/types/extensions.go` 的 `IsTypeModelFile`（依赖 container）→ 搬入 packs。
3. `types` 移除对 `container` 的全部 import，回归纯类型层。
4. `go/container` 因此解除循环禁令 → 改用 `types.StripDisableSuffix`，
   删除内联 `stripDisableSuffix`（复用既有函数，消灭重复）。
5. 消费方同步改 import：`types.X` → `packs.X`
   （ClassifyResource / DetectByEntries / IsTypeModelFile / ClassContainer / ClassOther）。

目标依赖方向：

```
packs ──▶ container, types      （识别领域包依赖容器 + 类型层）
container ──▶ types             （容器复用类型层的纯函数，单向无环）
types ──(无 container)──        （纯类型层）
```

## 3. 后果（Consequences）

正面：

- `types` 回归纯类型/注册表/纯函数层，任何想依赖 types 的包不再被迫牵连 zip/7z 解析。
- `container` 不再内联 `stripDisableSuffix`，消灭与 `types.StripDisableSuffix` 的重复。
- 识别大脑与 `DetectResourceType` 识别入口同包，薄壳消失，识别职责单点收敛。
- 依赖图无环（`packs → container → types`），`go build` 可证。

负面 / 已知遗留：

- `packs` 包职责从「资源包解析」扩展为「资源类型识别 + 资源包解析」，
  包名语义略窄于实际职责（历史遗留命名，不在本次改名）。
- 消费方（importer / instance / sync / internal-app / repoaudit）需同步改符号前缀，
  属机械替换，风险低；golden 测试随搬迁验证行为不变。
- `go/cli → internal/app` 反向边不在本 ADR 范围，另行处理。

## 4. 数据溯源

- 依赖方向：`scripts` 包级 import 扫描（non-test 168 文件）→
  `go/types` 仅 classify.go + extensions.go 引用 container。
- 内联重复：`go/container/container.go:144-153 stripDisableSuffix` 与
  `go/types/extensions.go:159 StripDisableSuffix` 语义对齐，注释自证循环约束。
- 消费方清单：grep `types\.(ClassifyResource|DetectByEntries|IsTypeModelFile|ClassContainer|ClassOther)`
  命中 importer_file.go / detect_tail.go / instance.go / sync_dirlevel.go /
  sync_relink.go / app_install_recycle.go / app_avatar.go / packs/mcmeta.go。
- 行为护栏：`go/types/classify_test.go` golden 语料随搬迁保留，验证分类行为零漂移。
