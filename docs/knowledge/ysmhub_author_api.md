---
kind: ysmhub_author_api
name: YSM Hub 作者分类与归属
tier: leaf
category: feature
source_files:
  - go/ysmhub/client.go
  - go/cli/ysmhub.go
  - frontend/src/services/ysmhub.ts
  - frontend/src/views/app-content/init-ysmhub.ts
use_when:
  - 接入 YSM Hub 作者分类、作者筛选或模型归属信息
  - 排查作者接口和公开模型浏览的凭据边界
---

# YSM Hub 作者分类与归属

## 概览

YSM Hub 客户端支持作者分类接口和模型列表的作者筛选。公开浏览继续使用无凭据的列表客户端；OAuth 或运行时 Key 只在明确配置时转发。

## 核心职责

- `ListAuthors` 读取 `/authors`，保留站点归属信息。
- `ListModels` 的 `ListOptions.Author` 映射到 `author` 查询参数；`sort=author` 可用于作者排序。
- 前端作者下拉筛选、作者要求、作者主页和本站上传者信息均使用模型响应中的嵌套字段。

## 对外 API / 入口

- CLI：`hub-authors`、`hub authors`。
- 前端：YSM Hub 工具栏作者筛选，选择后重新请求 `hub-models`。
- 模型详情展示 `author` 与 `uploader`，外链仅允许 HTTP/HTTPS。

## 与其他子系统关系

下载仍使用现有 `hub-download` 和当前 `GetRepoRoot("ysm")`；作者接口不触发创作者上传或 external-file 写入。

## 不变量

- 构建注入的公开 Key 不发送给列表、作者或详情请求。
- 未登录用户可以读取公开作者列表；需要权限的模型仍由服务端返回错误。

## 相关

- API 文档：`docs/api-attribution.md`、`docs/api-model-author.md`、`docs/api.md`
- Go client：`go/ysmhub/client.go`
