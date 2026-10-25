# `design-tokens.ts` 拆分图纸（1391 行 → 三文件）

> 状态：**✅ 已完成（2026-10-25，按八文件方案，非本图纸的三文件方案）**——拆分已落地：
> `token-types.ts`(42) / `token-tables.ts`(225) / `token-suggest.ts`(191) / `token-transition.ts`(149) /
> `token-glyph.ts`(52) / `token-style.ts`(316) / `token-fix.ts`(205) / `token-emoji.ts`(234)，
> 入口 `design-tokens.ts` 1391→153 行（只留 re-export + `findViolationsOnLines` 组合器），
> 八文件全部 <400，`LIB_GRANDFATHERED` 已清空。**本图纸下方「三、seam 方案」的结论
> 「一轮拆不完、三文件仍超 400」已被证伪**：seam 地图本身是对的，但簇1 建议器内部还能再切
> （值表 / 建议算法 / 过渡建议各归一家），故八文件而非三文件。
>
> 以下为归档原文（保留历史与依赖图价值，勿当现状）：
>
> 原状态：**🧊 已归档（拆分未执行，2026-10-14）**
> 原因：P2 拆分在实施中两次失败（一次夹带行为改写、一次 PowerShell 写坏文件），
> 评估后认定投入产出比不划算——一轮拆不完（1391→700 仍超 `_lib ≤400`），且
> `design-tokens.ts` 已被 `check-file-lines` 祖父条款冻结（红线 1419），继续膨胀会被拦。
> **本图纸的留存价值**：①「假引用误判」教训（依赖图必须剥离注释再算）；
> ②下方完整的真实依赖图（剥离注释后的权威版本）——未来若要拆，这是现成的 seam 地图。
> 若未来重开此事项，从本图的「三、seam 方案」直接续做即可。
> 立项依据：`check-file-lines.ts` 的 `_lib ≤400` 硬红线祖父条款（`design-tokens.ts` 冻结在 1419）
> 纪律：ADR-315 D3「搬迁不夹带」——逐段 verbatim 搬移，每段跑基线比对

## 一、为什么上轮失败（教训，决定了本轮方法）

上轮凭"骨架看起来像"就切缝，切到一半发现两簇交错，且迁移时**顺手改写了 `suggestTransitionToken` 的逻辑**（原版调 `isRealtimeFeedbackTransition`），成了行为变更。已回滚。

**本轮先出图纸**：用剥离注释/字符串后的真实依赖图定位 seam——这次发现 **上轮的判断是错的**：

| 上轮结论 | 真实情况 |
|---------|---------|
| "`suggestTransitionToken` 依赖 `isRealtimeFeedbackTransition`，两簇交错" | **假引用**——那句话在注释里。剥离后 `suggestTransitionToken` 只依赖 `TokenRawMap` + `TRANSITION_TOKEN_DURATIONS` |

**教训**：依赖图必须剥离注释与字符串再算，否则会因文档引用误判耦合。

## 二、真实依赖图（剥离注释后）

```
簇1 值表+建议器（L41-474, 434行）
  nearestPadToken      → SP_TOKEN_VERTICAL, PAD_TOKEN_VERTICAL, SP_FLOOR_PX
  suggestPaddingToken  → COMBO_PADDING_TOKENS, nearestPadToken
  parseTokenMap        → TokenRawMap
  suggestToken         → TokenRawMap, TOKEN_PX_BASELINE
  suggestShadowToken   → SHADOW_TOKEN_VALUES, normalizeShadowValue
  suggestTransitionToken→ TokenRawMap, TRANSITION_TOKEN_DURATIONS
  suggestTransitionTokenExact → TokenRawMap, TRANSITION_TOKEN_VALUES, EASE_KEYWORDS
  ⇒ 自洽，仅出边到簇3（EASE_KEYWORDS）

簇2 实时反馈策略（L476-548, 73行）
  isRealtimeFeedbackTransition → REALTIME_FEEDBACK_PROPS, REALTIME_FEEDBACK_MAX_SECS
  ⇒ 零外部依赖（完全独立）

簇3 共用判据（L549-745, 197行）
  hasCustomEasing / TR_EXEMPT_MARKER / EASE_KEYWORDS
  isCommentLine / clip / propDeclRe / propValueRe / splitTopLevelCommas
  GRAPHIC_EMOJI / COMBINING_MARKS / GRAPHIC_EMOJI_RE / GLYPH_CLUSTER / STATUS_ICON_NAMES
  ⇒ 被簇1/4/5/6 广泛依赖（叶子层）

簇4 文档漂移 + fix（L746-881）
  fixLineTokens  → 簇1（多个 suggest*）+ 簇3 + FixEdit
  checkLayoutDocDrift → DocDrift
  ⇒ 依赖簇1、簇3

簇5 style 扫描（L954-1135）
  findStyleAttrViolations → 簇1(suggestPaddingToken) + 簇3(isCommentLine/clip)
  ⇒ 依赖簇1、簇3

簇6 emoji/glyph 扫描（L1136-1392）
  findEmojiIconViolations / scanStatusPrefixGlyphs / findToastEmojiPrefix*
  findLocaleEmojiPrefixViolations / findViolationsOnLines
  ⇒ 依赖簇3（isCommentLine/clip/GLYPH_CLUSTER）+ 簇1(suggestToken)
```

## 三、seam 方案（三文件）

| 文件 | 内容 | 预计行数 |
|------|------|---------|
| `design-tokens-types.ts` **新建** | 类型层（`DesignViolationKind` / `DesignViolation` / `TokenPxMap` / `TokenRawMap`）——放依赖图**最底层**，谁都能引，防环 | ~40 |
| `design-tokens-tables.ts` **新建** | **簇1**（值表 + 建议器）+ `EASE_KEYWORDS` | ~450 |
| `design-tokens.ts` **保留** | 簇2 + 簇3 + 簇4 + 簇5 + 簇6 + 全部 re-export 垫片 | ~700 |

**为什么不拆更多**：簇2（73 行）单独立文件过碎，它与簇3 同属"判据原语"；簇4+5 同属"style/doc 扫描族"。**三文件是"每块都是一个完整能力"的最小划分**，不是为压行数而切。

**保留 `design-tokens.ts` 作为唯一入口**（re-export 垫片）：4 个消费者（`check-design-tokens` / `token-shift-audit` / `survey-emoji-icons` / `contract-tests`）的 import 全部零改动。

## 四、执行步骤（每步可独立验证）

| 步 | 动作 | 验证 |
|----|------|------|
| 1 | 建 `design-tokens-types.ts`，从原文件**剪切**类型声明（非复制） | `tsc -p scripts/tsconfig.json` |
| 2 | 原文件 import 类型；消费者无感（类型本来就从原文件导出） | 同上 |
| 3 | 建 `design-tokens-tables.ts`，**逐行 verbatim 剪切**簇1 + `EASE_KEYWORDS` | 与原段落做 diff 比对（见下） |
| 4 | 原文件改为 import + re-export 垫片 | `tsc` + `check-design-tokens` 基线比对 |
| 5 | 全量验证 | 见第五节 |

**verbatim 校验命令**（每步搬迁后跑，确保零改写）：
```bash
# 搬迁前后，同一符号的实现体应逐字节相同
git show HEAD:scripts/_lib/design-tokens.ts | sed -n '243,285p' > /tmp/before.txt
sed -n '<新文件对应行>' scripts/_lib/design-tokens-tables.ts > /tmp/after.txt
diff /tmp/before.txt /tmp/after.txt   # 应无输出
```

## 五、验收判据（缺一不可）

1. **`check-design-tokens` 基线比对**：搬运前后对全仓扫描，`count` 与违规清单**逐条相同**——这是"零行为变更"的硬证据
2. **`tsc -p scripts/tsconfig.json`** 零错
3. **三个消费者脚本实跑**：`check-design-tokens` / `token-shift-audit` / `survey-emoji-icons --json`，输出与搬运前一致
4. **相关契约测试**：`tests/test_design_tokens.ts` / `test_token_shift_audit.ts` 全绿
5. **`check-file-lines`**：新三文件均在红线内且 `design-tokens.ts` 显著下降

## 六、风险与回退

| 风险 | 缓解 |
|------|------|
| 搬迁中夹带行为改写 | 每段 verbatim diff（第四节命令）；**禁改任何逻辑**，含"顺手修 bug" |
| 循环依赖 | 类型层独立成文件放最底层；`tsc` 会直接报环 |
| 消费者漏改 | re-export 垫片保证零改动；4 个消费者 import 语句不动 |
| 中途失败 | 每步独立提交（小步可回退），**不做一次性大改** |

## 七、预期收益

- `design-tokens.ts`：1391 → ~700（**仍在 400 之上**，故祖父条款暂不除名）
- 三文件各自独立可测：值表/建议器（纯数据逻辑）、扫描器（纯字符串判定）
- **真正收益不是行数**：是"改建议器不必翻 1391 行找位置"

> ⚠️ 诚实说明：本次拆分**不会**让 `design-tokens.ts` 达标 `_lib ≤400`。它是"降低理解成本 + 建立可继续拆的地基"，不是一次拆到合规。若目标必须是合规，需要后续第二轮（把簇6 emoji 扫描再独立出去）。
