---
kind: menu_test_assertion
name: 菜单测试断言三分法
tier: leaf
category: ui
status: active
source_files:
  - frontend/src/preview-3d/menu/menu-test-helpers.ts
  - scripts/check-menu-test-layout.ts
  - docs/.menu-test-layout-baseline.json
auto_fields:
  symbols_with_lines:
    - assertNoDuplicateIds
    - childIds
    - diffBaseline
    - findNodeById
    - LayoutHit
    - nodeIds
    - scanAll
    - scanText
use_when:
  - 写 / 改 3D 菜单（cap/adapter/panel/state）测试，断言节点树结构
  - 菜单测试因加项、删项、重排而集体崩——判断该断言是否属于脆弱布局断言
  - 新增 cap/菜单节点后，测试该怎么写才不再随菜单变化而改
  - 看到 check-menu-test-layout 门禁红（新增布局快照断言超基线）
  - 评审菜单测试时，分不清「行为断言」与「布局快照」
pitfalls:
  - 用 `nodes[3]!` / `getMenuNodes()[1]!.children` 位置索引找节点——菜单增删一项全崩且报不出缺哪个；一律 findNodeById
  - 归属写成有序 `map(c => c.id)).toEqual([...]` 快照——重排即崩；配集合判据 `.sort()).toEqual([...].sort())`
  - 顺手引入 jest-extended 的 toIncludeSameMembers——仓内无该扩展（vitest ^4 无 setup），成员相等走仓内 sort 集合惯例
  - 把 `toHaveLength(N)` 当行为断言留下——计数属「顺序/计数」档，非产品决策即删或改写成员集合断言；确属产品决策须行内 `// layout-assert: <理由>`
  - 把 helper 写回 menu-test-fixtures.ts 复用——它顶层 import preview-state 有副作用，`@vitest-environment node` 测试引它即拖整条状态层依赖链（R6 反桶精神）；纯树断言 helper 在 menu-test-helpers.ts 独立叶
quick_groups:
  - 菜单测试 / cap 节点树断言 / 布局快照债务
quick_intents:
  - 菜单测试怎么写才长久
  - 布局断言收敛三分法
  - 菜单测试债务门禁 check-menu-test-layout
quick_risk_lines:
  - 门禁只减不增：新增布局断言即红，触碰即收敛
  - helper 必须在 node/jsdom 双环境可 import（menu-test-helpers 零上层依赖叶）
invariant_anchors:
  - frontend/src/preview-3d/menu/menu-test-helpers.ts|findNodeById
  - frontend/src/preview-3d/menu/menu-test-helpers.ts|childIds
  - frontend/src/preview-3d/menu/menu-test-helpers.ts|nodeIds
  - frontend/src/preview-3d/menu/menu-test-helpers.ts|assertNoDuplicateIds
  - scripts/check-menu-test-layout.ts|scanText
  - scripts/check-menu-test-layout.ts|diffBaseline
---

# 菜单测试断言三分法

## 概览

菜单 UI 逻辑（cap 的 `getMenuNodes()` 树、adapter 产树、state 层控制项顺序）变化频繁，手写「布局快照」断言（有序 id 数组 `toEqual`、精确 `toHaveLength`、`nodes[i]!` 位置索引）是测试 churn 第一源：加一项、删一项、重排，测试集体崩且崩点报不出缺哪个 id。ADR-311 把菜单测试断言分为三档并立法渐进执法：

| 档位 | 内容 | 断言形态 |
|------|------|----------|
| 1 行为不变量 | control 闭包、visibleWhen、值域、i18n labelKey、kind 语义 | 逐条硬断言，**保留** |
| 2 成员归属 | 「某节点属于某组」「组内有哪些成员」 | `findNodeById` + `childIds` 配**集合**判据（仓内惯例 `.sort()).toEqual([...].sort())` / `toContain` / `arrayContaining`） |
| 3 顺序/计数 | 节点先后次序、精确个数 | **禁止**，除非产品决策，且该行须带 `// layout-assert: <理由>` 注释（门禁豁免载体） |

执法手段：`scripts/check-menu-test-layout.ts` 扫菜单区测试文件的三类布局快照形态，对 `docs/.menu-test-layout-baseline.json` **只减不增**（同 check-layering 基线范式）——存量债务记基线不阻断，新增即回归红；收敛后 `--update` 收紧。

## 核心职责

- **定位用 id 不用索引**：`findNodeById(nodes, "fog-density")` 树内递归按 id 查（含 children），未命中即失败并**报出全树现有 id 清单**——崩点可直接看出缺哪个。
- **归属用集合不用序**：`childIds(folder).sort()).toEqual([...].sort())` 精确集合（无多无少、重排不敏感）；只需「不少」用 `toContain`，只需「不多」用 `arrayContaining`。
- **id 唯一防线**：`assertNoDuplicateIds(nodes)`——渲染层 `data-testid="preview-<id>"` 撞车检测；check-menu-health 的 id 唯一正则只扫 4 个根表文件，cap 自产树/工厂产出够不到，本 helper 补运行期全覆盖。
- **债务只减不增**：门禁计数制基线（文件×规则→命中数），`--update` 收紧、新增须 `--force`、扫区空 fail-loud（check-ctx-menu-i18n 教训）。

## 对外 API / 入口

`frontend/src/preview-3d/menu/menu-test-helpers.ts`（零上层依赖叶：仅 vitest `expect` + `schema/node-types` 的 `collectPreviewNodeIds`，node/jsdom 双环境安全 import）：

- `findNodeById(nodes: PreviewMenuNode[], id: string): PreviewMenuNode`
- `childIds(node: PreviewMenuNode): string[]`
- `nodeIds(nodes: PreviewMenuNode[]): string[]`
- `assertNoDuplicateIds(nodes: PreviewMenuNode[]): void`

`scripts/check-menu-test-layout.ts` 规则三档（命中行带 `// layout-assert:` 注记豁免，纯注释行不报）：

- R-L1 ordered-snapshot：`map((c) => c.id|kind)` → `toEqual([字面量])`（窗口含 `sort(` 即集合惯例豁免）、`childIds/nodeIds(...)` 同
- R-L2 exact-length：菜单名词接收者（nodes/children/menuItems/…/options）`toHaveLength(数字)`；`.length` 参数（规格驱动）与 `toHaveLength(0)`（行为式）豁免
- R-L3 index-access：`nodes[i]!` / `getMenuNodes()[i]` 等位置索引；`menu/shell`、`menu/render` 目录 DOM 行序索引豁免（渲染器输出契约），`adapters/fbx` 全目录排除（场景图几何节点非菜单节点）

## 与其他子系统关系

- **check-menu-health（ADR-085 姊妹闸）**：查菜单表「合法性」（id/labelKey/i18n/kind 字段错配）；本闸查菜单测试「断言形态」。两道闸各管一层。
- **ADR-021 声明式菜单测试（B 层「菜单即数据」）**：context-menus.test.ts 迭代 MENU_DEFS 的规格驱动范本是「长久」标杆；本三分法把 cap/adapter 手搓树测试向同款耐久度收拢。
- **check-layering 基线范式**：`docs/.layering-baseline.json` 的「只减不增 + --update 收紧 + --force 放行」范式原样搬来；计数制（非行号制）防行漂误报。
- **门禁接线**：`gate-coverage.ts` DOMAIN_BLOCK_CHECKS + `frontend-domain.ts` 以 `blockPolicy: "debt"` 记录（债务型：超基线 WARN 不 blocked，渐进执法期不锁死整条前端域；闸本体 exit 1 供人/AI 显式看到回归信号）。
- **menu-test-fixtures.ts（区分）**：makeMenuCtx/mockMenuHandle 共享夹具（顶层 import preview-state 有副作用，jsdom 测试用）；**勿**把树断言 helper 合并回去。

## 不变量

1. 菜单测试里出现「某节点属于某组」→ 必须经 `findNodeById`/`childIds` 定位 + 集合判据断言；`nodes[i]!` 位置索引 = 新增即红。
2. 行为不变量（control/visibleWhen/值域/i18n）不经本组 helper、不降级为成员断言——逐条硬断言保留（第一档与第二档不可混写）。
3. 顺序/计数断言仅允许产品决策，且该行必有 `// layout-assert: <理由>`（空理由不豁免）。
4. `docs/.menu-test-layout-baseline.json` 只减不增：`--update` 收紧、`--force` 才放行增长；扫区空 fail-loud。
5. helper 归址 `menu-test-helpers.ts` 独立叶（零上层依赖），不得并入带副作用顶层 import 的 fixtures。

## 相关

- 决策：`docs/adr/ADR-311-menu-test-assertion-trichotomy.md`（三分契约 + 渐进执法 + 触碰即还债）
- 执法：`scripts/check-menu-test-layout.ts` + `docs/.menu-test-layout-baseline.json` + 契约测试 `tests/test_check_menu_test_layout.ts`
- 姊妹闸：`docs/knowledge/menu_health.md`（check-menu-health）
- 范本：context-menus.test.ts（规格驱动迭代 MENU_DEFS，ADR-021 B 层）

## 实施进度（随源码演进，ADR 只记方向不记进度）

- ✅ helper 四件套落地（menu-test-helpers.ts 独立叶）+ 基线初始化（首版 336 处/35 文件 → 示范收敛后 320 处/34 文件）。
- ✅ 示范收敛 `fog-capability.test.ts`：16 处债务清零（index-access 12→0、ordered-snapshot 2→0、exact-length 2→0），38 测试全绿。改写形态可直接照抄：顶层/子组成员 → `nodeIds/childIds + .sort()` 集合；逐成员 kind → `findNodeById(id).kind` 行为断言；`getMenuNodes()[1]!` → `findNodeById` 递归（跨层一步到叶）；「恰有两个选项」→ 选项 value 集合断言（指名缺项而非报数字）。
- 🔄 存量债务：余 34 文件共 320 处（light/postprocessing/shadow/sky/water 等大 cap 测试为重灾区）——**触碰即还债**：改哪个 cap 菜单就顺手收敛哪个测试文件，`--update` 收紧基线。不做一次性大 churn（ADR-208 反 big-bang 同范式）。
- 门禁已接 pre-push 域闸（debt 型）+ DOMAIN_BLOCK_CHECKS 双向锁 + 契约测试九项。
