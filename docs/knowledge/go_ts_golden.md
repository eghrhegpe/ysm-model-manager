---
kind: go_ts_golden
name: Go-TS 解析层 golden 对拍（ADR-154 双端互锁）
tier: architecture
category: go
source_files:
  - go/types/parity_zipentry_test.go
auto_fields:
  symbols_with_lines:
    - TestParity_MatchZipEntry:41
use_when:
  - TODO
# 解法 B：人工策展字段（手写，drift 仅 WARN）
pitfalls:
  - TODO
quick_groups:
  - TODO
quick_intents:
  - TODO
quick_risk_lines:
  - TODO
# 解法 B：invariant_anchors 混合字段（手写声明 + 机器校验）
invariant_anchors:
  - go/types/parity_zipentry_test.go|TODO
---

# Go-TS 解析层 golden 对拍（ADR-154 双端互锁）

## 概览

TODO

## 核心职责

TODO

## 对外 API / 入口

TODO

## 与其他子系统关系

TODO

## 不变量

TODO

## 相关

- TODO
