# ADR-121：Shadow DOM 样式隔离铁律

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-08-24
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`scripts/css-layer-check.ts` / `frontend/e2e/settings.spec.ts` / `docs/knowledge/app-content.md`（实施进度）

---

## 1. 背景（Context）

联邦前端大量使用 Shadow DOM（`attachShadow` + `adoptedStyleSheets`）。全局 `frontend/css/components.css` 经由 `index.html` 的 `<link>` 注入 document 层，而 Shadow 边界阻断两类东西穿透：

- **CSS 类**在 shadow 内不生效；
- **`@keyframes`** 在 shadow 内不生效（CSS 自定义属性 `--var` 可穿透，keyframes 不可）。

后果：「类 / keyframe 定义在 components.css」≠「在 shadow 内生效」。此类 bug 纯靠 grep 看不出，build / typecheck 不验证 CSS 实际生效，CI 全绿也能过境。历史上已多次发生（keyframe 漂移、`settings` 样式残留、机检递归盲区）。

## 2. 决策（Decision）

确立「shadow 样式不裸奔」为联邦铁律：

1. 任何新建 Shadow DOM 组件，其样式必须走该 shadow 层内的 CSS（由 `scripts/css-layer-check.ts` 自动发现并校验），禁止依赖全局 `components.css` 的类 / keyframe。
2. 全局 `components.css` 仅承载 document 层 DOM 样式，不得新增 shadow 域类名；已回迁 shadow 的类（`.stg-*` / `.tab-body` / `.settings-group` / `.setting-row`）其全局层副本必须删除，单一事实源在 shadow 层。
3. Shadow 域发现一律**全自动递归**（`css-layer-check.mjs` 遍历 `frontend/src/views/*/`），禁止手写域清单——手写清单是第二批漂移事实源（评审 2026-08-24 第 2 条）。
4. ~~新增 shadow 视图无需改 `css-layer-check`；若需「专属前缀锁定」（检查 3 精准断言），在 `DOMAIN_PREFIXES` 增补前缀数组。~~ **[被 ADR-274 取代]**：`DOMAIN_PREFIXES` 已删除，检查 3 判定域改为「本域 CSS 自己定义过的命名空间」自推导——手写表漏一族即整族静默失明（2026-09 实测 `perf-` 族漏登记，`.perf-controls` 零 CSS 规则却全绿无报）。

## 3. 后果（Consequences）

**校验机制（已落地，此处仅固化事实）**：

| 防线 | 规则 | 级别 |
|------|------|------|
| 检查 1 / 1b | shadow 内 `animation:` 引用的 keyframe 同层须有 `@keyframes` | ERROR |
| 检查 1c | 全局副本与 shadow 侧 keyframe `from translate` 参数值须一致 | ERROR |
| 检查 2 | components.css 不得再含已回迁 shadow 的类 | ERROR |
| 检查 3 | 本域**命名空间**类在 shadow 层须有定义（判定域自推导，见 [ADR-274](./ADR-274-css-layer-check.md)） | WARN |
| e2e `settings.spec.ts` | computed style 断言抓 shadow 裸奔 | 测试层 |

pre-push 通过 `scripts/css-layer-check.ts --strict` 接入；逃生阀 `YSM_SKIP_CSS_LAYER=1`（紧急绕过，需二次确认）。

**正面**：shadow 隔离回归被机检持续拦住，且新增视图零配置自动纳入扫描，根除清单式漂移。
**负面 / 成本**：WARN 级「前缀名实不符」（如 preview 通用组件仍用 `ysm-` 前缀）需单独排期重构，不在本决策范围。

## 4. 数据溯源

- `scripts/css-layer-check.ts` — 自动发现 + 四类检查的实现（commit `43e3b48f` 改为全自动发现，`67bbd157` / `a17ae34e` / `42eecc43` 建立防线）
- `frontend/e2e/settings.spec.ts` — computed style 断言
- ADR-120（Go/Rust 共享扫描状态）与本 ADR 正交：前者是后端扫描缓存，本 ADR 是前端样式隔离，二者无依赖、命名易混淆，特此区分。

<!-- 实施进度（E 问题 preview 前缀重构、.btn 兼容层清理）按联邦纪律记入知识卡 docs/knowledge/app-content.md，不在本 ADR 展开 -->

<!-- 文件名: shadow-dom.md → 实际文件 ADR-121-shadow-dom.md -->
