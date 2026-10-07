---
kind: e2e-visual-feedback
name: E2E 视觉反馈（截图取证）
tier: leaf
category: core
status: active
source_files:
  - frontend/e2e/browser-path.ts
  - frontend/e2e-web/web-ready.ts
auto_fields:
  symbols_with_lines:
    - browsersRoot
    - clearIdbBestEffort
    - findLocalChromium
    - FRAMES_TIMEOUT
    - fullExeRels
    - localChromiumUse
    - OVERLAY_READY_TIMEOUT
    - pinnedChromiumOrThrow
    - registryFacts
    - shellExeRels
    - treeRootFound
    - waitForAppReady
    - waitForOverlayReady
    - waitForRenderFrames
    - WEB_READY_TIMEOUT
tests:
  - frontend/e2e-web/menu-3d-session.spec.ts
  - frontend/e2e/menu-visual.spec.ts
  - frontend/e2e-web/postprocessing.spec.ts
use_when:
  - 看界面长什么样
  - 截图取证
  - 视觉异常定位
  - 界面回归验证
  - 假绿灯排查
  - 需要真 3D 会话
pitfalls:
  - 探测不穿透 Shadow DOM
  - 截图穿透 Shadow DOM
  - 假绿灯三重门
  - 单变量对照实验
  - readPixels 需自建 renderer
  - 固定 sleep 等启动就绪（本地绿 CI 红）
quick_groups:
  - 测试与验证
quick_intents:
  - 想知道界面长什么样，用截图取证而非断言计数
  - 视觉异常说不清来源时，做单变量开关对照实验
  - 测试报绿但没验到东西时，查静默吞异常与条件跳过
  - 本地 e2e 绿但 CI 恒红时，先查固定 sleep 与启动就绪
quick_risk_lines:
  - 元素在 Shadow DOM 内，页面内 querySelector 查不到而截图里明明有
  - 断言写成 if (count() > 0) 或 .catch(() => {}) 会让未生效的流程报绿
  - 用 waitForTimeout 等应用启动（而非轮询就绪条件）在本机恒绿、CI 慢启动必红
invariant_anchors:
  - frontend/e2e/browser-path.ts|findLocalChromium
  - frontend/e2e-web/menu-3d-session.spec.ts|start3D
---

# E2E 视觉反馈（截图取证）

## 概览

让 agent「看到」界面长什么样的三条通路。本卡记录**方法**与**踩过的坑**，不记录具体 UI 布局。

核心立场：**截图是证据，断言是防退化**。只断言不截图，agent 与人类都看不到真相；只截图不断言，回归无人守。

## 三层配置（选错层 = 测不到真东西）

| 配置 | 端口 | testDir | 用途 |
|------|------|---------|------|
| `playwright.config.ts` | mock 桥 | `e2e/` | 结构/逻辑，可无 WebGL |
| `playwright.web.config.ts` | 真 WebGL | `e2e-web/` | **真 3D 会话**、像素级渲染 |
| `playwright.coverage.config.ts` | — | — | 覆盖率 |

**关键**：脱离 3D 会话直接 `mountPreviewRootMenu`，依赖 cap 的面板只能拿到「进 3D 后再开」的说明文本。**要验真控件必须起真会话**（见 `menu-3d-session.spec.ts|start3D`）。

浏览器路径由 `browser-path.ts|findLocalChromium` 探测，装了任意版本 chromium 的机器都能跑；CI 无本地浏览器时回落 Playwright 默认解析。

## 对外 API / 入口

```bash
# 结构巡检（mock 桥，快）
npx playwright test --config playwright.config.ts menu-visual

# 真 3D 会话（真 WebGL，需 swiftshader 参数）
npx playwright test --config playwright.web.config.ts menu-3d-session
```

**软渲染参数**：headless 无 GPU，须钉 SwiftShader 参数。2026-10 起 `playwright.web.config.ts` **project 级**统一钉住 `args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"]`（跨环境确定性，CI 无 GPU 亦可跑）；spec 级 `test.use({ launchOptions })` 仅在需**硬钉 executablePath** 时再写（spec 级 launchOptions 深合并优先）。钉浏览器可执行文件走 `browser-path.ts|pinnedChromiumOrThrow`（探测不到即抛清晰错误防「环境没了全绿」；旧三 spec 各写一份 `${LOCALAPPDATA}` 硬编码兜底已收口）。`launchOptions` 内**条件展开会破坏 `test.use`** 的旧坑仍在，用值级 `??` 兜底。

**软渲染成本随 CPU 负载放大**：SwiftShader 截图是纯 CPU 光栅化，本机并行跑多套 web e2e 时单张截图成本数倍放大——`test.slow()`（60s）对六场景取证不够，且**失败点每轮漂移**（这轮 `waitForLoadState`、下轮 `screenshot`、再下轮 `locator.focus`）——漂移即环境性超时信号，非断言回归，处置是 `test.setTimeout(150_000)` 放宽而非改断言（实证：water-wave-evidence 六场景，2026-10-04）。

## 视觉异常定位：单变量对照实验

**这是本卡最重要的一条。** 定位画面异常时，禁止「看到现象 → 套已知模板 → 解释」。

做法：找该效果在 `env-state-schema.ts` 里的开关，**每次只动一个**，截图对照。23 个 `water*` / `groundGridVisible` / `skyEnabled` 之类的开关**就是可证伪的假设**。

### 一次真实的三层误判（2026-10-04）

空场景截图里有「密集水平细线 + 柔和山峦」，连续判错三次：

| 轮次 | 我的判断 | 实验 | 真相 |
|------|---------|------|------|
| 1 | z-fighting（深度精度） | 读 `PerspectiveCamera` near/far 推算 | ❌ 无关 |
| 2 | 柔和山峦是云层 | grep 到 `cloudCoverage` uniform | ❌ 画面无云（默认 0） |
| 3 | — | `groundGridVisible:false` → 细线消失 | ✅ 细线 = 地面网格摩尔纹 |
| 4 | — | `waterEnabled:false` → 山峦消失 | ✅ 山峦 = **水面** |

**教训**：前两轮都是**先套模板再找证据**。`groundGridVisible` / `waterEnabled` 各一次实验即可定位，两轮追问的代价远高于跑一次对照。

## 坑位清单

### 1. 页面内 querySelector 不穿透 Shadow DOM，截图穿透

3D overlay 挂 `document.body` 且**带 Shadow DOM**：

- `document.querySelector(".preview-dock-nav")` → **null**（canvas / 菜单 dock 全在 shadow 内）
- `page.screenshot()` / `locator.click()` → **正常**（拍渲染结果，能穿透）

**「探测说没有、截图里明明有」就是这个**。页面内查询须显式 `document.querySelector(".mpc-overlay")?.shadowRoot`。

### 2. 假绿灯三重门

报绿但没验到东西的三种形态，**每种都真实发生过**：

- **静默吞异常**：`.catch(() => {})` 把导入失败当无事发生
- **条件跳过**：断言写成 `if (count() > 0) expect(...)`，未渲染时直接跳过仍报绿
- **探测穿错层**：selector 命中 0 个 → 断言写成「≥0 通过」

**反制**：

- 每步**硬断言**（`expect(x).toBe(1)` 而非 `toBeGreaterThan(0)`）
- **下钻必须验内容变化**：`expect(after).not.toBe(before)`，而非「点开了」
- **截图比对哈希**：两次截图字节相同 = 流程没生效
- **丢弃「注释里自认无效」的测试**：明知读不回像素还留着 = 另一个假绿灯

### 3. readPixels 需自建 renderer

`readRenderTargetPixels` 只能读**自建**的 render target。生产 renderer 未开 `preserveDrawingBuffer: true` → **canvas 像素读不回来**。

故 `postprocessing.spec.ts` 的像素断言是**自建 renderer** 复现链路，不是读真实会话。要量化真实画面，须改生产代码开该选项（**有性能代价，不可擅自改**）——此时应诚实报告「无法量化」，不硬凑。

### 4. 假想测试不得留

诊断期间写的临时 spec，**跑完即删**。留下「看起来在诊断、实际什么都没验」的测试，等于给未来的自己埋假绿灯。

## 不变量

- **截图不进版本库**：`_shots/`（含 `e2e/`、`e2e-web/`、`artifacts/**/_shots/`）是 e2e/探针每次运行重写的本地取证产物，已被 `.gitignore` 排除；复查证据用读图工具看本地图或附在 PR/Issue，**勿 `git add`**。Agent 看不到浏览器窗口，唯一通路＝脚本截图存 png → 读图工具回看（`artifacts/e2e-probe.mjs` 一次性探针）。
- **单变量对照**：定位视觉异常时每次只动一个开关
- **硬断言优先**：`toBe(1)` > `toBeGreaterThan(0)` > `if (n > 0)`
- **临时 spec 用完即删**，不留在 `e2e-web/`
- **不改生产渲染参数**来迁就测试（`preserveDrawingBuffer` / `logarithmicDepthBuffer` 皆有代价）
- **`page.evaluate` 内动态 import `/@id/*` 会在冷缓存下被 optimizer 的整页 reload 掐死**（2026-10-07 实证，`postprocessing.spec.ts` 两个 P1-1 用例 CI 恒红）：`playwright.web.config.ts` 的 dev server 是裸 `npx vite --mode web`，键序 id 走 `vite.config.js`。病根是**同一个模块有两条 id**：spec 写 `/@id/three/examples/jsm/postprocessing/SSRPass.js`（vite 解析出 `three/examples/...`），而源码写 `three/addons/...`；启动扫描只看得见静态 import 图里的后者，前者不在预打包集合内 ⇒ 首次请求时优化器现补该 id 并**强制整页 reload** → 进行中的 evaluate 连 in-flight 请求一起被销毁。**「本地绿 CI 红」的又一形态**：开发机 `.vite` 缓存已热故恒绿，CI 每次冷缓存必红。
  - **判据**：err 栈指向含 `.vite/deps` 或 `/@id/` 的那行 import，且启动就绪轮询**已经返回**（排除启动链那次导航）；`_metadata.json` 在运行前查不到该 id、运行后多出来。
  - **治本（唯一有效）**：在 `frontend/vite.config.js` 的 `optimizeDeps.include` 里**显式列出该 id**，启动即预打包 ⇒ 无运行时发现、无 reload、无 `/@id/` 短暂 502 窗口。两条 id 都要列，勿「去重」合并——合并会让其中一条掉回运行时发现路径。
  - **已证伪的错解（勿重蹈）**：在测试侧「先暖 import 吸收 reload」。实测每个 `/@id/` URL 都触发**自己那次**专属 reload，`import` 必然被它掐死，**重试无解**（重试只是再撞一次）；连续扰动还会让 dev server 在 re-optimize 期间对该 URL 返 **502 Bad Gateway**，比原症状更糟。调大 `waitForTimeout` 同样无效（等待窗口盖不住「一次请求触发一次 reload」的循环）。
- **启动就绪必须靠轮询，禁固定 `waitForTimeout` 等正向结果**（2026-10-07 根因修，E2E-Web CI 恒红）：`e2e-web/` 多个 spec 曾用「`page.goto("/")` → `waitForTimeout(2000~2500)` → 立刻派发组件级 DnD / 起 3D」，那是**墙钟等待**，只对「本机冷启动 < 2s」成立；CI runner（ubuntu + SwiftShader 软渲染）启动链 + WASM 初始化远慢于此 ⇒ `tree-root` 还没建出来就动手，报 `app-tree tree-root 未就绪`；`menu-3d-session` 首个用例又缺 `test.slow()`，直接撞 20s 默认超时。判据见知识卡 `test-utils.md`「禁止用固定 sleep 等待正向结果——真 flaky」。**共享件 `e2e-web/web-ready.ts`**：`waitForAppReady`（轮询双层 shadow 下的 `tree-root`，**外加 800ms 无导航静默窗**）/ `waitForOverlayReady` / `waitForRenderFrames`（观察 rAF 帧计数增量而非等毫秒）/ `clearIdbBestEffort`。两个易错点：① **应用启动链自发一次同 URL 导航**，`tree-root` 可能在那次导航**之前**就存在——只等它会立刻返回、随后 `evaluate` 撞导航抛 `Execution context was destroyed`（旧 `networkidle+2s` 侥幸盖住了这个窗口）；② 探针容错**只吞**「导航销毁上下文」一类，其余 evaluate 错误必须原样抛，否则就绪等待会退化成「恒 false 直到超时」，把真故障伪装成慢启动（假绿前身）。

## 相关

- `menu-test-assertion.md` — 菜单逻辑断言三分法（ADR-311），本卡管**视觉层**断言
- `testid-contract.md` — `data-testid` 契约：数行元素用 `[data-testid^="preview-"], [data-testid^="cap-"]`，**禁单个 class**
- `pitfalls.md` — 本卡 3 类坑的浓缩条目
- `preview-menu.md` — 菜单 schema 与 dock 路由
- `preview-core.md` — `mount3D` 会话生命周期
