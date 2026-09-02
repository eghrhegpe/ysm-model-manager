---
kind: i18n_accuracy
name: i18n 翻译准确度扫描记录
tier: leaf
category: core
source_files:
  - frontend/src/core/i18n/locales/zh-CN.ts
  - frontend/src/core/i18n/locales/en.ts
  - frontend/src/core/i18n/locales/ja.ts
  - scripts/i18n-key-naming.ts
  - tests/test_i18n_key_naming.ts
auto_fields:
  symbols_with_lines:
    - classifySecondSegment:449
    - en:4
    - extractKeys:449
    - guessRole:449
    - ja:5
    - loadAllKeys:449
    - validateKey:449
    - zhCN:6
  tests:
    - frontend/src/core/i18n/locales-consistency.test.ts
    - tests/test_i18n_key_naming.ts
  use_when:
    - 翻译准确度
    - 键名与值语义错位
    - i18n 翻译扫描
    - en 丢 Count
    - Opacity 误译
    - 术语统一
    - 翻译名实不符
tests:
  - frontend/src/core/i18n/locales-consistency.test.ts
  - tests/test_i18n_key_naming.ts
use_when:
  - 翻译准确度
  - 键名与值语义错位
  - i18n 翻译扫描
  - en 丢 Count
  - Opacity 误译
  - 术语统一
  - 翻译名实不符
status: snapshot
---

# i18n 翻译准确度扫描记录

## 概览

2026-08-28 对三语翻译包（zh-CN / en / ja）进行了系统性扫描，覆盖 13 个命名空间、4 种语义模式（Count 后缀、Opacity 后缀、Size 后缀、Material 后缀）。发现并修复 10 处"键名与翻译值语义错位"（"键叫 a、干的是 ab"）。

## 发现的三类系统性模式

### 模式 1：en preview xxxCount 丢 Count

preview 命名空间下的静态计数标签（不带 `{n}` 占位符），en 一律译成复数名词丢了 count 语义——web/diagnostics 的同类键没这个问题。

```
preview.cubeCount     en 原"Cubes"     → "Cube Count"     ✅ 已修
preview.textureCount  en 原"Textures"   → "Texture Count"  ✅ 已修
preview.metric.boneCount en 原"Bones"   → "Bone Count"     ✅ 已修
```

**根因**：preview 的 Count 键在早期被当作 UI 标签（"Cubes"）而非指标名（"Cube Count"），与 `web.*Count` 和 `diagnostics.*Count` 的处理不一致。

### 模式 2：zh/ja xxxOpacity 误译为"强度"

key 叫 Opacity（不透明度），zh/ja 翻译者把它理解成"强度/強度"来意译。在 3D 领域 opacity 和 intensity 视觉效果相近但语义不同。

```
reflectorOpacity  zh 原"反射强度" → "反射不透明度"  ✅ 已修
                  ja 原"反射強度" → "反射不透明度"  ✅ 已修
ssrOpacity        zh 原"SSR 反射强度" → "SSR 反射不透明度"  ✅ 已修
                  ja 原"SSR 反射強度" → "SSR 反射不透明度"  ✅ 已修
```

### 模式 3：en Shadow/Material 丢关键词

en 翻译时省略了 key 名中明确包含的概念词。

```
shadowCameraSize  en 原"Directional Frustum" → "Directional Shadow Frustum"  ✅ 已修
groundMatSource   en 原"Surface" → "Surface Material"  ✅ 已修
```

### 模式 4：zh 术语不统一 + ADR-124 迁移遗留

- zh `preview.texture`="纹理" vs `preview.texturesLabel`="贴图"——同实体两译法 → 已统一为"纹理"
- `preview.label.skeleton` 键名叫 skeleton 但统计 boneCount——键名与功能错位 → 已改名 `label.boneCount`（三语键名+值+调用方同步修正）
- `nav.preview` zh="预告版" vs 标准软件术语"预览版" → 已修

## 已确认干净的区域

error / model / pack / workshop / skeleton / dialog / toast / settings / nav / tree / import / web / diagnostics / menu / downloads / community / android / about / credits / content / format——三语一致、名实相符。

## 测试守护

`tests/test_i18n_key_naming.ts`（40 合规 + 3 违规用例）守护 `validateKey` 逻辑不回归误判，被 pre-push 自动跑。

## 与 ADR-124 的关系

ADR-124 定义了三段式键名规范（`<模块>.<角色>.<实体>`）。本次扫描发现的 10 处翻译问题**不是 ADR 的错误**，而是键名迁移后翻译值没同步更新的遗留——迁移改了键名但值停留在旧语义。ADR-124 §3.3 已补充"三段式校验放宽为默认合法"的取舍说明。

## 相关

- [i18n](./i18n.md) — i18n 模块架构
- ADR-124 — i18n 键名三段式规范
