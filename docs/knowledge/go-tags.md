---
kind: go-tags
name: 标签系统 go/tags
tier: architecture
category: go
source_files:
  - go/tags/tags.go
  - go/tags/
use_when:
  - 标签
  - tag
  - 分类
  - 筛选
  - tag-editor
invariant_anchors:
  - go/tags/tags.go|fsutil.WriteFileAtomic
  - go/tags/tags.go|.corrupt
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

- `sync.RWMutex` 保护：读用 RLock、写用 Lock；`load()` 以 `s.data != nil` 守卫保证只加载一次。**JSON `null` 内容守卫破口已封**（P3 修复：Unmarshal 成功但内容恰为 `null` 时 m 为 nil map → 现补 `if m == nil { m = make(...) }`，防每次 Get/Set 重复整文件读盘）
- 标签统一 `TrimSpace`，空白标签被丢弃
- `SetTags` 每次写后都落盘（JSON 缩进格式，**tmp + `os.Rename` 原子替换**，rename 失败清理 tmp；`TestSaveLeavesNoTmp` 守护）；`GetTags` 返回副本防外部篡改
- **损坏恢复**：tags.json 解析失败 → 备份 `.corrupt`（保留现场）→ 重建空存储（读路径恢复 + 写路径自我修复，`TestCorruptFileRecovers` 守护）——第 4 批修复，知识卡原卡未记载已补
- P3 观察：`save()` 失败（磁盘满/权限）时内存已变更、磁盘未更新，属「内存优先、落盘尽力」契约（调用方拿到 error 但 GetTags 读到新值，进程崩溃则上次写丢失）；`ListByTag` 空 tag 返回 nil 与 GetTags 的 `[]string{}` 约定不一致（P4）

## 相关

- [wails_bridge](./wails-bridge.md) — 标签 binding 入口
- 前端 `frontend/src/dialogs/tag-editor/` — 标签编辑弹窗
