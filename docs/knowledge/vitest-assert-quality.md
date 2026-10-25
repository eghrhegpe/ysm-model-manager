---
kind: vitest-assert-quality
name: 前端 vitest 失败失语断言闸
tier: leaf
category: config
status: active
source_files:
  - scripts/check-vitest-assert-quality.ts
  - docs/.vitest-assert-quality-baseline.json
auto_fields:
  symbols_with_lines:
    - AssertHit
    - collectTestFiles
    - Counts
    - diffBaseline
    - scanAll
    - ScanResult
    - scanText
    - scanTextFull
    - toCounts
use_when:
  - 写/改前端 *.test.ts 的 expect 断言前，想知道哪种写法会被本闸拦下
  - check-vitest-assert-quality 门禁红了——某处复合布尔断言没带失败消息
  - 审核看到 `expect(a && b).toBe(true)` 想判「这断言坏了没」——先按本卡判是否失语
  - 想给某处复合布尔断言加豁免注 `// assert-quality-allow:` 但不确定理由怎么写
  - 想知道为什么 `expect(x.length).toBeGreaterThan(0)` 不被本闸管
pitfalls:
  - 以为本闸管「所有软断言」——只收一种：含**顶层** `&&`/`||` 且被布尔化 matcher 收尾且**无第二实参消息**的 expect；其余一律不报
  - 把尺寸稀释（`expect(errors.length).toBeGreaterThan(0)`）也塞进基线——**刻意不立**：静态不可判真伪（「应当报错」的测试里它是正确断言），塞进去就是造一本没人会还的债账（本仓「软告警 15 条无人拆」老路）
  - 以为嵌套逻辑算复合——`.some(x => x.a && x.b)` 的短路是业务语义，括号深度 > 0 一律不算顶层
  - 给断言加个消息就以为万事大吉——消息只需**非空第二实参**即可缓解失语，不要求格式
  - 拿 `--update --force` 硬扩基线——只减不增是契约；确属刻意的写行内 `// assert-quality-allow: <理由>`（空理由不豁免）
  - 把豁免注写远——识别窗口 = 该 expect 语句的起止行区间，跨语句不生效
  - 以为本闸覆盖 e2e——e2e 的同类判据在 check-e2e-hygiene 的 R2，是**另一把尺子**（那边扫 .spec.ts、只普查不阻断）
quick_groups:
  - 测试与验证
quick_intents:
  - 前端测试断言哪种写法会失语
  - 复合布尔断言门禁红了怎么修
  - 尺寸稀释断言为什么不立闸
  - 断言豁免注怎么写
quick_risk_lines:
  - 复合布尔 + 无消息 = 失败只报 expected false to be true，零 diff
  - 只认顶层逻辑；嵌套 && / || 与带消息一律放行；基线只减不增
invariant_anchors:
  - scripts/check-vitest-assert-quality.ts|scanTextFull
  - scripts/check-vitest-assert-quality.ts|diffBaseline
  - scripts/check-vitest-assert-quality.ts|TAIL_RE
  - scripts/check-vitest-assert-quality.ts|ESCAPE_RE
---

# 前端 vitest 失败失语断言闸

## 概览

`scripts/check-vitest-assert-quality.ts` 是**前端 vitest 断言的「失败输出诊断力」防回退闸**
（2026-10-25，接 Go 侧「裸断言红线清零」战役之后的口径核实）。那场战役把 Go 的裸
`t.Fatal`（无消息即失败只报一行文件名+行号）清到零并锁进
`scripts/baseline/go-bare-assert-baseline.json`（count=0）。前端有没有同类面？实测
`frontend/src` 下 538 个 `*.test.ts`、20769 个 `expect(`——**有，且只有一种形态**。

## 唯一判据：compound-no-message

```
expect(<含顶层 && 或 || 的表达式>).toBe(true | false)   ← 且无第二实参消息
expect(<同上>).toBeTruthy() / .toBeFalsy()              ← 含 .not. 变体
```

为什么是它：这种断言失败时 vitest 只打印 `expected false to be true`——**没有任何 diff**。
被测表达式里有几个条件、哪个没成立，输出一个字都不说。这与 Go 侧裸 `t.Fatal` 的失语
程度**等价**，是全仓唯一精确的同类面。

射程刻意收窄（泛化即噪音，同 check-menu-test-layout / check-singleton-hygiene 的哲学）：

| 形态 | 处置 | 理由 |
|------|------|------|
| 顶层 `&&`/`||` + 布尔化收尾 + 无消息 | **命中，进基线** | 失败零 diff，与裸 `t.Fatal` 同等失语 |
| 同上但带第二实参消息 | 只进普查 `census.compoundWithMessage` | 消息已缓解失语 |
| 尺寸稀释 `expect(x.length).toBeGreaterThan(0)` | 只进普查 `census.sizeDiluted` | **静态不可判真伪**（见下） |
| 嵌套逻辑 `.some(x => x.a && x.b)` | 不报 | 括号深度 > 0，是业务短路不是断言结构 |
| 非布尔化收尾 `.toEqual`/`.toBe(3)`/`.toHaveLength` | 不报 | 有 diff 或计数明确 |

**为什么尺寸稀释刻意不立闸**（本卡最重要的一条裁定）：`expect(errors.length).toBeGreaterThan(0)`
在「这里应当报错」的测试里是**正确断言**，在「应当报 3 条错」的测试里才是稀释——
**同一个写法，靠静态文本判不出意图**。实测全仓 111 处，若塞进基线，等于给团队发一本
111 行的债账，而每一条都需要人读上下文才能判「该不该改」——这正是本仓「软告警 15 条
无人拆」的老路。故本闸只**普查**它（报数量与分布供排期），不进基线、不阻断。

## 新增门禁准入声明（误报处置策略与退出条件）

本闸自身遵守「新上闸须先答误报处置」这条纪律，答案写在判据里而非事后豁免：

- **误报处置策略**：判据不可静态判定的，**宁可不立闸，也不立靠人肉豁免维持的闸**。
  这就是尺寸稀释只普查、复合布尔带消息只普查的原因——它们的误报率取决于上下文，
  不是文本可判的。
- **退出条件**：存量 5 处清完即 `debt` → `hard`，转为纯防回归锁（判据确定性、零假阳性，
  升档后不会有存量噪音）。
- **豁免语法**：`// assert-quality-allow: <非空理由>`，识别窗口 = 该 expect 语句的起止行
  区间内任一行；空理由不豁免。对齐仓内 `layering-allow:` / `layout-assert:` /
  `singleton-allow:` 文化。

## 对外 API / 入口

```bash
node scripts/check-vitest-assert-quality.ts            # 基线比对，超线退 1
node scripts/check-vitest-assert-quality.ts --json     # _summary.ok 供门禁消费
node scripts/check-vitest-assert-quality.ts --update   # 收紧基线（--force 才可增/重建）
```

退出码：0 通过 / 1 回归（超基线）/ 2 用法或扫描域异常。**无基线 = fail-closed 报红**
（不「缺失即全绿」）；**扫到 0 个测试文件 = exit 2**（空域 fail-loud，check-ctx-menu-i18n
假绿教训）。纯核导出 `scanTextFull` / `scanText` / `scanAll` / `collectTestFiles` /
`toCounts` / `diffBaseline` 供契约测试直测，防真实树碰巧绿时空转假绿。

扫描器**全自实现词法**（不靠裸正则）：`skipString`（含模板串）/`matchParen` /
`splitTopLevelArgs`（按括号深度切实参）/ `hasTopLevelLogical`（深度 0 判顶层 `&&``||`）。
正则做不到「顶层」判定——`expect(fn(a && b))` 与 `expect(a && b)` 在字符层面难分。

## 与其他子系统关系

- **check-e2e-hygiene**（R2 尺寸稀释）：两把**刻意不同**的尺子。R2 扫
  `frontend/e2e`+`frontend/e2e-web` 的 `*.spec.ts`、抓 `.toBeGreaterThan(0)` 假绿、
  只观察不阻断；本闸扫 `frontend/src` 的 `*.test.ts`、抓复合布尔失语、有基线可阻断。
  **不要把 R2 的判据搬过来**（理由见上：静态不可判）。
- **Go 侧裸断言账本**：`scripts/baseline/go-bare-assert-baseline.json`（count=0）是同一场
  战役的 Go 侧终态；本闸是其前端对应物，两端各有一本只减不增的账。
- **check-menu-test-layout / check-singleton-hygiene**：范式同源（`file → 规则 → 计数`
  基线、只减不增、空域 fail-loud、纯核导出防假绿）——本闸照其骨架落地。
- **pre-push 前端域**：挂 `scripts/_lib/gate-config-frontend.ts` 的 `FRONTEND_STATIC_TOOLS`
  （`blockPolicy: "debt"`）。**单通道**：不在 `gate-blocks/frontend-domain.ts` 再挂一次
  （两者在 push 时都跑，双挂=重复执行；check-e2e-hygiene 即此先例），故
  `DOMAIN_BLOCK_CHECKS` 里也没有它。

## 不变量

1. **只收顶层逻辑**：括号深度 > 0 的 `&&`/`||` 一律不算（`.some(x => x.a && x.b)` 不报）。
2. **只认布尔化收尾**：`.toBe(true|false)` / `.toBeTruthy()` / `.toBeFalsy()`，`.not.` 可选；
   其余 matcher 不报。
3. **消息即缓解**：只要第二实参存在且非空，一律不报（不校验消息质量）。
4. **尺寸稀释永不进基线**：只出现在 `census.sizeDiluted`，供排期不供阻断。
5. **基线只减不增**：新条目需 `--force` 并留痕；无基线 fail-closed；空域 fail-loud。
6. **债务型不外溢**：门禁侧 `blockPolicy: "debt"`——存量 5 处在基线内不阻断，新增才阻断。

## 相关

- 知识卡 `menu-test-assertion.md`（同范式基线闸 + ADR-311 断言三分法）、
  `singleton-hygiene.md`（同范式，骨架来源）、`commit-message-gate.md`（同属「先采集后
  阻断」的渐进执法路线）
- 源码：`scripts/check-vitest-assert-quality.ts`；契约测试
  `tests/test_check_vitest_assert_quality.ts`；基线 `docs/.vitest-assert-quality-baseline.json`
