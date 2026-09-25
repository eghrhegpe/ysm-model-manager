---
kind: css-token-check
name: 视图层 token 消费门禁 css-token-check
tier: architecture
category: ui
source_files:
  - scripts/css-token-check.ts
  - scripts/.css-token-baseline.txt
  - scripts/_lib/gate-blocks/frontend-domain.ts
  - scripts/_lib/css-layer-utils.ts
auto_fields:
  symbols_with_lines:
    - DeadCssFinding
    - dynamicClassHint
    - expandStyleInterpolations
    - extractSelectorClasses
    - findDeadCssClasses
    - findStrayCommentClose
    - findUndefinedAnywhereClasses
    - hasMotionDeclaration
    - hasNoAnimationsBridge
    - maskSelectorClasses
    - readConstLiteral
    - resolveImportAbs
    - runFrontendDomain
use_when:
  - css-token-check
  - token 门禁
  - 视图层裸值
  - 硬编码 padding
  - 设计令牌合规
quick_intents:
  - 扫描视图层裸值（padding/gap/border-radius/box-shadow/z-index/width/height）
  - 重建基线（存量收敛后）
  - pre-push 前端域门禁
pitfalls:
  - 首跑自动建基线（scripts/.css-token-baseline.txt），之后只报基线外新增裸值——存量不会被淹没
  - 默认 rc=0 不阻断 push（仅可见）；升 --strict 才拦新增裸值
  - 预览域 preview-3d 全豁免（独立渲染栈，审计已排除）
  - 颜色不自动替换（机械猜测必错），需人工判定语义
status: active
invariant_anchors:
  - scripts/css-token-check.ts|isAllowed
  - scripts/css-token-check.ts|TOKEN_CHECK_ALLOW
  - scripts/_lib/gate-blocks/frontend-domain.ts|runFrontendDomain
---

# 视图层 token 消费门禁 css-token-check

## 概览

`css-token-check.ts` 是 UI 一致性审计（UI-Design-Audit-2026-09.md §5.2 第 3 步）落地的**止血门禁**：扫描前端视图层 CSS，把「属性位出现裸数值（非 `var(--*)` / `calc(var(--*))`）」变成可观测信号，逼出 token 消费纪律。与 `check-design-tokens`（新增行零容忍）互补——本脚本管「存量基线」，后者管「新增行」。

## 核心职责

- **扫描域**：`frontend/src` 全部 `.ts`（含 `preview-3d`，域内豁免），展开 `${X}` 共享样式常量后剥离注释+字符串再判定
- **受检属性**：`padding` / `margin` / `gap` / `border-radius` / `box-shadow` / `z-index` / `width` / `height`
- **裸值判定**：带绝对单位（px/rem/vh/vw/pt）或纯数字（z-index）；排除相对值（100%/auto）、TS 类型字段（number）、纯零值（`padding/margin/gap/border-radius` 各段全 0——重置语义无缩放信息，`width/height/z-index:0` 有布局语义不放行）
- **基线模式**：首次运行自动写 `scripts/.css-token-baseline.txt`（当前 347 条存量；2026-09-25 黄区 23 条收口 + 零值误判 11 条随闸修出账）；后续只报基线外**新增**裸值，避免一次性几百条误报淹没信号
- **接入**：`pre-push-gate.ts` 前端域块（`frontend-domain.ts`），`blockPolicy:"debt"`（存量债只报告不阻断）

## 对外 API

```bash
node scripts/css-token-check.ts                 # 报基线外新增 WARN（rc=0，不阻断）
node scripts/css-token-check.ts --strict         # 新增裸值 rc=1（接 pre-push 阻断）
node scripts/css-token-check.ts --rebuild-baseline  # 存量收敛后重建基线
node scripts/css-token-check.ts --json           # 结构化输出（_summary.ok 对齐 gate-parse 契约）
YSM_SKIP_TOKEN_CHECK=1 node scripts/css-token-check.ts  # 逃生阀
```

## 与其他子系统关系

- **check-design-tokens**：pre-commit 已挂 `--added-lines`（新增行零容忍），本脚本补「存量基线」层——双闸合力
- **css-layer-check**：同源复用 `walk` / `expandStyleInterpolations`（Shadow DOM 样式越界检查）
- **pre-push-gate**：本脚本被前端域块调用，非阻断（debt 口径）

## 不变量

- 基线文件是「存量债快照」，不手改——靠 `--rebuild-baseline` 更新（存量收敛后跑）
- 纯零值（`isZeroOnlyValue`）恒放行、不入基线：0 不随字号缩放，无令牌可归
- `TOKEN_CHECK_ALLOW` 集登记合法裸值（图标槽/内容图/物理像素），移除即触发 WARN 倒逼复核
- `preview-3d` 域恒豁免（独立渲染栈，不在本闸范围）
- 颜色裸值不自动令牌化（语义需人工判定）

## 相关

- [UI-Design-Audit-2026-09](./../UI-Design-Audit-2026-09.md) — 界面一致性诊断报告
- [UI-Design-Fix-Plan](./../UI-Design-Fix-Plan.md) — 落地改动方案（含执行记录 §8）
- [css-layer-check](../adr/ADR-274-css-layer-check.md) — Shadow DOM 样式越界检查（闸本体决策 ADR-274/275；`scripts/css-layer-check.ts` 为脚本本体，docs 下无同名知识卡）
