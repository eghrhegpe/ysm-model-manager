# frontend/src/utils — 引擎无关工具层

> 本目录是联邦的「公用事业局」：不 import 任何业务层（features/views/backend），
> 只被上层消费。改动本层须过 `src/core` 准入同构的依赖纪律（见 AGENTS.md 分层红线）。

## 目录地图

| 子目录 | 职责 | 准入 |
|--------|------|------|
| `base/pure/` | 真纯函数（array/clamp/guards/recycle-path/tex-size/web-path/gh-links/safe-error-msg/apperror-text），**零副作用** | 无 DOM 无 IO，相同输入恒同输出 |
| `base/primitives/` | 副作用原语（async/base64/debounce/disposable/lock/log/storage/main-thread-watch/listener-set），仍零上层依赖 | 副作用要被封装成原语 API，不裸奔 |
| `dom/` | 浏览器 DOM 原语（modal 六件套/toast/tooltip/焦点恢复/虚拟滚动/clipboard） | 仅当与具体业务无关、可跨页复用 |
| `animation/` | 基岩版动画 JSON 解析 + Molang 编译器 + 求值器 | `molang-lib/` 为 **vendored 第三方**（见下） |
| `resource/` | 资源类型判定（`types.ts` 单一事实源，全部派生自 `resource_types.json`） | 禁止手写镜像类型/常量 |
| `format/` | 字节/时间/包格式/ysm 动画配置格式化 | 纯函数为主 |
| `cache/` | `with-cached` 通用异步缓存（stampede guard + LRU） | — |
| `debug/` | `dbg` 调试/观测日志 + ring 缓冲 | 见「dbg 两类语义」 |
| `async/` `html/` `icon/` `model-name/` `storage/` | load-guard / HTML 与 MC 格式 / 图标 / 模型名展示 / IndexedDB 封装 | — |
| 根级散件 | `health-report.ts`（跨域共享解析层）、`types-re-export.ts`（bindings 路径收口垫层） | **仅限**同时被 features 与 views 消费的解析层/垫层；有疑问先问 |

## 准入四档（新增文件先对号）

1. **真纯函数** → `base/pure/`：零副作用、可推理、可替换。
2. **副作用原语** → `base/primitives/`：副作用（IO/时间/存储）封装为稳定 API，依赖仍为零上层。
3. **浏览器原语** → `dom/`：与具体业务无关的 DOM 交互能力。
4. **根级散件** → 仅跨域共享解析层（features/views 双消费，R4 豁免），零依赖业务层。

业务归属逻辑（对话框/编辑器/高级筛选等）**禁止**落入 utils 或 `utils/dom`——那是 features/dialogs 的领地（分类事故历史，见 routes-quick 红线）。

## dbg 两类语义（防误删）

`debug/dbg` 分两类，`nodebug=1` 与 `_debug=0` 对两者**整体生效**（排障时手动开启）：

- **临时调试**：排查完成后删除（默认纪律，见 `frontend/AGENTS.md`）。
- **持久观测**：tag 化的模块行为日志，如 `cache/with-cached.ts` 的 `dbg("cache", ...)`（hit/miss/stale/in-flight/invalidate/clearAll 共 13 处）——**保留不删**，但它不属「用完即删」范畴。删代码前如遇 `dbg("<模块tag>", ...)`，先确认是否为持久观测。
- **不进 ring**：ring 缓冲仅 warn 级复盘（上限 200 条），高频 hit 类观测只走 console，勿向 ring 写入。

## vendored 警示

- `animation/molang-lib/`（easing.js/math.js/molang.js/molang.d.ts）为第三方 MIT 代码（Author: JannisX11），**勿改**；升级靠人工回归（无直接测试，间接经 `molang.ts` 封装测试）。
- biome `includes` 白名单只收 `**/*.ts/.tsx`——vendor `.js` 天然免疫。**若未来为别的目的给白名单加 `**/*.js`，vendor 会瞬间被 biome 强风格改写**，须同步加 `!**/utils/animation/molang-lib` 排除。

## bindings 垫层

`types-re-export.ts` 把 `@/bindings` 生成路径收口为单一事实来源；消费方**一律** `@/utils/types-re-export.ts` 别名导入（ADR-146），禁止 `../` 手算深度。

## 测试纪律

- 新模块必须带同目录 `*.test.ts`（TDD）；纯 re-export/垫层除外。
- `storage/idb.ts` 的测试在 `backend/idb.test.ts`（vi.unmock 真实实现，22 用例），勿在 utils 内重复建 mock。