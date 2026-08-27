---
name: "go-package-review"
description: "Go包代码评审：包结构/惯用Go/命名/坏味道/测试覆盖五维审查 + 本仓专项清单，中文紧凑输出，只读不改码。Invoke when 用户说「评审 go/xxx 包 / Go 代码评审代理 / 整包过一遍 / Go 端能力一览」。"
---

# Go 包评审

## 铁律
只研究、绝不改文件。全程只读工具；改动另起任务。

## 流程
1. 先跑治理工具（`check-redlines` / `type-consistency` / `binding-check`），人工评审聚焦工具覆盖不到的：超长函数、重复代码、语义问题。
2. LS go/ 确认真实目录（包名拼写可能不准，以 LS 为准，如 go/path 实为 paths）。常用命令：
```bash
$ for d in go/*/; do files=$(ls "$d"*.go 2>/dev/null | wc -l); loc=$(cat "$d"*.go 2>/dev/null | wc -l); echo "$d $files files, $loc LOC"; done
```
3. 整仓评审时按 ~10k LOC 配平分批并行子代理（超大包如 cli/litematic 单独成组）；单包评审直接通读 .go 源码（抽查 _test.go）。子代理提示词必须含「只做研究、绝不修改任何文件」。
4. 子代理若只回评分表或元对话，追问一次「补交报告正文，不重读文件」，不重跑。
5. 五维 + 本仓专项 → 按模板输出。

## 五维
| 维度 | 要点 |
|---|---|
| 结构/职责 | 单文件单职责、公开面克制 |
| 惯用Go | 错误链不吞、context 传递、并发安全、panic 不用在正常流 |
| 命名 | 包内一致、与全仓是否脱节 |
| 坏味道 | 超长函数、重复代码、包级全局状态、魔法数字、死代码 |
| 测试 | *_test.go 有无、真断言、故障路径 |

## 本仓专项（历史踩坑，逐条对照）
- `configFunc` 包级可变变量无并发保护 → 应 `atomic.Value`（scanner/download/fileops/logs 四包同款）
- ADR-044：文件复制/写入是否走 `fsutil.CopyFile` / `WriteFileAtomic`（installer `copyFileLocked`、sync `copyFileSafe` 是漏网之鱼）
- sentinel 错误 + `errors.Is`，禁止字符串匹配分类（审计框架陷阱 #11）
- 路径安全四件套：NUL 字节 / 穿越 / symlink 逃逸 / 越界写
- 锁内做磁盘 IO 反模式（持锁 Rename/RemoveAll/WriteFile）
- 已知未修复项（如 paths BUG-1）单独标「立卡」，不混入问题列表

## 输出模板（中文、紧凑、不贴大段码）
### <包名> [x/5]
- 规模：N 文件
- 亮点：1-2 条
- 问题：`<file>:<line>` 描述（≤5 条，按严重度降序）
- 建议：一句话

### 横向观察
包间共性问题

## 评审后动作
低分包/立卡项结论写回知识卡（`node scripts/new-knowledge-card.mjs`），让 bug-search 与下次评审直接命中。
