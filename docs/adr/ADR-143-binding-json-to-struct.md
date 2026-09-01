# ADR-143：绑定返回值去 string-JSON 化（铲债决策）

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡 `binding_json_cleanup`（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-01
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`docs/knowledge/binding_json_cleanup.md`、ADR-014（类型化渐进迁移）、ADR-049（平台双路由）

---

## 1. 背景（Context）

审计发现 **23 个返回 `string` 实为 `json.Marshal` 手串的 JSON**（另 2 个 Deprecated 绑定直接删除，其一亦是 JSON），前端 30+ 处生产代码以 `JSON.parse(...) as 手写类型` 消费。核心危害：

1. **类型断层**：断言类型（`Spec3D`、`ResourceTypeEntry[]` 等）是前端手写的，非 codegen 产物。Go 侧改字段名，TS 编译期零报错，运行时 `undefined` 才炸——ADR-014 收割的类型化红利被这条暗道泄气。
2. **错误通道三套并存**：① `(T, error)` → Promise reject；② 失败返 `"{}"` 吞错（`LoadResourceTypes`/`ReadPackMeta`，registry.ts 曾因此缓存空注册表整会话）；③ 失败返 `{error:"..."}` JSON 字符串（`DetectConflicts`/`FindDuplicateFiles`/`RepoHealthAudit` 族，`error_json.go` 专门造 ErrorJSON 工具续命）。前端必须逐方法背「失败时给什么形态」；`{}` 吞错历史上造成「体素永远为空」的假绿。
3. **双实现成本**：web 端 browser-adapter（ADR-049）需人肉对齐这套字符串契约（webImpls spread + 契约测试逐条 JSON.parse 验证），与桌面 codegen 零心智成本严重不对称。
4. **同语义两写法**：`ReadPackEntry` 手撸 `base64.StdEncoding` 返回 string，`ReadFileBytes` 返回 `[]byte` 自动 base64。

## 2. 决策（Decision）

1. **`internal/app` 导出绑定禁止以 `string` 承载 JSON**：分批改为 struct/`[]T` 返回 + `error` 第二返回值，吃满 Wails codegen 类型红利。
2. **错误通道统一 `(T, error)`**：废除 `"{}"` 吞错与 `{error:"..."}` 字段两种暗道；`error_json.go`（ErrorJSON/SyncErrorJSON/ResolveErrorJSON/DedupErrorJSON）随最后一批迁移退役。
3. **豁免清单**（JSON 文本协议合法保留，见知识卡 §三）：`ExecuteCLI`/`GetAllowedCLICommands`（CLI 子进程 `--json` 跨进程协议）、`ExportModelStructureJSON`（导出物即 JSON 文件）。豁免项前端必须收敛**单一类型化解析器**（cli-bridge.ts 模式），禁止散落 `JSON.parse`。`Build3DSpecFromGeometryJSON` 不豁免：其输出与 `GetModel3DSpec` 同为 Spec3D 形状且消费方重叠，入参 geometryJSON 是 JSON 文本不违规（红线只管返回值），随 P0 同批 struct 化。
4. **分批迁移** P0→P1→P2：每批 `npm run generate:bindings -ts` + 前端消费点同批切换 + 契约测试更新；批次划分与进度见知识卡 `binding_json_cleanup`。
5. **治理闸**：`binding-check` 增加静态规则——「`internal/app` 导出方法返回 `string` 须命中豁免白名单」，防新暗道回潮。
6. **Deprecated 绑定直接删除**而非迁移：`ImportResourcePack`、`CountDuplicateFiles`（前端 0 消费）。

## 3. 后果（Consequences）

**正面**
- Go 字段改名 → TS 编译期报错，契约单一事实源闭环到 codegen。
- 前端 30+ 处手写 `as` 断言删除；三套错误语义归一为 `catch`。
- web browser-adapter 从「人肉对齐字符串契约」升级为「对齐类型化 `AppBindings`」。

**负面 / 代价**
- 每批迁移需重新 generate:bindings，web 侧 `web-fs`/`web-store` 对应实现同步改写，browser-adapter 契约测试（contract-b1/b2/b3）跟随更新。
- 迁移窗口内新旧风格并存，review 按知识卡清单对号，不按个人口味。

**已知遗留**
- `ReadPackEntry` base64 string 与 `ReadFileBytes` `[]byte` 的同语义两写法：随 P2 评估统一（倾向 `[]byte`）。
- `DoUpdate`/`ImportByType` 文本结果串（真字符串档）：仅规范错误通道，不改签名。

## 4. 数据溯源

- 2026-09-01 审计：grep `internal/app` 导出签名 `) string {` 44 命中 → 逐个核语义 - 2026-09-01 审计：grep `internal/app` 导出签名 `) string {` 44 命中 → 逐个核语义 → 23 条 JSON 病灶（P0×6 + P1×17）+ 3 条豁免 + 2 条 Deprecated 直接删除 + 16 条真字符串（清单固化为知识卡 `binding_json_cleanup`）。
- 前端 `JSON.parse` 消费点 grep 149 命中（含测试），生产消费点见知识卡 §一 表格。
- 假绿实证：`resource_bindings.go` voxelErrorJSON 注释「原契约下用户永远只看到体素为空」；`registry.ts` P2 修复注释「`{}` 被缓存 → 整会话空注册表」。
