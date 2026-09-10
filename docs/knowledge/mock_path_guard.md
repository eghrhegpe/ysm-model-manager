---
kind: mock_path_guard
name: mock 路径守卫 check-mock-paths
tier: architecture
category: utils
status: active
source_files:
  - scripts/check-mock-paths.ts
  - scripts/_lib/mock-path-resolve.ts
  - docs/.mock-path-exempt.json
auto_fields:
  symbols_with_lines:
    - classifyMock
    - MockClassify
    - MockKind
    - MockLevel
    - SRC_ROOT
use_when:
  - vi.mock 失效
  - mock 路径守卫
  - mock-path-ignore
  - ADR-224
  - 测试隔离静默丢失
pitfalls:
  - M2 裸包默认只 WARN 不阻断（node_modules 在本仓不完整，fail-closed 会炸环境噪声）；只有 --strict 才升 FAIL，pre-push 不加 --strict 只拦 M1
  - bare spec 以 deps 主导、node_modules 只是兜底——新增裸包 mock 前先挂进 package.json deps
quick_groups:
  - 门禁与脚本
quick_intents:
  - vi.mock 改了路径结果静默不起作用
  - 往测试加 vi.mock 需要注意什么
  - mock 路径守卫怎么豁免
quick_risk_lines:
  - vi.mock("<内部spec>") 指向不存在的模块路径时 vitest 静默不命中——mock 路径写错就悄悄失效，测试照常通过
  - 用 // mock-path-ignore: <理由> 或 docs/.mock-path-exempt.json 豁免，禁止直接 --no-verify 绕过
invariant_anchors:
  - scripts/_lib/mock-path-resolve.ts|classifyMock
  - scripts/check-mock-paths.ts|MOCK_CALL_RE
---

# mock 路径守卫 check-mock-paths

## 概览

ADR-224 落地：vitest 的 `vi.mock("<path>")` 对**不存在的模块路径静默不命中也不报错**（host 视为 auto-mock）。模块因重构/rename 被移动后，测试里指向旧路径的 mock 失效——mock 不生效、被测文件真实 import 链被拉起，测试仍可能通过，但隔离意图悄悄丢失。`check-mock-paths` 把这类静默病灶固化为静态检查：扫描 frontend/src 测试文件的 `vi.mock / vi.doMock / vi.unmock` 说明符，解析目标存在性，按三级规则报告。

本仓实证（2026-09-10 sync 迁移 + 首刷修复）：首扫抓出 5 处 M1（`app-content.methods.test.ts` 的 `@/features/sync.ts` 同源病灶、`web-fs.test.ts` 指向幽灵 `resource-types.json`、`executor.test.ts` 的 `./repo-rtype.ts`、`mount-preview-core.test.ts` 两处 `../../../utils/dom/*` 深度错误），修净后 M1=0 才挂 FAIL 闸。

## 核心职责

### 规则分级（对齐 check-path-hygiene 语法）

- **M1** 内部 spec（`@/` `#root/` `./` `../`）解析失败 → **FAIL**（唯一 fail-closed 阻断项）。目标不存在 / 别名未登记 / `.js→.ts` 兜底后仍无。正是 sync 那类病灶。
- **M2** 裸包 spec 三判据皆无（`package.json deps ∪ devDeps ∪ optionalDeps` / `frontend/node_modules/<pkg>` / 根 node_modules）→ **WARN**（默认）/ **FAIL**（`--strict`）。deps 主导，node_modules 只兜底——实证本仓 node_modules 仅 10 项、three/@wailsio/runtime 子包未装，fail-closed 会炸 ~20 条误报。
- **M3** `.js` 胶水兜底成功但写法过时（`app.js` → 实际 `app.ts`）→ **INFO** 只统计。bindings 单类 14 处，合规写法（vite 插件解析），提示可写 `.ts`。

### 豁免通道（E3）

- 行内 `// mock-path-ignore: <理由>`（同一行）→ 跳过该行所有 mock。
- 文件级/spec 级集中白名单 `docs/.mock-path-exempt.json`（`{ files: [], specs: [] }`）：虚拟模块（`virtual:*`）、故意 mock 不存在路径以阻断加载的写法。
- 没有豁免通道的守卫第一次误报就会被 `--no-verify` 绕过，故豁免通道与门禁同批落地。

### 判定层（单一事实源）

`scripts/_lib/mock-path-resolve.ts` 纯判定 `classifyMock(spec, fromFileAbs)` → `{ level: ok|M1|M2|M3, ... }`，与 `alias-resolve.ts` 同构，供 CLI 与契约测试直接 import，防「测试与脚本逻辑漂移」。

## 对外 API / 入口

```bash
node scripts/check-mock-paths.ts           # 违规退 1（M2 默认只 WARN 不阻断）
node scripts/check-mock-paths.ts --json    # JSON（CI / pre-push-gate 消费）
node scripts/check-mock-paths.ts --strict  # M2 也升为 FAIL
node scripts/check-mock-paths.ts --update  # 生成/规范化豁免白名单文件
```

挂闸于 `scripts/pre-push-gate.ts`（前端域，`--json` 不带 `--strict`，只拦 M1）。

## 与其他子系统关系

- `scripts/_lib/alias-resolve.ts`：`tryResolveAlias` 复用，`@/ #root/` 别名展开同源，不引入第二套解析。
- `scripts/_lib/scan-files.ts`：`walk/readText/relPosix` 扫描与文件读取。
- `scripts/_lib/contract-tests.ts`：`CONTRACT_TEST_TARGETS` 登记 `test_check_mock_paths.ts`；契约测试 `tests/test_check_mock_paths.ts` 锁死判定。
- 复用的产物：`scripts/check-path-hygiene.ts`（分级语法对齐）。

## 不变量

- M1 是唯一 fail-closed 阻断项；M2 默认 WARN——换本仓环境零噪声，这是 ADR E1 拍板口径，勿擅自改回硬报。
- bare 三判据 = deps 主导 + node_modules 兜底；判据追加任何真包名时先挂 deps 再 mock，别依赖 node_modules 存在（本仓 node_modules 不完整）。
- `.js→.ts` 兜底是必做项（bindings 14 处），删了会让单类最大头全变 M1 误报。

## 相关

- ADR-224 — mock 路径守卫（M1/M2/M3 + E1-E4 判定口径）
- [pre_push_gate](./pre_push_gate.md) — 门禁调度（前端域接线）