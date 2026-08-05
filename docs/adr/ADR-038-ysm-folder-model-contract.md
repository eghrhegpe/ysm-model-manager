# ADR-038：YSM 文件夹模型统一契约：ysm.json 单一入口与整组操作

- **状态**：✅ 已采纳（D2 白名单 + D3 整组操作均已落地）
- **日期**：2026-08-05
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：[ADR-028](ADR-028-installer-atomic-link-relink.md)（目录级安装/链接原子性）、[ADR-004](ADR-004-3d-rendering-pipeline.md)（ysm.json 清单解析）、[ADR-003](ADR-003-logic-sinking.md)（fileops 下沉）；`go/scanner/scanner.go`、`frontend/src/features/dnd-shared.ts`、`go/importer/importer_file.go`、`internal/app/app_install.go`

---

## 1. 背景（Context）

YSM 模型有三种分发形态：`.ysm` 单文件（zip 容器）、`.zip` / `.7z` 打包、以及**解压目录**（`ysm.json` 清单 + 几何 json（`main.json` / `arm.json` 等）+ `*.animation.json` + `textures/` + 语言 json（`zh_cn.json` / `en_us.json`））。

2026-08-05 现场故障：从 ysm 包目录导入时，**包内资源 json 被当作独立模型直接导入仓库**（一次导入 17 个：`slashblade.animation.json`、`main.json`、`arm.json`、`zh_cn.json`、`en_us.json` 等全部进 `imported` 列表；`ysm.json` 单独在命名表单队列）。仓库界面正常——Go 端 `scanner.ScanEntries` 已有 `.json` 白名单（scanner.go:80-87），但前端导入路径（`dnd-shared.ts` `isSupportedFile`）只按扩展名放行 `.json`，非 `ysm.json` 的 json 走 `directImport` 直接落库。

另一结构性缺口：文件夹型模型在 UI 中被建模为**一个 ysm.json 文件条目**，移动/复制/重命名操作落在文件级（`RenameFile` / `MoveModelFile` / `CopyModelFile` 单文件语义），**只动 ysm.json、整组散架**；目录行菜单（`menu-defs.ts`）无 `dir.move` / `dir.copy`。

## 2. 决策（Decision）

**D1 · ysm.json 单一入口契约**：YSM 解压目录形态以 `ysm.json` 为唯一模型条目入口；包内其余 json（几何 / 动画 / 语言）**不是**独立模型条目，不得单独扫描、导入、推送、加载。

**D2 · `.json` 白名单统一**：`.json` 扩展名仅放行 `ysm.json`（base name 级判断，任意子目录均适用，与 `.ban` 后缀兼容）。三处口径强制对齐：

| 路径 | 位置 | 状态 |
|------|------|------|
| Go 扫描 | `go/scanner/scanner.go:80-87` | ✅ 已有（确认保留） |
| 前端导入 | `dnd-shared.ts` 新增 `isImportableFile`（import-queue 5 处 + dnd.ts 3 处调用） | ✅ 已落地（2026-08-05） |
| Go 导入防御 | `go/importer/importer_file.go` `ImportFromBase64` + `internal/app/app_install.go` `importModelFileWithSubpath` | ✅ 已落地（2026-08-05） |

**D3 · 文件夹模型整组操作契约**（已落地 2026-08-05）：

1. `go/fileops` `MoveModelFile` / `CopyModelFile` 目录感知：`src` 为 `ysm.json` 时提升为操作**父目录**（整组语义）；`Copy` 支持目录递归复制（含 `.ban` 状态文件）。
2. 目录行菜单补充 `dir.move` / `dir.copy`（`menu-defs.ts` + `context-menus.ts` handler）。
3. `file.rename` 对 `ysm.json` 特判禁止（前端 warn 提示 + 后端 `RenameFile` 双重拦截）；游戏加载器按目录名识别模型，`ysm.json` 文件名是固定契约。
4. 回收站 `Move` 目录整组（既有 `os.Rename` 语义）；跨设备回退与 `List` 合并显示为遗留项。
5. `AnalyzeBedrockModel` 的 `.json` 分支维持「解压目录入口」语义（任意 json 可作入口解析），由上游白名单保证只到达 `ysm.json`——解析层不做二次过滤。

**D4 · 白名单单点维护**：Go 侧 ysm.json 白名单抽为共享函数 `types.IsYsmEntryJSON`（`go/types/extensions.go`），`scanner` / `importer` / `app_install` 三处统一调用，消除重复实现。
6. **删除单入口统一**（深究补充 2026-08-05）：现状双轨——`DeleteResourcePack`（`os.Remove` 单文件，`resource_bindings.go:314`）与 `DeleteModelDir`（`os.RemoveAll` 父目录，`resource_bindings.go:319`）。文件夹型模型应统一走「目录感知删除」（`src` 为 `ysm.json` → 删父目录），去掉单文件 `os.Remove` 路径，消除同一操作两个语义入口。
7. **启用/禁用整组化**（深究补充 2026-08-05）：`ToggleModelEnable`（`fileops.go:315`）对 `ysm.json` 加 `.ban` 只禁单文件，文件夹模型禁用后目录内几何/动画/语言 json 仍可被读取。`src` 为 `ysm.json` 时应将 `.ban` 提升到**父目录级**（如 `dir.ban` 目录哨兵或父目录重命名标记），整组一起禁用；扫描层需同步识别目录级 `.ban`。

## 3. 后果（Consequences）

**正面**：
- 导入不再污染仓库：包内 json 在前端入口与后端双入口均被拦截（纵深防御，前端疏漏不落库）。
- 扫描 / 导入 / 加载三路径口径统一，消除「仓库界面正常、导入异常」类漂移。
- 整组操作落地后，文件夹模型移动 / 复制 / 回收不散架，杜绝仓库孤儿 json（界面不可见垃圾）。

**负面 / 已知遗留**：
- 历史已误导入的孤儿 json（如本次现场 17 个及更早）仍残留在仓库，`ScanEntries` 白名单使其界面不可见 → **遗留项**：孤儿清理工具或一次性清扫脚本。
- 回收站 `List` 对整组目录仍拆散成单文件条目显示（`Restore` 可还原目录结构）→ **遗留项**：合并显示。
- 文档缺口：`docs/knowledge/go-ysm-parser.md` 无「YSM 包内结构 + 仅 ysm.json 可作独立条目」段落 → 补卡。

## 4. 数据溯源

- **来源**：现场 `dl-imported-list` 17 条 json（时间戳同批 16:52:00）→ 前端 `directImport`（`import-queue.ts` `isImportableFile` 分流前为 `isSupportedFile` 扩展名放行）→ `shouldEnterForm` 仅 `ysm.json` 进表单。
- **结果**：`isSupportedFile`（`ALL_EXTS` 含 `.json`，`extensions.ts:9`）→ 全部 `.json` 放行 → 非 `ysm.json` 走 `directImport` 落库；`ysm.json` 走表单。与 Go `ScanEntries` 白名单形成口径分裂。
- **修复链路**：新增 `isImportableFile`（前端，base name 级）→ 替换 8 处调用点 → 后端 `ImportFromBase64` + `importModelFileWithSubpath` 同款白名单 → 测试覆盖（`dnd-shared.test.ts` 6 例 + `importer_file_test.go` `TestImportFromBase64_JsonWhitelist`）。
- **D3 深究补充来源**（2026-08-05 深究盘点，行号为当时实证位置）：`internal/app/resource_bindings.go:314/319`（`DeleteResourcePack` vs `DeleteModelDir` 删除双轨，**遗留**）、`go/fileops/fileops.go:315`（`ToggleModelEnable` 单文件 `.ban`，现状 357 行，语义正确保留）、`frontend/src/core/menu-defs.ts:93-99`（目录行菜单缺 `dir.move`/`dir.copy`，**已修复**：现 96/97 行）、`frontend/src/core/context-menus.ts:235`（`file.rename` 无 `ysm.json` 特判，**已修复**：现 235 行开头）、`go/recycle`（`List` 拆散整组，现状 recycle.go:129，**遗留**）。

<!-- 文件名: ysm-folder-model-contract.md → 实际文件 ADR-038-ysm-folder-model-contract.md -->
