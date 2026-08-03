# ADR-025: 工坊下载镜像回退架构

- **状态**：✅ 已采纳
- **日期**：2026-08-04（原方案 2026-06-06 定稿）
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`internal/app/app_download.go`（`DownloadFromGitHub` 镜像回退）/ `frontend/js/features/community/download-queue.ts` / 原 `docs/archive/design/download-mirror-arch.md`（已迁本 ADR）

---

> 决策真相源：本 ADR。原 `docs/archive/design/download-mirror-arch.md` 已于 2026-08-04 迁为本 ADR，原文降级为重定向 stub。

## 背景

国内网络环境下 GitHub `raw.githubusercontent.com` CDN 不稳定，导致从 GitHub 仓库加载模型 `index.json` 与下载 `.ysm` 资源频繁失败。需一套可切换、自动回退的下载源策略，而非在代码里硬编码单一 URL。

## 决策

采用**策略模式 + 三层回退**的下载镜像架构：

### 1. 用户选策略，而非 URL

设置页提供三种策略，决定三个源的尝试顺序：

| 策略 | 含义 | index.json 顺序 | 下载 .ysm 顺序 |
|------|------|----------------|----------------|
| 🌍 直连 | 优先官方源 | `raw` → `jsd` → `api` | `raw` → `jsd` → `api` |
| ⚡ jsDelivr | 优先 CDN | `jsd` → `raw` → `api` | `jsd` → `raw` → `api` |
| 🐙 GitHub API | 优先接口 | `api` → `raw` → `jsd` | `api` → `raw` → `jsd` |

### 2. 三层回退（与策略无关）

无论选哪种策略，三个源都会尝试，仅顺序不同：

```
raw:  https://raw.githubusercontent.com/{owner}/{repo}/main/{path}
jsd:  https://cdn.jsdelivr.net/gh/{owner}/{repo}@main/{path}
api:  https://api.github.com/repos/{owner}/{repo}/contents/{path}
```

### 3. 职责划分

- **前端**：`tryFetchModels(mirror)` 按策略排序加载 `index.json`；下载按钮仅传 `repo` + `path`，前端不做 URL 拼接。
- **Go 端**：`DownloadFromGitHub(rawURL, saveDir)` 从 raw URL 提取 `owner/repo` 与 `relPath`，读 `Mirror` 配置按策略重排三个源，**任一成功即返回，全部失败才报错**（`api` 源走 base64 解码，其余直接 HTTP GET）。

### 4. 铁律（仓库组织约束）

1. **`index.json` 必须放在 Repo 根目录**（供 jsDelivr 加速列表加载）。
2. **`.ysm` 文件放在 Git 仓库目录中**（不在 Releases —— jsDelivr 不加速 Release Asset）。
3. **Go 端根据 `mirrorMode` 自行拼接 URL**，前端只传 `repo` 和 `path`。
4. **API Base64 适用于 ≤ 10MB 文件**；YSM 模型（200KB~3MB）完全在安全范围内。

### 5. 来源指示

标题栏标签明示当前源（`raw` 蓝 / `⚡jsd` 橙 / `API` 绿 / `⚡CDN` 橙 / `🐙API` 绿），提升可观测性。

## 后果

### 正面

- ✅ 国内网络下下载稳定性显著提升，策略可热切换、回退全自动。
- ✅ 前端零 URL 拼接逻辑，Go 端单一职责收敛。

### 负面 / 约束

- ⚠️ 强约束仓库组织：`index.json` 必须根目录、资源必须在仓库非 Release——任何接入的 GitHub 仓库须遵守，否则回退失效。
- ⚠️ `api` 源受 GitHub API 速率限制，需 base64 解码路径（≤10MB）。

### 数据溯源

- 原 `docs/archive/design/download-mirror-arch.md`（2026-06-06 定稿）。
- 现行实现：`internal/app/app_download.go:50-64`（入队 + `Event.Emit("queue:status")` + `DownloadFromGitHub` 镜像回退）、`frontend/js/features/community/download-queue.ts:139-142`（`EnqueueDownloads`）。
