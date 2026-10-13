# ADR-269-d1：容器扩展名单源化：registry.containerExts 声明入 JSON，Go/前端/契约三端派生

- **状态**：✅ 已采纳（Accepted）
- **日期**：2026-10-13
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **关联主 ADR**：[ADR-269](../ADR-269-resource-manifest-single-source.md)（资源清单单一事实源化——本刀是该方向上「容器扩展名」这一枚遗留手抄的收口）
- **相关**：`go/types/registry/extensions.go`（ContainerExts/IsContainerExt）、`go/types/registry/resource.go`（ResourceTypeRegistry）、`frontend/src/utils/resource/schema.ts`（JSON 唯一解析点）、`frontend/src/utils/resource/types.ts`（CONTAINER_EXTS 消费端）、`tests/test_resource_schema.ts`（契约第四抄）、`resource_types.json`

---

## 背景（一句）

诊断页锐评「双源镜像」三查外扫时发现：容器扩展名 `.zip/.7z` 在**四处各写一份字面量**——Go `ContainerExts()` 返回切片、Go `IsContainerExt()` 函数体逐个 `==`、前端 `types.ts|CONTAINER_EXTS`、契约测试 `test_resource_schema.ts|CONTAINER_EXTS`；`extensions.go` 头注自称「三端同源」实为**四份手抄同一对值、零机器连线**（注释引用的对账测试 `tests/test_resource_schema.mjs` 已不存在，属「注释承诺 > 现实」），新增容器格式要改四处且漏改无闸。

## 决策（三行）

1. **`resource_types.json` 顶层增 `containerExts: [".zip", ".7z"]` 声明**——事实源入 JSON（与 `cliAnalyzable` 迁入同路径：ADR-269 D3④ 同步通路，Go 加载结构体、前端 `schema.ts` 直读、契约测试读文件，三方派生）。
2. **Go 侧派生**：`ResourceTypeRegistry` 增 `ContainerExts []string \`json:"containerExts"\`` 字段；`ContainerExts()` 改读注册表（空则回退嵌入基线语义不变）；`IsContainerExt()` 改为查按「注册表实例指针为 key」的既有 atomic 缓存集合（逐文件热路径不拿锁、口径与 `loadExtCache` 同款）。
3. **前端/契约派生**：`schema.ts` 顶层形状增 `containerExts`，`types.ts|CONTAINER_EXTS` 改由其派生（缺声明时 fail-loud 回落并告警，同 `allResourceTypes` 空表口径）；`test_resource_schema.ts` 的对账集合改读 JSON 同一字段，并新增一条**跨端不变量**：`containerExts` 非空、小写带点、且声明容器扩展名的类型必须配 `zipEntries`（守卫已有，值集单源化后仍成立）。

## 后果（一句）

新增容器格式 = 只改 JSON 一处，Go/前端/契约自动跟随；回退方式是还原四文件。行为不变量：`TestIsContainerExt` 值表与 `TestContainerExts_SetStable` 一字不改照绿（值集相同，只换来源）；`go build ./...` + `go test ./go/types/... -timeout` + 契约测试 + 前端三闸验尸。

