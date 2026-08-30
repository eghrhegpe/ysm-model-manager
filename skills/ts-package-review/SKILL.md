---
name: "ts-package-review"
description: "前端TS包代码评审：分层结构/惯用TS/命名/坏味道/测试覆盖五维审查 + 本仓专项清单（治理规则R1-R9、ADR-116红线、桥接契约），中文紧凑输出，只读不改码。Invoke when 用户说「评审 frontend/src xxx 目录 / TS 代码评审代理 / 前端整包过一遍 / 前端能力一览」。"
---

# TS 包评审

## 铁律
只研究、绝不改文件。全程只读工具；改动另起任务（重构走 `ts-giant-function-surgery` / `frontend-batch-sweep`）。

## 流程
1. 先跑治理工具，人工评审聚焦工具覆盖不到的语义问题：
```bash
node scripts/check-redlines.mjs        # R1-R9 + W 系列附加扫描（Error 级已兜底，人工复核 Warn 级与变体逃逸）
node scripts/type-consistency.mjs      # 资源类型常量一致性
node scripts/binding-check.mjs         # 绑定契约
cd frontend && npm run typecheck       # tsc --noEmit（遗留基线错误用 Select-String 过滤目标文件判定归属）
```
2. LS frontend/src 确认真实目录；统计必须**递归**（views/ 等目录 .ts 全在二级子目录，顶层通配会漏）：
```bash
$ for d in frontend/src/*/; do files=$(find "$d" -name "*.ts" ! -name "*.test.ts" | wc -l); loc=$(find "$d" -name "*.ts" ! -name "*.test.ts" -exec cat {} + 2>/dev/null | wc -l); echo "$d $files files, $loc LOC"; done
```
3. 整仓评审时按 ~10k LOC 配平分批并行子代理（2026-08 实测：features/preview-3d ≈28k、views ≈22k 各自成组且可再按子目录对半——app-content/app-preview 是 views 大头；backend+core ≈11k 合并一组；ui/features/services/wasm/workers/utils 其余合并）。`features/preview-3d/adapters/vendor` 是第三方 vendor 不评。单包评审直接通读 .ts 源码（抽查 .test.ts）。子代理提示词必须含「只做研究、绝不修改任何文件」。
4. 子代理若只回评分表或元对话，追问一次「补交报告正文，不重读文件」，不重跑。
5. 五维 + 本仓专项 → 按模板输出。

## 五维
| 维度 | 要点 |
|---|---|
| 结构/职责 | 单文件单职责、分层单向依赖（ui→features→core→backend 不反向）、公开面克制 |
| 惯用TS | `any`/非空断言 `!` 滥用、Promise 不吞 rejection（catch 后须记录或 rethrow）、addEventListener 与 disconnectedCallback/removeEventListener 配对、async 竞态有 AbortController/守卫 |
| 命名 | 域前缀约定一致（asb*/at*/an*/cm*/md* 等）、与全仓口径不脱节 |
| 坏味道 | >100 行函数、重复 DOM 装配、模块级 let 可变全局（R1 变体）、魔法字符串、死代码 |
| 测试 | *.test.ts 有无、真断言（非 smoke）、故障路径（reject/异常分支） |

## 本仓专项（历史踩坑，逐条对照）
- 治理规则 R1-R9 对照（唯一事实源 = `docs/governance-rules.md`）：重点人工复核 Warn 级——回调式 API（R3）、display 切动画（R4）、硬编码颜色绕过主题变量（R5）、资源类型字面量散落（R7，应走 RESOURCE_TYPES 常量）
- ADR-116 职责红线：类型判定 / tab / preview / 3d / resourcepack 归类一律由 Go 扫描结果派生，前端本地 filter 重算归类即违规；筛选去重聚合归 Go
- 跨类型切换走 `ctx.switchExternal`，同源替换走 `switchTo`，两者混用是回归高发点
- Wails 桥：只 import `frontend/bindings/` 生成物，禁 `window.go.main.App` 直调（W1/W2 扫描项）；web 模式经 browserAdapter Proxy，不得绕过 platform.ts Tier 分层直判环境
- 跨端事件契约：事件名逐字匹配必须有测试闸门（android-events P1-1 教训——`emitSystemEvent` 仅达 Go 侧永不到前端，通道选错即运行时死代码）
- Shadow DOM 动态样式注入需 `ensure*Styles()` 幂等守卫，keyframe 名不得越界（css-layer-check 钩子兜底，人工看守卫有无）
- localStorage 写入口径护栏（safeSet、「空串不落盘」类约定）不得静默更改
- innerHTML 拼接用户数据必须 esc()（R8 Error，工具已拦，人工看模板字符串间接拼接等变体）
- 已知未修复项单独标「立卡」，不混入问题列表

## 输出模板（中文、紧凑、不贴大段码）
### <目录名> [x/5]
- 规模：N 文件
- 亮点：1-2 条
- 问题：`<file>:<line>` 描述（≤5 条，按严重度降序）
- 建议：一句话

### 横向观察
包间共性问题

## 评审后动作
低分包/立卡项结论写回知识卡（`node scripts/new-knowledge-card.mjs`），让 bug-search 与下次评审直接命中。
