---
kind: test-tax-reduction
name: 测试税减负三刀方法论
tier: architecture
category: utils
source_files:
  - frontend/src/preview-3d/adapters/mount-preview-core.ts
  - frontend/src/preview-3d/adapters/mmd/mmd-adapter.ts
  - frontend/src/preview-3d/adapters/fbx/fbx-adapter.ts
  - frontend/src/test-utils/blob-urls.ts
auto_fields:
  symbols_with_lines:
    - _resetSingletons
    - AssembledShell
    - BaseScene
    - BlobUrlStubs
    - buildFbxScene
    - buildMmdScene
    - CameraControlScene
    - cleanupPreview
    - FBX_TARGET_MAX_DIM
    - FbxAdapterDeps
    - FbxDataPort
    - FbxScaleInfo
    - GroupedScene
    - hasActivePreview
    - InstalledPreviewInfra
    - invalidatePreview
    - makeFbxAdapter
    - makeMmdAdapter
    - MmdAdapterDeps
    - MmdDataPort
    - mmdMenuItems
    - MmdMenuItemsOpts
    - MmdPanelHooks
    - mount3D
    - Mount3DOptions
    - normalizeFbxScale
    - PreviewAdapter
    - PreviewBuildCtx
    - PreviewHandle
    - PreviewScene
    - ScreenshotScene
    - SemanticScene
    - stubBlobUrls
    - switchPreview
    - UpdateableScene
tests:
  - frontend/src/preview-3d/adapters/fbx/fbx-adapter.test.ts
  - frontend/src/preview-3d/adapters/mmd/mmd-adapter.test.ts
  - frontend/src/preview-3d/adapters/mount-preview-core.test.ts
use_when:
  - 测试税
  - 测试文件过大
  - mock 复印机
  - 双胞胎测试
  - 墓碑测试
  - stubBlobUrls
  - 夹具沉淀
pitfalls:
  - "行数比（测试/源码）对薄壳文件天然虚高——Proxy/编排壳 ÷ 千行集成测试是分层架构的必然，不是病"
  - "对拍契约测试（contract-b*/对齐 Go xxx.go:行）是跨端一致性防线，砍了拆防线不减税"
  - "测试在测它自己的 mock（手搓 fake DOM + vi.fn 套娃）才是税，真实 IDB 流测试不是"
invariant_anchors:
  - frontend/src/preview-3d/adapters/mount-preview-core.ts|_resetSingletons
  - frontend/src/test-utils/blob-urls.ts|stubBlobUrls
quick_intents:
  - 测试文件太大怎么减
  - 双胞胎测试合并
  - mock 重复怎么收敛
  - stubBlobUrls 怎么用
---

# 测试税减负三刀方法论

## 概览

测试税 ≠ 测试太多，而是「mock 复印机」与「双胞胎测试」这两种结构病。
判据不是覆盖率或行数比，而是：**改一个能力要动几份测试、每份测试有多少行在喂 mock**。
2026 锐评整改以 3 个真实模块为样板沉淀出三刀，累计出清约 1500 行测试税。

## 核心职责

三刀按 ROI 排序，每刀都有「跑绿 + 断言不减」的验收标准：

1. **刀一 双胞胎合体**：同一模块出现 `.test.ts` + `.behavior.test.ts`（或同源多份）时合并为一份，
   统一测试环境，删除手搓 fake DOM / fake window / fake rAF（happy-dom 已提供），
   `as any` 与长类型断言随环境删除自然消失。样板：`mount-preview-core`（1504→827 行）。
2. **刀二 砍墓碑测试**：`it("BUG: ...")` 开头的用例若断言的是「已知错误行为」且现代码已修复，
   测试绿 = bug 还在，零守护价值。处理：已修复的改写为断言真行为；纯文档的删除，
   结论迁 ADR / 知识卡（ADR 只记决策，进度写知识卡）。
3. **刀三 夹具沉淀**：同构 mock 抽成共享工厂进 `frontend/src/test-utils/`。
   样板：`stubBlobUrls`（47+6 处 URL spy 收敛）、`opLogCalls`、`makeRichPort`/`makePort`。
   复用标准：同模式出现 ≥3 处即值得抽工厂；工厂返回 spy 引用供调用次数断言。

## 对外 API / 入口

- `frontend/src/test-utils/blob-urls.ts`：`stubBlobUrls(createImpl?)` → `{ createURL, revokeURL }`，
  成对 stub URL.createObjectURL / revokeObjectURL（happy-dom 无真实 blob），afterEach 的 `vi.restoreAllMocks()` 统一还原。
- 手术产物提交：`0a460fd9`（合体）、`eda4a07c`（mmd 夹具）、`53f89414`（fbx 复用）。


## e2e 墙钟税:为运行时环境殉葬（2026-10-25 锐评实证）

三刀方法论管的是**单测**里的 mock 复印机 / 双胞胎税。e2e 域另有一类**结构性税**——不是 mock 重复，而是「为运行时环境殉葬」：

- 真实墙钟 5–7min 的主税 = Chromium 启动 + SwiftShader 软渲染 WebGL 初始化 + 串行测试逻辑，**与 vite dev server 启动无关**（实测冷启动仅 1.5–2.8s，`playwright.config.ts` 的 `timeout:120000` 只是安全天花板从未触达）。
- 「薄化 vite 配置 / 清空 postprocessing addon 省税」被实测证伪：TRIM（`optimizeDeps.include:[]`）反而比 FULL 慢 1s（缓存命中被清空）；mock 桥纯 DOM 不反射 three，那 5 个 `three/examples/jsm/postprocessing` 对它是死重但只省百毫秒级零头。
- **结论**：此类税只能靠**测试分层**（纯 DOM spec 离开 WebGL runner）/ **并行化**根治，非配置调参可解。已落地的零风险减负是**断言资产**而非配置：`frontend/e2e/visual-baseline.ts`（截图字节级基线防假绿）+ `coverage-breadth.spec.ts` 双层防腐闸（条目数>0 + 触及独立源文件数≥30）。详见 `e2e-visual-feedback.md`。

## 与其他子系统关系

- 依赖 vitest 的 `vi.spyOn` / `vi.restoreAllMocks` 生命周期（工厂不接管 restore）。
- test-utils 目录已有先例（tex-bytes / fake-image / events），按 ADR-146 反桶契约从具体叶文件导入，不走 barrel。
- 前端验证链：`vitest` + `tsc --noEmit` + `check-biome`；提交用 `commit-with-check --files` 白名单防并行会话卷包。

## 不变量

- 手术验收：改完 vitest 全绿且断言数不降（删的是重复/墓碑，不是覆盖）。
- source_files 指向真实存在文件；锚点 `_resetSingletons` / `stubBlobUrls` 被重构触及须同步本卡。
- 减税先看 mock 密度（mock token/百行），不看行数比——薄壳与契约测试是防线不是税。

## 相关

- `docs/knowledge/test-utils.md`：测试工具基建（ADR-035）
- `docs/knowledge/frontend-test-audit.md`：前端测试基建审计
- `.githooks/pre-commit`：biome 自动修复（2026-09 接线，输出走 stderr）
