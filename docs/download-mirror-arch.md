# 下载镜像架构

> 2026-06-06 定稿。解决国内网络环境下 GitHub raw CDN 不稳定问题。

## 🏁 最终架构：策略模式

### 1. 设置页（前端）

用户选择一个**策略模式**，而不是具体的 URL。

| 设置              | 含义       | 加载 index.json       | 下载 .ysm             |
| ----------------- | ---------- | --------------------- | --------------------- |
| 🌍 **直连**       | 优先官方源 | `raw` → `jsd` → `api` | `raw` → `jsd` → `api` |
| ⚡ **jsDelivr**   | 优先 CDN   | `jsd` → `raw` → `api` | `jsd` → `raw` → `api` |
| 🐙 **GitHub API** | 优先接口   | `api` → `raw` → `jsd` | `api` → `raw` → `jsd` |

### 2. 三层回退

无论选哪种策略，三个源都会尝试，只是顺序不同：

```
raw:      https://raw.githubusercontent.com/{owner}/{repo}/main/{path}
jsd:      https://cdn.jsdelivr.net/gh/{owner}/{repo}@main/{path}
api:      https://api.github.com/repos/{owner}/{repo}/contents/{path}
```

### 3. 前端职责

- `tryFetchModels(mirror)` — 加载 index.json（纯前端 fetch，按策略排序）
- `showRepoModels()` — 读取 `cfg.mirror`，传给下载按钮的 `data-url`（仅 jsDelivr 时改前缀，其余情况走 raw，Go 端内部再按策略回退）

### 4. Go 端职责

`DownloadFromGitHub(rawURL, saveDir)`:

1. 从 raw URL 提取 `owner/repo` 和 `relPath`
2. 读取 `a.LoadAppConfig().Mirror` 获取策略
3. 按策略顺序尝试三个源
4. 任一成功即返回，全部失败返回错误

```go
sources := []src{{rawURL, "raw"}, {jsdURL, "jsd"}, {apiURL, "api"}}
// 根据 mirror 重排 sources 顺序
for _, s := range sources {
    err := download(s) // api 走 base64 解码，其余直接 HTTP GET
    if err == nil { return savePath, nil }
}
return "", fmt.Errorf("所有下载源均失败: %s", lastErr)
```

### 5. 铁律

1. **`index.json` 必须放在 Repo 根目录**（用于 jsDelivr 加速列表加载）
2. **`.ysm` 文件放在 Git 仓库目录中**（不在 Releases 里，因为 jsDelivr 不能加速 Releases Asset）
3. **Go 端根据 `mirrorMode` 自行拼接 URL**，前端只传 `repo` 和 `path`
4. **API Base64 适用于 ≤ 10MB 的文件**，YSM 模型（200KB~3MB）完全在安全范围内

### 6. 标题栏标签

| 标签    | 含义                                               | 颜色 |
| ------- | -------------------------------------------------- | ---- |
| `raw`   | index.json 来自 raw.githubusercontent.com          | 蓝   |
| `⚡jsd` | index.json 来自 cdn.jsdelivr.net                   | 橙   |
| `API`   | index.json 来自 api.github.com                     | 绿   |
| `⚡CDN` | 下载文件优先走 jsDelivr（设置中选了 jsDelivr）     | 橙   |
| `🐙API` | 下载文件优先走 GitHub API（设置中选了 GitHub API） | 绿   |
