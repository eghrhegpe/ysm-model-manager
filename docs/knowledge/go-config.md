---
kind: go-config
name: Go 配置单持有点 go/config
tier: leaf
category: go
source_files:
  - go/config/config.go
auto_fields:
  symbols_with_lines:
    - Get:37
    - Provider:21
    - Set:28
  quick_groups:
    - 配置与注册表
  quick_intents:
    - AppConfig、配置加载、配置文件
    - go/config
  quick_risk_lines:
    - 配置必须走 go/config 的 LoadAppConfig 单点加载，禁止在多处各自读配置文件
  pitfalls:
    - 多处读配置 → 值不同步、重启后部分组件用旧配置；必须经 LoadAppConfig
    - 配置项未加默认值 → 缺失时 panic；必须为所有配置项设默认值
  use_when:
    - 改配置注入/阈值逻辑，或消费包读阈值时
quick_groups:
  - 配置与注册表
quick_intents:
  - AppConfig、配置加载、配置文件
  - go/config
quick_risk_lines:
  - 配置必须走 go/config 的 LoadAppConfig 单点加载，禁止在多处各自读配置文件
pitfalls:
  - 多处读配置 → 值不同步、重启后部分组件用旧配置；必须经 LoadAppConfig
  - 配置项未加默认值 → 缺失时 panic；必须为所有配置项设默认值

use_when:
  - 改配置注入/阈值逻辑，或消费包读阈值时
status: active
---

# Go 配置单持有点 go/config

## 概览

运行阈值配置的共享单持有点（ADR-091 D12 收敛）：fileops/logs/download/scanner 原各持一份 `var configFunc func() types.AppConfig` 全局变量（写读无同步、仅靠启动期单线程时序兜底），现收敛到本包 atomic 守卫。

## 核心职责

- `Provider`（函数形配置源）+ `atomic.Pointer` 守卫：启动期注入、运行期任意 goroutine 读取无数据竞争
- 存 provider 函数而非快照：`SaveThresholds` 等运行期写盘后，下一次 `Get` 立即读到新值（ADR-062 行为零漂移）；快照方案需在每个写盘点手动重 Store，少一处即静默鬼影

## 对外 API / 入口

- `Set(fn Provider)` — 注入配置源（nil 清除注入；`internal/app` 启动时调用，取代 4 包各自 `SetConfigFunc`）
- `Get() types.AppConfig` — 返回当前配置；未注入返回零值，消费包回退各自默认常量

## 与其他子系统关系

- `internal/app` — ServiceStartup 注入 provider
- 消费包：fileops / logs / download / scanner（运行期读阈值，不再各留副本）

## 不变量

- nil = 未注入：`Get` 返回零值，不 panic
- 运行期写盘后 `Get` 立即反映新值（无快照鬼影窗口）

## 相关

- ADR-091 D12、ADR-062
