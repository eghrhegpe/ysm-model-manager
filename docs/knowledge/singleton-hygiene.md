---
kind: singleton-hygiene
name: 3D 预览模块级单例卫生
tier: leaf
category: rendering
status: active
source_files:
  - scripts/check-singleton-hygiene.ts
  - docs/.singleton-hygiene-baseline.json
auto_fields:
  symbols_with_lines:
    - collectProductionFiles
    - diffBaseline
    - hasResetChannel
    - HygieneHit
    - moduleLevelLets
    - scanAll
    - scanText
    - SINGLETON_ALLOW_RE
use_when:
  - 给 preview-3d 模块加模块级缓存/旗标/单例（顶层 let）前，想知道要不要配复位出口
  - check-singleton-hygiene 门禁红了——新顶层 let 未受复位出口管理
  - 测试串味/flaky 排查：怀疑某模块常驻态跨用例累积
  - 审核看到模块级 let 想判「单例缺陷」——先按本卡判是否刻意为之
  - 想给某模块加豁免注 `// singleton-allow:` 但不确定理由怎么写
pitfalls:
  - 见模块级 let 即判「单例缺陷」——先查复位出口与紧邻注释：litematic-adapter 的 SliceInstance 是 ADR-132 单调唯一 key 生成器，**刻意不该复位**（复位会让并存实例编号撞车），已带 singleton-allow 注
  - 以为本闸覆盖 `const _cache = new Map()` 这类容器——不测；本闸只测可重绑定态（顶层 let），有界缓存（FIFO/上限淘汰）是另一套语义，另议
  - 给 setter 塞个 boolean 形参就以为算复位出口——判据是「可传 null」（含经本地 `type X = … | null` 别名间接含 null）；`setEnabled(enabled: boolean)` 不算
  - 新增顶层 let 后拿 `--update --force` 硬扩基线——只减不增是契约；确属刻意不设出口的，行内写 `// singleton-allow: <理由>`（空理由不豁免）
  - 把豁免注写远——识别窗口 = 声明行 + 前 3 行，再远不生效
  - 拿本闸当「无 Wails 可测」的替代——它只管模块态卫生，不管 import 方向（那归 check-layering R7/R9/R10）
quick_groups:
  - 门禁与脚本
quick_intents:
  - preview-3d 模块级单例要不要配复位出口
  - 单例卫生门禁红了怎么修
  - 模块级 let 是缺陷还是刻意
  - 测试串味怀疑常驻态累积
quick_risk_lines:
  - 新增顶层 let 无复位出口即红；基线只减不增
  - 复位出口 = __reset* / reset* / clear* / 可传 null 的 set*；豁免 = 行内 singleton-allow 注（非空理由）
invariant_anchors:
  - scripts/check-singleton-hygiene.ts|scanText
  - scripts/check-singleton-hygiene.ts|diffBaseline
  - scripts/check-singleton-hygiene.ts|hasResetChannel
  - scripts/check-singleton-hygiene.ts|moduleLevelLets
---

# 3D 预览模块级单例卫生

## 概览

`scripts/check-singleton-hygiene.ts` 是 **preview-3d 模块级可变单例的「复位出口」卫生闸**
（2026-10-08「3D 预览环境耦合度」锐评 P2-b 的落地）。锐评盘点出 preview-3d 有 77 处
模块级 `let/const` 常驻态，而全仓仅约 7 个模块导出 `__reset*ForTest`——「复位纪律」靠人
自觉、无机械闸。本闸把该约定变门禁：**新增模块级可重绑定态必须给复位出口或显式豁免**。

射程刻意收窄（泛化即噪音，同 check-menu-test-layout 的 ADR-311 已知限制）：
只扫 `frontend/src/preview-3d/**` 生产文件（`.test.`/`.spec.`/`.d.` 豁免，`.worker.` 在射程内），
且**只测顶层 `let`**——`const` 容器（Map/Set 缓存）属「有界缓存」范式，语义不同，不纳入。

## 核心职责

单文件判定（`scanText`，纯函数）三路合规，任一即放行：

| 路 | 判据 | 备注 |
|----|------|------|
| a. 文件级复位出口 | 导出 `__reset*` / `reset*` / `clear*` 函数，或导出形参**可传 null** 的 `set*` 注入 setter | ADR-168 注入范式（传 null 即复位）；形参经本地 `type X = … \| null` 别名间接含 null 亦算（`hasResetChannel` + `nullIncludingAliases`） |
| b. 行级豁免 | 声明行或前 3 行内 `// singleton-allow: <非空理由>` | 对齐仓内 `layering-allow: html` / `layout-assert:` 文化；空理由不豁免 |
| c. 入基线 | `docs/.singleton-hygiene-baseline.json`（`file → 规则 → 计数`） | 只减不增；`--update` 收紧，新增需 `--force` |

**文件级粒度**是刻意的：reset 函数通常整体复位，逐变量对账需跨行数据流分析（启发式不做，
漏报接受）。已知局限记在脚本头注释：多声明一行只记首个标识符、`stripNoise` 不解析嵌套模板。

## 对外 API / 入口

```bash
node scripts/check-singleton-hygiene.ts            # 基线比对，超线退 1
node scripts/check-singleton-hygiene.ts --json     # _summary.ok 供门禁消费
node scripts/check-singleton-hygiene.ts --update   # 收紧基线（--force 才可增/重建）
```

退出码：0 通过 / 1 回归（超基线）/ 2 用法或扫描域异常。**无基线 = fail-closed 报红**
（不「缺失即全绿」）；**扫到 0 个生产文件 = exit 2**（空域 fail-loud，check-ctx-menu-i18n
假绿教训）。纯核导出 `scanText` / `moduleLevelLets` / `hasResetChannel` / `diffBaseline` /
`scanAll` / `collectProductionFiles` 供契约测试直测，防真实树碰巧绿时空转假绿。

## 与其他子系统关系

- **check-layering**（R7/R9/R10）：管 import **方向**；本闸管模块**状态**卫生——两把不同的尺子，
  同属 preview-3d 环境耦合治理。R9 的射程收窄说明与本闸的收窄是同一套「泛化即噪音」哲学。
- **check-menu-test-layout**：范式同源（`file → 规则 → 计数` 基线、只减不增、空域 fail-loud、
  纯核导出防假绿）——本闸照其骨架落地。
- **pre-push 前端域**：`scripts/_lib/gate-blocks/frontend-domain.ts` 以 `blockPolicy: "debt"` 挂接
  （超线只 WARN 不 blocked，渐进执法；闸自身 exit 1 供人/AI 显式看到信号），并在
  `scripts/_lib/gate-coverage.ts` 的 `DOMAIN_BLOCK_CHECKS` 登记（`test_gate_coverage` 双向对账锁死）。
- **ADR-168 注入范式**：`set*` 可传 null 即复位通道——本闸把该范式认可为合规出口，而非要求额外
  造 `__reset*ForTest`。

## 不变量

1. **只测顶层 `let`**：`const` 容器（Map/Set）与函数体内缩进声明一律不报。
2. **复位出口含别名解析**：`set*` 形参经本地类型别名间接含 `null` 即算出口
   （实证 overlay-style-bridge：`OverlayStyleTarget = HTMLElement | ShadowRoot | null`）。
3. **豁免窗口固定**：声明行 + 前 3 行；理由必须非空。
4. **基线只减不增**：新条目需 `--force` 并留痕；无基线 fail-closed；空域 fail-loud。
5. **债务型不外溢**：门禁侧 `blockPolicy: "debt"`——存量 7 处在基线内不阻断，新增才阻断。

## 相关

- 知识卡 `3d-patterns.md`（模块级 `let` 望文生义的误报规律——`SliceInstance` 一例即本闸
  `singleton-allow` 注的由来）；`fe-layering-seams.md`（check-layering 三套同号异策对照）；
  `menu-test-assertion.md`（同范式基线闸）
- 源码：`scripts/check-singleton-hygiene.ts`；契约测试 `tests/test_check_singleton_hygiene.ts`；
  基线 `docs/.singleton-hygiene-baseline.json`
