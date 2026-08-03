---
kind: go_tags
name: 标签系统 go/tags
tier: architecture
category: go
source_files:
  - go/tags/tags.go
use_when:
  - 标签
  - tag
  - 分类
  - 筛选
  - tag-editor
---

# 标签系统 go/tags

## 概览

`go/tags/` 包提供模型标签的线程安全持久化存储，是前端 tag-editor 弹窗的后端。标签存放在配置目录的 `tags.json`，以文件绝对路径为 key、标签列表为 value，与模型文件本身解耦（移动/链接模型不污染文件内容）。

## 核心职责

- `tags.go` — Store 的懒加载、增删改查、按标签反查路径、标签热度统计

## 对外 API / 入口

- `NewStore(configDir string) *Store` — 创建存储（懒加载：首次 Get/Set 时才读盘）
- `(*Store) GetTags(modelPath string) ([]string, error)` — 返回指定路径的标签（已排序的副本；无标签返回空切片）
- `(*Store) SetTags(modelPath string, tags []string) error` — 覆盖写入（自动 trim/去重/排序；空列表删除该条目）并落盘
- `(*Store) AddTag(modelPath, tag string) error` — 追加单个标签（已存在则跳过）
- `(*Store) RemoveTag(modelPath, tag string) error` — 移除单个标签（无变化则不落盘）
- `(*Store) ListByTag(tag string) ([]string, error)` — 反查打了该标签的所有文件路径（排序）
- `(*Store) AllTags() ([]string, error)` — 所有被使用的标签，按使用次数降序、同名按字典序

## 与其他子系统关系

- 被 `internal/app/app_tags.go` 持有（`getTagsStore()` 懒初始化）并经 Wails binding 暴露给前端 `dialogs/tag-editor`
- 被 `internal/app/app_scan.go` 调用：扫描时为每个条目计算 `HasTags` 标记
- 无第三方依赖（纯标准库）

## 不变量

- `sync.RWMutex` 保护：读用 RLock、写用 Lock；`load()` 以 `s.data != nil` 守卫保证只加载一次
- 标签统一 `TrimSpace`，空白标签被丢弃
- `SetTags` 每次写后都落盘（JSON 缩进格式），`GetTags` 返回副本防外部篡改

## 相关

- [wails_bridge](./wails_bridge.md) — 标签 binding 入口
- 前端 `frontend/js/dialogs/tag-editor/` — 标签编辑弹窗
