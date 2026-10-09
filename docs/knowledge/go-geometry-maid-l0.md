---
kind: go-geometry-maid-l0
name: 女仆包 L0 清单收集与解析（maid_l0 分片）
tier: leaf
category: go
status: active
source_files:
  - go/geometry/maid_l0_manifest.go
  - go/geometry/maid_l0_resolve.go
use_when:
  - maid-model
  - maid_model.json
  - L0 清单
  - model_id
  - 多命名空间
quick_groups:
  - 模型扫描与仓库管理
quick_intents:
  - maid-model 包 L0 清单与命名空间选择
  - model_id 推断 / 候选路径字典
  - collectMaidManifest / resolveL0 流水线
quick_risk_lines:
  - 「最长清单即主包」启发式与 L0 未命中回退全量枚举兜底是互相锁定的口径，勿松动命中判定
pitfalls:
  - resolveL0 命中判定以「清单至少命中 1 个模型」为准（零命中 = 清单与 zip 内容脱节，回退全量枚举兜底），勿按清单非空判 hit
  - resolveL0Model / resolveL0Texture 返回值必须是小写 zip 内绝对路径（entryByPath 键全小写），返回 e.Name() 原始大小写会让主循环重查 miss、大写条目纹理静默丢弃
last_verified: 2026-10-09
---

# 女仆包 L0 清单收集与解析（maid_l0 分片）

## 概览

`go/geometry` 女仆包（TLM maid-model）L0 清单子域的两个分片文件，系 2026-10 文件行数治理自 maid_l0.go 拆出：`maid_l0_manifest.go` 负责「清单收集与候选选择」（命名空间发现、清单结构解析、最长清单启发式），`maid_l0_resolve.go` 负责「清单条目解析」（模型/纹理路径推断与物化进 `l0Resolved`）。L0 = `maid_model.json` 权威清单，与一级兜底（zip 内 `.json` 全量枚举 + 文件名排序）分层；L0 命中时 geo/png/声明序全部从清单派生，多余文件（junk_geo、外来命名空间内容）一律丢弃，避免顺序/纹理绑定被污染。清单分层与两种条目形式（(a) 完整路径 / (b) model_id）的文档在 `archive_parse.go` 头注释，流水线位置见 [go-geometry-archive-pipeline](./go-geometry-archive-pipeline.md)。

## 核心职责

- `maid_l0_manifest.go` — 收集与候选选择：
  - `collectMaidManifest` 遍历所有 `*/maid_model.json`，解析出候选（`maidNsCandidate`：命名空间前缀含尾部 `/` + 清单 + 条目数），经 `selectBestMaidCandidate` 选「清单最长者」为真正命名空间（「最长清单即主包」启发式——一个 zip 内可能并存致谢清单与主包清单等多份 maid_model.json）；无清单时返回（空 ns、nil manifest）
  - `parseMaidModelJSON` 解析 TLM 真实格式（顶层 / pack / chair / decor 四处分组，`maidGroupWrapper` 两种清单格式 `model[]` 与 `model_list[]`）与自定义简化格式，`pickBestMaidGroup` 取条目更多者；路径段数不足三段的条目不是命名空间清单，直接弃
  - `l0Resolved` 结构声明与「覆盖判定不对称」现状红线注释（geoFiles 等覆盖看 `hit`，SubModels 分支只看清单非空，重构不得顺手统一）
- `maid_l0_resolve.go` — 条目解析：
  - `resolveL0` 主循环只做调度（建路径索引 → 实例化懒 basename 索引 → 算 nsBase → 预分配 + 调子函数），manifest 为空返回零值但 `resolvedPathByItem` / `texNameByItem` 两 map 保证非 nil
  - `l0ResolveModel` / `l0ResolveTexture` 三段 fallback 链（严格对称）：形式 A 显式路径（经 `l0StripNsPrefix` 处理 `droneeee:models/entity/x.json` 类混合写法）→ model_id 候选路径字典（`l0ModelCandidates` / `l0TextureCandidates` 按真实包常见度排序，`l0TryCandidates` 找到第一个存在的 zip entry 即停）→ basename 模糊回扫（`l0BasenameIndex` 懒构建）
  - `l0ExtractName` 从 `ns:name` 取 name 部分；`applyL0ManifestItem` 物化单条解析结果（Open→Read→append，ARM 模型经 `IsArmModelName` 排除，texNames 取 basename 去扩展名）

## 对外 API / 入口

- 包内调用：`collectMaidManifest`（由 `archive_parse.go|parseModelFromEntries` 在 ysm.json 解析前调用）与 `resolveL0`（清单先行判定——命中只补收动画字符串，不物化 geo/png，省掉旧实现「白付一次全量 IO+内存后再丢弃 + 重读一遍」的开销）
- 无导出 API；L0 子域的输出 `l0Resolved`（geoFiles/pngs/modelOrder/texOrder/texCategories + `resolvedPathByItem` / `texNameByItem` 两 map）由下游 `archive_merge.go|buildSubModels` 消费（SubModel.SourcePath 用实际解析到的 zip 路径，TexSlot 用排序后槽位换算）

## 与其他子系统关系

- 消费方：`archive_parse.go|parseModelFromEntries` 的 L0 命中 / 未命中分支（命中走 `collectAnimEntriesOnly` 只补动画；未命中走全量 `collectMergedFiles`）
- 同域兄弟：`maid_l0.go`（[go-geometry](./go-geometry.md) 认领）提供 `collectAnimEntriesOnly` 与 `l0BasenameIndex`；本卡两文件与它共同构成 L0 子域
- 数据依赖：`go/container` `Entry`（zip 条目枚举）、`go/fsutil` `ReadLimitedEntry`（单文件读取上限）
- 前端链：L0 SubModels 支撑多合一女仆包的角色切换（subPath 见 [go-geometry-archive-pipeline](./go-geometry-archive-pipeline.md) 的 `ParseFrom*Entry`）

## 不变量

- 命中判定：只有清单至少命中 1 个模型才置 `hit`（空命中 = 清单与 zip 内容脱节，回退全量枚举兜底）；命中时 `texCategories` 同步重建为统一 `"player"`——L0 清单纹理全为主模型皮肤，不重建则分类仍对应 ysm 派生旧 texOrder，重排会错位
- 大小写口径：`l0BuildPathIndex` 的键是 `strings.ToLower(e.Name())`，故 `l0ResolveModel` / `l0ResolveTexture` 返回路径必须小写；主循环 `entryByPath[texAbs]` 重查 miss 会让大写条目纹理静默丢弃
- 确定性：basename 回扫多命中时候选收集后按字典序取最小（`sort.Strings`）——map 迭代序随机，直接取 range 首个命中会让同一输入不同运行绑到不同纹理（与 `resolveComponentTexName` 的确定性修复同口径）
- 日志口径分叉：manifest 条目 Open 失败（真 I/O 故障）补日志——静默吞掉会让损坏包难排障；条目缺席（entryByPath miss，清单路径缺失属正常可预期落空）保持静默——逐条 log 会刷屏，两者勿混
- `selectBestMaidCandidate` 空切片保护（返回零值不 panic）；`applyL0ManifestItem` 物化行为逐字节保持原循环（Open 失败静默跳、空 buf 跳、ARM 排除、texNameByItem 小写）

## 相关

- [go-geometry](./go-geometry.md) — 包级 L0 清单分层文档与大小写口径红线
- [go-geometry-archive-pipeline](./go-geometry-archive-pipeline.md) — 流水线主体与 L0 命中 / 回退分叉点
- [app-content-diagnostics](./app-content-diagnostics.md) — maid-model 包 `.zip` 走同一 L0 清单的 CLI 分析链路登记
