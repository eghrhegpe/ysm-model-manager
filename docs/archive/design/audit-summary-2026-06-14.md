# 全面审计总结 — 2026-06-14

## 范围

本次审计覆盖 YSM Model Manager 项目的**全部 Go 后端代码**（15 个包）、**前端 CSS**（4 个文件）、**前端 JS 基础设施**（所有组件/core/dialogs/utils，约 60+ 文件），以及**项目文件结构整理**。

**审计目标**：安全漏洞、逻辑缺陷、错误处理、并发安全、跨平台兼容性。

---

## 一、严重等级汇总

| 等级        | 数量     | 说明                               |
| ----------- | -------- | ---------------------------------- |
| 🔴 **高**   | 12       | 功能缺陷、安全风险、可能数据丢失   |
| 🟡 **中**   | 16       | 错误处理缺失、平台兼容性、并发问题 |
| 🟢 **低**   | 15       | 代码风格、重复、注释、测试覆盖     |
| 🧹 **清理** | ~20 文件 | 根目录杂物、死代码、临时文件       |

---

## 二、高优先级修复（🔴）

| #   | 位置                                          | 问题                              | 修复                                      |
| --- | --------------------------------------------- | --------------------------------- | ----------------------------------------- |
| 1   | `go/ysm/texsize.go`, `parse.go`, `summary.go` | ZIP 内文件无大小限制 → 炸弹风险   | 全部 `io.LimitReader(rc, N<<20)`          |
| 2   | `go/geometry/archive.go`                      | 10 处 `io.ReadAll(rc)` 无限制     | 全部 LimitReader(50MB)                    |
| 3   | `go/updater/update.go`                        | 解压无路径遍历防护                | `strings.HasPrefix(dest, cleanDir)` 检查  |
| 4   | `go/updater/update.go`                        | 下载无 User-Agent/超时/大小限制   | `http.Client{Timeout:5min}` + LimitReader |
| 5   | `go/updater/update.go`                        | splitVer 忽略预发布后缀           | 切掉 `-beta/+build` 后再比较              |
| 6   | `go/watcher/watcher.go`                       | 解除禁用(.ban→原名)不同步         | 简化事件过滤：任何文件变化都触发          |
| 7   | `go/recycle/recycle.go`                       | Empty 无法清空非空子目录          | 改为 `os.RemoveAll` + 重建                |
| 8   | `go/installer/installer.go`                   | InstallDir 只处理一层子目录       | 重构为递归 `installDirRecursive`          |
| 9   | `go/installer/installer.go`                   | IsValidRepoRoot 仅 Windows 硬编码 | 跨平台重写（Linux/macOS 系统目录）        |
| 10  | `go/importer/importer.go`                     | 无路径清理/遍历防护               | 新增 `sanitizePath`                       |
| 11  | `go/threejs/spec.go`                          | expandBoxUV 负宽度导致纹理镜像    | fw/fh 取绝对值                            |
| 12  | `go/sync/sync.go`                             | computeHash 全文件读取无限制      | LimitReader(100MB)                        |

---

## 三、中优先级修复（🟡）

| #   | 位置                        | 问题                                 | 修复                              |
| --- | --------------------------- | ------------------------------------ | --------------------------------- |
| 1   | `go/ysm/extracted.go`       | WalkDir depth 不递减 → 跨分支错误    | 改用 `filepath.Rel` 计算深度      |
| 2   | `go/ysm/extracted.go`       | 纹理搜索不递归子目录                 | `os.ReadDir` → `filepath.WalkDir` |
| 3   | `go/ysm/header.go`          | tag 匹配大小写敏感                   | `strings.ToLower(tag)`            |
| 4   | `go/ysm/ysm.go`             | IsYSMJar ReadAll 无限制              | LimitReader(1MB)                  |
| 5   | `go/sync/sync.go`           | isFileLocked 只检查 LinkError        | 增加 PathError 检查               |
| 6   | `go/sync/sync.go`           | SyncResources/DirLevel Walk 错误静默 | 全部加 `log.Printf`               |
| 7   | `go/updater/update.go`      | 并发安全（多次调用 InstallUpdate）   | 包级 `updateLock sync.Mutex`      |
| 8   | `go/installer/installer.go` | 并发竞争（安装与同步）               | `installLock` 保护所有入口        |
| 9   | `go/installer/installer.go` | fmt.Printf 污染生产日志              | 全部替换为 `log.Printf`           |
| 10  | `go/installer/installer.go` | 子目录错误静默返回成功               | 聚合错误返回                      |
| 11  | `go/importer/importer.go`   | DirectoryCopyImporter 目录输入错乱   | `os.Stat` 判断文件/目录           |
| 12  | `go/importer/importer.go`   | 目录复制无原子性                     | 临时目录 + rename                 |
| 13  | `go/packs/mcmeta.go`        | 手写 base64Encode                    | 替换为 `base64.StdEncoding`       |
| 14  | `go/packs/mcmeta.go`        | pack.png 无大小限制                  | LimitReader(10MB)                 |
| 15  | `go/logs/logs.go`           | 所有错误被忽略（4 处）               | 全部加 `log.Printf` + fallback    |
| 16  | `frontend/css/*`            | `.light` 类不匹配主题系统            | `.light` → `.theme-warm`          |
| —   | `frontend/css/*`            | theme-pro 白色 accent 不可见         | `#ffffff` → `#66d9ef`             |

---

## 四、低优先级修复（🟢）

| #   | 位置                                       | 修复                                             |
| --- | ------------------------------------------ | ------------------------------------------------ |
| 1   | `go/ysm/texsize.go`, `go/ysm/extracted.go` | Walk 错误加 `log.Printf`                         |
| 2   | `go/threejs/spec.go`                       | `boneIdx` -1 标记 → `boneDone map[string]bool`   |
| 3   | `go/threejs/spec.go`                       | `0.001` 魔法数字 → `const thicknessEpsilon`      |
| 4   | `go/threejs/spec.go`                       | `parseFaceUV` 失败加日志                         |
| 5   | `go/watcher/watcher.go`                    | 防抖 800ms → `const debounceDelay`               |
| 6   | `go/updater/update.go`                     | `os.Remove` 错误加日志                           |
| 7   | `go/recycle/recycle.go`                    | List WalkDir 错误日志                            |
| 8   | `go/recycle/recycle.go`                    | 硬链接 Windows 支持                              |
| 9   | `go/installer/installer.go`                | 重复 `filepath.Abs(filepath.Clean)` → `cleanAbs` |
| 10  | `go/installer/installer.go`                | CopyFile 未 chmod → `os.Chmod(dst, 0644)`        |
| 11  | `go/importer/importer.go`                  | 跳过 `.` 开头文件 → 移除过滤                     |
| 12  | `go/importer/importer.go`                  | copyFileSimple/copyFile 重复 → 合并              |
| 13  | `go/importer/importer.go`                  | copyFile 未 chmod                                |
| 14  | `go/geometry/parse.go`                     | ParseBedrockGeometry 大小检查                    |
| 15  | `frontend/css/*`                           | 硬编码 font-size → 语义化 `--fs-*`               |

---

## 五、根目录文件清理

| 操作                     | 文件                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------- |
| 🗑️ 删除                  | `_binding_add.txt`, `_fix_decode.js`, `commit_msg.txt`, `tool-test.md`                 |
| 🗑️ 删除                  | `project_tree.txt`, `project_tree_lite.txt`                                            |
| 🗑️ 删除                  | `ysm-model-manager.exe`, `ysm-cli.exe`（编译产物）                                     |
| 📦 移入 `scripts/`       | `safe-edit-service.py`, `safe-edit.bat`, `creators.json.bak`, 7 个 build inspect `.py` |
| 📦 移入 `cmd/diag/wasm/` | `wasmcheck.go`                                                                         |
| 🗑️ 删除                  | `frontend/public/js/app-legacy-bundle.js`（死代码）                                    |
| 🗑️ 删除                  | `frontend/js/pages/`（空目录）                                                         |
| 🗑️ 删除                  | `build/` 下测试数据/临时文件                                                           |

---

## 六、遗留待办（非阻塞）

记录在 `docs/pending-cleanup.md`：

1. **下载哈希校验** — 发布脚本生成 SHA256SUMS，Download 后校验
2. **Windows 自更新 helper** — 独立 helper 进程替换运行中 EXE
3. **导入日志文件位置迁移** — EXE 目录 → `os.UserConfigDir()`
4. **CSS `--fs-scale` 迁移 rem** — 尊重浏览器默认字号

---

## 七、已审计但无需修改的文件

| 文件                                                          | 结论                         |
| ------------------------------------------------------------- | ---------------------------- |
| `go/types/types.go`, `resource.go`, `config.go`, `bedrock.go` | 纯数据结构，无问题           |
| `go/version/version.go`                                       | 版本号，无问题               |
| `go/ysm/cli.go`                                               | CLI 查找，无问题             |
| `go/ysm/header_test.go`                                       | 测试，无问题                 |
| `go/recycle/recycle_test.go`                                  | 测试，已补充子目录场景       |
| `go/errors/errors.go`                                         | 已小修（保留原始错误上下文） |
| `frontend/wailsjs/go/models.ts`, `App.js`, `App.d.ts`         | Wails 自动生成，不修改       |
| `main.go`                                                     | 入口点，无问题               |
| `cli_export.go`                                               | CLI 工具，无问题             |

---

## 八、整体统计

- **文件修改**：~40 个 Go 源文件、4 个 CSS 文件
- **删除文件**：~15 个根目录/前端/build 杂物
- **新增文件**：1 个（`docs/audit-summary-2026-06-14.md`）
- **测试**：全部通过（`go build ./go/...` + `go test ./go/...`）
- **前端构建**：通过（`npx vite build`）
