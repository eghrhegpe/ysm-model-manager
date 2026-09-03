# ADR-172：社区创作者增量合并下沉 Go——新增 MergeCommunityCreatorsFromJSON 单次原子并入 binding

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-03
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：ADR-003（逻辑下沉精神祖先）、ADR-040（前端拆分与 internal 下沉）、ADR-053（网页桥边界）、ADR-071（网页版社区能力补齐）

---

## 1. 背景（Context）

社区创作者增量合并（自动拉取 `DEFAULT_COMMUNITY_URL` 索引并入本地 creators）存在两条 TS 侧写回路径：

- **自动合并** `community-data.ts tryAutoMergeCommunity`：拉社区 → TS `mergeCommunityCreators` 并入会话副本 → 前端 `siteMap` 分组 / `kept` 过滤 / `dedupeCreators` 重建 → `SaveWorkshopCreators` 整存。
- **手动同步按钮** `site/edit.ts`：TS `mergeCommunityCreators` 并入 UI 会话态 → 整存。

两条路径的合并/去重派生（name 唯一、type 分号段并入、站点分组过滤）全部落在 TS，写回由 TS 派生结果驱动——触碰 AGENTS.md「Go 派生结果只读」红线（锐评复核 2026-09-03 判定 ⚠️ 半成立，降级为 P2-P3 债务，本 ADR 根治）。

历史：2026-08-16 审核为规避「前端逐站循环调 `SaveWorkshopCreatorsBySite` N 次的跨调用部分提交」，选择前端一次合并 + 单次整体保存（原子）。修法方向对，但把全套派生搬进 TS 是选错了边——Go 侧 `SaveWorkshopCreatorsBySite` 内部本就是单次 Load→过滤→原子写，真正缺的是一个「多站点原子并入」入口。

Go 侧基座已齐：`inTypeSegments` 分号段精确匹配（app_workshop.go:178，R22 P3-1 词边界范式）、`SaveWorkshopCreators` 原子写、`MergeWorkshopCreatorsFromJSON`（全量导入先例，含备份 + 完整性校验）、`BackupWorkshopCreators`。

## 2. 决策（Decision）

新增 Go binding **`MergeCommunityCreatorsFromJSON(communityJSON string) (added int, updated int, err error)`**：

1. 解析输入为 `[]WorkshopCreator`（前端社区拉取结果直传，不重算）；
2. `BackupWorkshopCreators()` 备份（与 `MergeWorkshopCreatorsFromJSON` 同构，用户拍板带备份）；
3. `LoadWorkshopCreators()` 取磁盘最新全量（不依赖前端可能 stale 的会话副本）；
4. 逐条并入：name 命中 → desc/role 空补、type **分号段并入**（Go 化 `mergeTypeSegments`，新增段 append，防社区侧新增站点被覆盖丢失）；未命中 → append 并计数；
5. 单次 `SaveWorkshopCreators` 原子写（一次 Load→并入→写，无跨调用部分提交窗口）。

与既有 `MergeWorkshopCreatorsFromJSON`（手动全量导入，drag.ts 消费）**刻意区分**：

| 维度 | MergeWorkshopCreatorsFromJSON | MergeCommunityCreatorsFromJSON |
|------|------------------------------|-------------------------------|
| 场景 | 用户拖放导入仓库全量索引 | 社区索引增量自动/手动并入 |
| type 冲突 | **覆盖** | **分号段并入**（不丢站点） |
| 条数硬校验 | ≥20 导入 / 合并后 ≥100 回滚 | 无（纯增不改，小库用户可合并） |
| 备份 | 有 | 有（同构） |

前端改造：自动合并路径删除 `siteMap`/`kept`/`dedupeCreators` 写回重建整链，拉取后直传 JSON；手动同步按钮改调新 binding 落盘，`mergeCommunityCreators` 纯函数保留仅作 UI 即时展示（展示派生不驱动持久化）。网页版 web-community.ts 补同名桥（localStorage 覆盖层 + 模块级串行队列防 lost update，语义与 Go 对齐）。

## 3. 后果（Consequences）

正面：

- 红线解除：写回派生（去重/分组/段并入）全部归 Go，前端只传拉取结果、消费返回计数。
- 原子性：跨调用部分提交窗口关闭（N 次 BySite 循环 → 1 次原子并入）。
- 一致性：磁盘并入基于 Load 最新全量，不再被前端 stale 会话副本覆盖并行修改。
- 桌面/网页版语义同源（同 binding 名 + 契约测试锁定）。

负面/已知遗留：

- web 桥多一个 binding 维护面（有 contract-b2 契约测试兜底）。
- TS 保留 `mergeCommunityCreators` 一份展示合并逻辑——接受：仅内存 UI 反馈，不驱动写回，改动面最小。
- `dedupeCreators` / `mergeTypeSegments` 在 TS 写回链删除后若失去消费方则一并删除（实施时按真实引用裁决）。
- 备份产生时间戳 `.bak` 堆积（与 Merge 先例同，独立治理项，不阻塞本 ADR）。

## 4. 数据溯源

本地创作者（`LoadWorkshopCreators`，用户配置根 creators.json，bundled 兜底）← 并入 ← 社区索引（`DEFAULT_COMMUNITY_URL` 三路回退拉取，6h TTL）→ `MergeCommunityCreatorsFromJSON` → 备份 + 单次 `SaveWorkshopCreators`（`fsutil.WriteFileAtomic`）→ 返回 `(added, updated)` 供前端计数提示。网页版同构：bundled JSON 默认 + localStorage 覆盖层，无 Go 原子写，靠模块级串行队列防 lost update。

<!-- 文件名: merge-community-creators-go.md → 实际文件 ADR-172-merge-community-creators-go.md -->
