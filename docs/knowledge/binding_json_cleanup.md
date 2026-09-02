---
kind: binding_json_cleanup
name: string-JSON 绑定铲债清单
tier: architecture
category: core
affected: false
source_files:
  - internal/app/resource_bindings.go
  - internal/app/app_sync.go
  - internal/app/app_install_instance.go
  - internal/app/app_model.go
  - internal/app/container_entries.go
  - internal/app/resourcepack_models.go
use_when:
  - string-JSON
  - JSON.parse 断言
  - 绑定 struct 化
  - 铲债清单
  - 错误通道统一
  - ADR-143
  - 绑定返回 string
status: snapshot
---

# string-JSON 绑定铲债清单

## 概览

ADR-143 的实施进度账本。2026-09-01 审计 `internal/app` 全部导出绑定：返回 `string` 的 44 个签名逐个核语义，分四档——**23 条 JSON 病灶**（P0×6 + P1×17，该 struct 化）、**2 条 Deprecated**（直接删）、**3 条豁免**（合法 JSON 文本协议）、**16 条真字符串**（只规范错误通道）。前端 30+ 处生产代码以 `JSON.parse(...) as 手写类型` 消费病灶档，类型断层 + 三套错误语义（`error` / `"{}"` 吞错 / `{error}` 字段）由此而来。

**进度**：P0×6 全部 ✅（2026-09-01）；P1×17 全部 ✅（2026-09-01）；P2 全部 ✅（2026-09-01）——Deprecated 删除、error_json.go 工具族退役、ReadPackEntry 统一 []byte、binding-check 治理闸上线。

**进度约定**：铲一条把状态列改 ✅ 并同步删除前端对应 `JSON.parse` 断言；整批完成在本表登记。ADR-143 只记决策，不记进度。

## 一、JSON 病灶（23 条，struct 化 + `(T, error)`）

### P0（6 条，高频 + 坍缩错误语义收益最大；按消费方文件归批避免二次触碰）

| 绑定 | Go 位置 | 前端消费点（手写断言） | 状态 |
|---|---|---|---|
| `LoadResourceTypes` | resource_bindings.go:27 | registry.ts:25、app-preview/index.ts:235、site/edit.ts:215、sync-manager/store.ts:24 | ✅ |
| `GetModel3DSpec` | app_model.go:415 | screenshot-render.ts:90、model3d-loader.ts:64、skeleton-render.ts:104、debug.ts:96 | ✅ |
| `Build3DSpecFromGeometryJSON` | app_model.go:455 | screenshot-render.ts:99、model3d-loader.ts:97、spec-builder.ts:156 | ✅ |
| `DetectConflicts` | app_sync.go:15 | diagnostics/conflicts.ts:247 | ✅ |
| `ResolveConflicts` | app_sync.go:59 | diagnostics/conflicts.ts:407 | ✅ |
| `FindDuplicateFiles` | resource_bindings.go:556 | diagnostics/dedup.ts:276 | ✅ |

> `GetModel3DSpec` 与 `Build3DSpecFromGeometryJSON` 输出同为 Spec3D 形状、消费方重叠（screenshot-render / model3d-loader），必须同批切换——前者 P0 而后者留 P1 会导致同一文件改两遍。后者入参 geometryJSON 是 JSON 文本，不违规（红线只管返回值）。

### P1（17 条）

| 绑定 | Go 位置 | 前端消费点（手写断言） | 状态 |
|---|---|---|---|
| `ReadPackMeta` | resource_bindings.go:37 | pack-meta.ts:104、detail.ts:154 | ✅ |
| `ReadShaderpackLang` | resource_bindings.go:61 | detail.ts:274 | ✅ |
| `ReadSchematic` / `ReadNbtStructure` / `ReadLitematicMeta` | resource_bindings.go:115/124/133 | litematic-meta.ts:114-120 | ✅ |
| `GetNbtVoxelData` / `GetSchematicVoxelData` / `GetLitematicVoxelData` | resource_bindings.go:105/110/143 | litematic-adapter.ts:78、litematic-3d.ts:81 | ✅ |
| `ListContainerEntries` | container_entries.go:75 | pack-3d.ts:45 等 | ✅ |
| `GetVoxelDataInContainer` | container_entries.go:110 | pack-3d.ts:45 等 | ✅ |
| `ListPackModels` / `ListPackModelsDetail` | resourcepack_models.go:73/100 | pack-3d.ts:45 | ✅ |
| `RepoHealthAudit` | resource_bindings.go:605 | health-report.ts:48、health.ts:35、oldest-models.ts:66 | ✅ |
| `RepoHealthAuditAll` | resource_bindings.go:626 | health.ts（注释明说全仓泛泛、实战走单仓） | ✅ |
| `GetSyncScanDirs` | app_install_instance.go:527 | sync-manager/store.ts:56 | ✅ |
| `GetInstanceSyncStatus` | app_install_instance.go:576 | sync-manager/store.ts:48 | ✅ |
| `SyncResources` | app_install_instance.go:352 | sync-manager/index.ts、store.ts | ✅ |

## 二、Deprecated（2 条，已删除 ✅）

| 绑定 | Go 位置 | 状态 |
|---|---|---|
| `CountDuplicateFiles` | resource_bindings.go:585（已删） | ✅ 2026-09-01 |
| `ImportResourcePack` | resource_bindings.go:454（已删） | ✅ 2026-09-01 |

## 三、豁免（3 条，合法 JSON 文本协议，别误铲）

| 绑定 | 理由 | 附加要求 |
|---|---|---|
| `ExecuteCLI` | CLI 子进程 `--json` 跨进程协议 | 前端解析收敛在 cli-bridge.ts 单一类型化解析器 |
| `GetAllowedCLICommands` | 同上 | 同上 |
| `ExportModelStructureJSON` | 导出物即 JSON 文件（前端 0 parse） | 无 |

## 四、真字符串（16 条，不改签名，只规范错误通道）

- `DoUpdate`（app_config.go:316）`"success"`/`"失败: ..."` 文本；`ImportByType`（resource_bindings.go:467）importer 文本结果
- 类型 ID 串：`DetectResourceType` / `DetectZipType`
- 路径/配置/版本：`GetDefaultRepoRoot`、`GetGlobalCustomDir`、`GetYSMRepoRoot`、`GetConfigPath`、`GetLinkMode`、`FindPreviewImage`、`ExtractPreviewTexture`、`SelectImportZip`、`SelectImportFile`、`GetAppVersion`、`CurrentVersion`
- `ReadPackEntry`（resourcepack_models.go:166）✅ 已统一为 `[]byte`（Wails 自动转 base64，与 `ReadFileBytes` 同口径，2026-09-01）

## 铲债步骤（已全部执行完毕 ✅）

1. Go 侧改 `(T, error)` struct 返回 → `go build ./go/...`
2. `npm run generate:bindings -ts`（必须带 `-ts`，回归红线）
3. 前端消费点同批切换：删 `JSON.parse` + `as` 断言，改 `try/catch`；web 侧 `web-fs`/`web-store` 对应实现同步改
4. browser-adapter 契约测试（contract-b1/b2/b3）+ 消费方测试更新 → `npx vite build` + `npm run typecheck`
5. 状态列打 ✅；`error_json.go` 工具族（ErrorJSON/SyncErrorJSON/ResolveErrorJSON/DedupErrorJSON）P2 已退役删除

## 不变量

- 新增绑定**禁止**返回 `string` 承载 JSON（ADR-143 §2.1）；豁免仅限本表 §三三条
- 失败语义只有一种：`(T, error)` → Promise reject；`"{}"` 吞错与 `{error:"..."}` 字段均为违规
- 豁免档前端必须走单一类型化解析器，禁止散落 `JSON.parse`
- 绑定签名改动必跑 `generate:bindings -ts`，禁止手写 bindings

## 相关

- ADR-143（决策方向）、ADR-014（类型化渐进迁移）、ADR-049（平台双路由）
- 知识卡 `wails-bridge`（getApp 唯一入口）、`backend-idb`（browserAdapter 数据面）
- 治理闸：✅ `binding-check` 已上线「导出绑定返回 string 须命中 STRING_RETURN_ALLOWLIST」静态规则（ADR-143 §2.5，2026-09-01）——新增 string 返回方法若不在白名单（真字符串/豁免）即报错，防 string-JSON 暗道回潮
