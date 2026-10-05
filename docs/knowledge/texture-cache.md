---
kind: texture-cache
name: 纹理缓存 texture_cache
tier: leaf
category: go
status: active
source_files:
  - go/texture_cache/texture_cache.go
auto_fields:
  symbols_with_lines:
    - CacheDir
    - CacheEntry
    - CachePath
    - CacheStats
    - ClearCache
    - GetCacheStats
    - HasCached
    - ListCacheFiles
    - Prune
    - PruneResult
    - ReadCached
    - SetCacheLimits
    - SetShutdownCtx
    - TextureHash
    - WriteCached
tests:
  - go/texture_cache/texture_cache_test.go
  - go/texture_cache/texture_cache_prune_test.go
invariant_anchors:
  - go/texture_cache/texture_cache.go|WriteCached
use_when:
  - 纹理缓存 / KTX2 缓存
  - 缓存清理 / 缓存状态 / 缓存校验
  - 缓存占用异常 / 磁盘膨胀
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - 纹理缓存、KTX2 缓存
  - 缓存清理、cache-clear
  - 缓存状态、cache-status / cache-verify
quick_risk_lines:
  - 缓存键 = 内容哈希（TextureHash），改哈希口径旧缓存全体失联；TTL 与容量裁剪（Prune）在写入路径触发，改淘汰策略须同步 prune 测试矩阵
pitfalls:
  - 缓存目录位置经 CacheDir 推导，清理一律走 cache-clear CLI，不手删目录
---

# 纹理缓存 texture_cache

## 概览

`go/texture_cache` 是模型纹理的磁盘缓存层：源纹理按内容哈希（`TextureHash`）落盘为 KTX2 缓存条目，二次加载直接读缓存，避免重复转码。容量与 TTL 双约束，写入路径自动触发裁剪（Prune）。

## 核心职责

- **哈希寻址**：`TextureHash(path)` 内容哈希 → `CachePath(hash)` 定位缓存条目；内容不变即命中，与源路径无关。
- **读写**：`WriteCached` / `ReadCached` / `HasCached`；写入成功后触发 Prune（TTL 过期 + 容量超限删最旧，见 `texture_cache_prune_test.go` 测试矩阵）。
- **运维三命令**：`cache-status`（统计，走 `GetCacheStats` / `ListCacheFiles`）、`cache-verify`（校验）、`cache-clear`（清理，走 `ClearCache`）。

## 不变量

- 缓存键只由内容哈希决定，禁止引入路径/时间等附加维度（否则同纹理多副本、缓存命中率失真）。
- 淘汰只发生在写入路径的 Prune，读路径永不删除（避免并发读时文件消失）。

## 与其他子系统关系

- 上游消费方：模型加载链路（纹理上传前的转码产物落缓存）。
- CLI 运维命令注册在 `go/cli/`（`cache-status` / `cache-verify` / `cache-clear`）。

## 相关

- AGENTS.md「工具口令」表：缓存问题 = `texture_cache` 包 + `cache-status`/`cache-verify`，清理走 `cache-clear`
