# 废弃别名对照表

> 可 grep 批量替换。格式：`废弃别名 → 推荐标准名`。

## 核心概念

| 废弃别名 | 推荐标准名 | 适用范围 | 备注 |
|----------|-----------|----------|------|
| 模型仓库 / 资源库 | **仓库** | UI / 文档 | 用户配置的 `FilesRoot` 根目录 |
| 整合包实例 / MC 实例 | **整合包** | UI / 文档 | 代码内仍用 `Instance`，UI 不出现 |
| 资源类型名称 | **YSM / MMD / VRC / 材质包 / 光影包 / 蓝图** | 全局 | 不混用"模型""资源" |
| 作者 / artist | **创作者**（UI）/ **author**（代码字段） | UI / 代码 | 创作者频道用"创作者"；文件名解析字段固定 author |
| 安装 / 卸载（仓库） | **启用 / 禁用** | UI / 代码 | 仓库打 `.ban` 后缀 = 禁用 |
| 启用 / 禁用（整合包） | **安装 / 卸载** | UI / 代码 | 整合包物理增删 = 安装卸载 |
| 同步（单向） | **推送 / 拉取** | UI | sidebar 已用"推送/拉取" |
| 元老 | **资历最深 / 最早模型** | UI | 展示最早 10 个模型 |
| 健康度 | **仓库评分 / 质量评分** | UI | 禁用率+重复率加权 |
| 今日推荐 | **每日推荐** | UI | 语感更自然 |

## 代码字段 / 变量

| 废弃别名 | 推荐标准名 | 文件范围 | 备注 |
|----------|-----------|----------|------|
| `cfg.repoRoot` | `cfg.FilesRoot` | Go | v1.6.4 统一 |
| `repoRoot`（JS 变量） | `filesRoot` | 前端 JS | v1.6.4 重构 |
| `window.__*` 全局变量 | 模块 `let` + exported getter | 前端 JS | 见 `CLEANUP_RULES.md` #1 |
| `rtype` 字面量字符串 | `RESOURCE_TYPES` 常量 | 前端 JS | `utils/resource-types.js` |
| `"ysm"` / `"mmd-skin"` 等硬编码 | `RESOURCE_TYPES.YSM` / `.MMD` | 前端 JS | 防拼写错误 |

## 批量替换脚本（PowerShell）

```powershell
# 替换 repoRoot → filesRoot（frontend JS）
$files = Get-ChildItem -Recurse -Filter "*.js" -Path frontend/js
foreach ($f in $files) {
  (Get-Content $f.FullName) -replace '\brepoRoot\b', 'filesRoot' | Set-Content $f.FullName
}

# 替换 cfg.repoRoot → cfg.FilesRoot（Go）
$gofiles = Get-ChildItem -Recurse -Filter "*.go" -Path go
foreach ($f in $gofiles) {
  (Get-Content $f.FullName) -replace '\.repoRoot\b', '.FilesRoot' | Set-Content $f.FullName
}

# 替换废弃 rtype 字面量（需手动确认每个位置）
$jsfiles = Get-ChildItem -Recurse -Filter "*.js" -Path frontend/js
foreach ($f in $jsfiles) {
  (Get-Content $f.FullName) -replace '"ysm"(?!;)', 'RESOURCE_TYPES.YSM' | Set-Content $f.FullName
}
```
