# 开发笔记

## 常见陷阱

1. **Wails 热重载**：前端 HTML/CSS/JS 修改实时生效；Go 端修改需 `wails dev` 重启
2. **全局变量冲突**：所有 JS 文件共享全局作用域，注意同名变量（`syncing`、`buildTree` 等）
3. **PowerShell 转义**：在 PowerShell 中修改 JS/Go 文件时，双引号、反引号、`$` 需要特别注意
4. **UTF-8 无 BOM**：所有文件必须用 `[System.IO.File]::WriteAllText($path, $content, $utf8NoBom)` 写入
5. **加载顺序**：`state.js` → `parse.js` → `tree.js` → `dialogs` → `ui` → `core/theme` → `core/directories` → `versions` → `sync.js` → `core/lifecycle` → `core/buttons`
6. **`localStorage` vs 磁盘配置**：新装用户 `ysm_config.json` 不存在，回退 `localStorage`；两者都无则自动检测

## 推荐工作流

1. 修改前端 JS → 刷新浏览器即可（Wails dev 模式）
2. 修改 Go 端 → 关闭窗口 → 重新执行 `wails dev`（对于新增的 Wails Binding，需先运行 `wails generate module` 或重启 `wails dev` 自动生成）
3. 修改 HTML/CSS → 刷新浏览器即可
4. 重大重构后清浏览器缓存（`Ctrl+Shift+R`）

---

## 🐛 已知问题（历史）

- ~~Wails 窗口关闭后 `localStorage` 可能丢失（已修复：磁盘 JSON 持久化）~~
- ~~Go 端 `IsYSMJar` 不支持 `neoforge.mods.toml`（已修复）~~
- ~~`sync.js` 的 `syncing` 变量与 `state.js` 重复声明（已修复）~~
- ~~`ClearCustomDir` 跨分区回收失败（已修复：符号链接/硬链接直接删除，跨分区直接删除）~~
- ~~`btn-sync-all` 调用不存在的 `SyncModelToggleStatus`（已修复）~~
- ~~JS 文件拆分后缓存导致旧引用（已修复：版本戳 `?v=...`）~~
- ~~CSS 变量 `--sidebar-width`/`--preview-width` 缺失（已修复：添加到 `variables.css`）~~
- ~~侧栏折叠后 overflow 不回弹（已修复：展开时恢复 `auto`）~~
- ~~文件夹展开状态未持久化（已修复：点击时写入 `localStorage`，重建时恢复）~~
- ~~新建文件夹 / 移动文件需新增 Go 端 Binding（已添加 `CreateDir`、`MoveModelFile`）~~

## 2026-06-05 新增笔记

### Go 特别注意

| 陷阱                      | 说明                                                                      |
| ------------------------- | ------------------------------------------------------------------------- |
| **shutdown 必须 recover** | `WindowGetSize()` 在 Wails 关闭时可能 nil panic，始终加 `defer recover()` |
| **RE2 无前瞻/后顾**       | `regexp.MustCompile` 遇到 `(?!` `(?<=` 会 panic，用简单字符串函数替代     |
| **CSV 编码灾难**          | Go `encoding/csv` + Windows = 中文/Emoji 全毁，JSON 无此问题              |
| **os.Executable() 路径**  | 配置文件路径基于 exe 目录，`wails dev` 和编译后的 exe 目录不同            |

### 前端特别注意

| 陷阱                     | 说明                                                                  |
| ------------------------ | --------------------------------------------------------------------- |
| **fetch 永远加超时**     | `new AbortController()` + 6s `setTimeout`，浏览器默认 30~90s 太慢     |
| **内层 vs 外层窗口尺寸** | `window.innerWidth` 是内容区，Go `WindowGetSize()` 是包含标题栏的外层 |
| **反斜杠路径**           | Windows `\` 只限本地，传给 URL 必须 `replace(/\\/g, "/")`             |
| **button 状态区分**      | ⏳=加载中，❌=已确认失败，✅=完成，不要混用                           |

### 配置文件的存储位置

所有配置文件在 `os.Executable()` 同目录：

- `ysm_config.json` — 应用配置（repoRoot, mcRoot, linkMode, theme）
- `workshop_sites.json` — 创意工坊站点定义
- `workshop_creators.json` — 创作者列表（单 JSON 文件）
- `window_state.json` — 窗口位置/大小
- `ysm-import-logs.json` — 导入操作日志

### 本地仓库索引生成流程

```
GenerateRepoIndex(repoRoot)
  → 递归扫描 repoRoot 下所有 .ysm/.zip/.7z 文件
  → 文件名解析 [作者]【品牌】角色_变体_年月.扩展名
  → 写入 {name, path, size, hash, author} 到 index.json
  → commit + push 到 GitHub → 在线浏览生效
```

index.json 格式：

```json
[
  {
    "name": "[Almeta_owx]【ATRI】亚托莉2025-08.ysm",
    "path": "Almeta_owx/[Almeta_owx]【ATRI】亚托莉2025-08.ysm",
    "size": 561630,
    "hash": "sha256-xxxx",
    "author": "Almeta_owx"
  }
]
```
