---
kind: e2e-visual-feedback
name: E2E 视觉反馈（截图取证）
tier: leaf
category: core
status: active
source_files:
  - frontend/e2e/browser-path.ts
auto_fields:
  symbols_with_lines:
    - browsersRoot
    - findLocalChromium
    - fullExeRels
    - localChromiumUse
    - pinnedChromiumOrThrow
    - registryFacts
    - shellExeRels
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
quick_groups:
  - 测试与验证
quick_intents:
  - 想知道界面长什么样，用截图取证而非断言计数
  - 视觉异常说不清来源时，做单变量开关对照实验
  - 测试报绿但没验到东西时，查静默吞异常与条件跳过
quick_risk_lines:
  - 元素在 Shadow DOM 内，页面内 querySelector 查不到而截图里明明有
  - 断言写成 if (count() > 0) 或 .catch(() => {}) 会让未生效的流程报绿
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

## 相关

- `menu-test-assertion.md` — 菜单逻辑断言三分法（ADR-311），本卡管**视觉层**断言
- `testid-contract.md` — `data-testid` 契约：数行元素用 `[data-testid^="preview-"], [data-testid^="cap-"]`，**禁单个 class**
- `pitfalls.md` — 本卡 3 类坑的浓缩条目
- `preview-menu.md` — 菜单 schema 与 dock 路由
- `preview-core.md` — `mount3D` 会话生命周期
