# preview-3d 巡检追踪器（活指针卡）

> **本卡是活指针，判词以当前源码树为准；历史轮次、决策经过与「当时判定」全部见
> [`docs/archive/preview-3d-review-tracker-2026-10-12.md`](archive/preview-3d-review-tracker-2026-10-12.md)**。
> 每清偿一条，把状态改「已清偿」并只留源码锚 + 一句注记；不要在此复述历史判词。
> `last_verified` = 2026-10-12（本卡改写时对源码树逐条实证）。

---

## 未清偿债清单

> 口径：每条只记 **名称 / 状态 / 指向源码 `文件|符号` / last_verified**。
> 硬编码计数一律不写（如原台账「37+13+2」「10 条」「95 个」）——清单以源码与生成物为准。
> 状态词表：**产品拍板**（已立项、待产品决策）/ **记账观察**（已登记、不排期）/ **候选**（评估中，勿擅动）。

| # | 名称 | 状态 | 指向源码 `文件\|符号` | last_verified |
|---|---|---|---|---|
| D1-残余 | `friendlyError` 旁路收窄（ADR 批）；另 12 处 overlay `safeErrorMessage` 站点 + 20 处内部诊断中文未治理 | 产品拍板 | `preview-3d/adapters/mount-session.ts\|showLoadFailure`；`preview-3d/infra/preview-loading.ts\|safeErrorMessage`；`frontend/src/utils/dom/errors.ts:47\|friendlyError` | 2026-10-12 |
| A1 | scene-registry 焦点晋升取 Map 插入序末位，非「最近被激活者」 | 产品拍板 | `preview-3d/infra/scene-registry.ts\|unregister`；锁 `scene-registry-focus.test.ts` | 2026-10-12 |
| A2 | 离屏多角度截图零阴影接线（WYSIWYG 第四缝） | 产品拍板 | `preview-3d/screenshot/screenshot-render.ts`；声明锁 = `docs/knowledge/export.md` 条目 + `screenshot-render.test.ts`「阴影边界」 | 2026-10-12 |
| A4 | sky 4 键（skyTurbidity / Rayleigh / MieCoefficient / MieDirectionalG）UI 出口 | 产品拍板 | `preview-3d/state/env-state-schema.ts`；`preview-3d/caps/sky-capability.ts\|applyUniform` | 2026-10-12 |
| ADR-328 | ground cap-enabled 三路径收编（A/B/C） | 产品拍板 | `preview-3d/state/env-state.ts\|clampFieldValue`；`preview-3d/state/env-state-schema.ts\|ARCHIVE_ALIAS` | 2026-10-12 |
| D12-残余 | `core.ts:602-606`/`:332-336` `dock:`/`panel:` 内部诊断串当用户 tooltip | 产品拍板 | `menu/core.ts\|renderTooltip` | 2026-10-12 |
| D4-残余 | 6 个无 error 通道绑定（`ReadFileBytes` 等）+ `GetModel3DSpec` 空 spec 无结构化原因 | 记账观察 | `internal/app/app_model.go\|ReadFileBytes`；`internal/app/app_model.go\|GetModel3DSpec` | 2026-10-12 |
| ADR-317 | P1 on-device 终测（CI build-android 仅打 APK，无真机步骤） | 记账观察 | `.github/workflows/android-build*`；`docs/knowledge/ysm-wasi.md` | 2026-10-12 |
| CSP | `new Function` 执行 UMD 文本（unsafe-eval），上严格 CSP 前须换 `import()`/ESM | 记账观察 | `preview-3d/decoder/mmd-ktx2-basis.ts` | 2026-10-12 |
| 族②残余 | `mergeCubes` / `computeBoneLocalPos` 手抄双源，无跨语言黄金语料对账（无分叉证据，不开战） | 记账观察 | `preview-3d/model/model-group-builder.ts\|mergeCubes`；`go/threejs/spec-bones.go`；`preview-3d/model/spec-builder.ts\|computeBoneLocalPos` | 2026-10-12 |
| 机器闸边界 | `write-surface-gate` 方法值链盲区（`r.Restore`/`r.Delete`/`h.Import` 类），换汇聚点即失防、无提醒机制 | 记账观察 | `scripts/check-write-surface-gate.ts` | 2026-10-12 |
| 候选 | `check-env-schema-consumers` 补写方检测（写模式多态，误报高，不做） | 候选 | `scripts/check-env-schema-consumers.ts`；`preview-3d/caps/light-persist.ts\|FLATTEN_MAP` | 2026-10-12 |
| 候选 | `applyModelDefaults` 调用方手写有序清单（有契约锁兜底，设计如此） | 候选 | `preview-3d/infra/shared-infra.ts\|applyModelDefaults`；锁 `shared-infra.test.ts` | 2026-10-12 |

---

## 已清偿债（不写判词，只指源码 + 简短注记）

> 判词全部留在 archive 快照；此处仅给源码锚，现状以源码树为准。

- **D1 主批** — 7 个 adapter 构造点已 `t()` 收口（2026-10-12），剩余见上表 D1-残余。`friendlyError` 定义处 = `frontend/src/utils/dom/errors.ts:47`（原台账错写成 `errors.ts:64` 已更正）。
- **前向 P3（切片 A，`4accae610`）** — `CODE_KEYS` 补齐 FILE_TOO_LARGE/FILE_EMPTY/MKDIR_FAILED/WRITE_FAILED/IO_ERROR/LINK_FAILED 差集 + 5 处 Go 裸中文 error 改 `AppError`，见 `frontend/src/utils/dom/errors.ts\|CODE_KEYS`、`internal/app/resource_bindings.go\|ReadSchematic`。
- **D2** — `skeleton-fill-panel.ts` 5 处硬编码中文 + `views/app-preview/{mmd-controls,vrm-controls}.ts` 两处 overview 模板全走 `t()`，见 `preview-3d/adapters/mmd/skeleton-fill-panel.ts`。
- **D3** — `i18n-ui-check` 补「UI 值字段上下文」第二判据，见 `scripts/i18n-ui-check.ts`。
- **D4** — 9 处守卫拒绝站点改返回 `types.AppError{Code: ErrInvalidPath, …}`，见 `internal/app/app_guard_apperror_test.go`。
- **D5** — 新增 `go/fsutil/limited_read.go::ReadFileLimited`，`app_model.go` 九处裸读全切 50MB 单源口径。
- **D6** — `go/texture_cache/texture_cache.go::ValidHash` + 4 个绑定入口守卫。
- **D7** — 已决策最小接线：TS `BedrockModel` 补 `textures`/`textureId` + 复刻 Go 生产者 + parity 锁面纳入 textureId，见 `preview-3d/model/spec-builder.ts\|BedrockModel`、`preview-3d/model/model-group-builder.ts\|postProcessAndTextures`。
- **D8** — 可折叠容器 disclosure 触发器（`role="button"` + `aria-expanded` + `aria-controls`），见 `preview-3d/menu/render.ts`、`preview-3d/menu/slide-menu.ts\|onActivate`。
- **D9** — ① 去 `role="button"` 包裹 + ② 五处 icon-only 补 `aria-label` + ③ header-toggle `aria-label` + ④ overlay 主动移焦 + ⑤ loadingEl `role="status"` + ⑥ prefers-reduced-motion 热更，见 `preview-3d/adapters/mount-preview-core.ts`、`preview-3d/adapters/mount-shell.ts`、`app-modules.ts`。
- **D10** — `check-a11y` 增 `coverageNeutral` 口径 + 契约测试消费健壮性，见 `scripts/check-a11y.ts`。
- **D11** — `preview-settings.md` 硬计数改指针口径 + 三卡退役 API 标注 + 豁免清单双向对账 + `go-avatar-decode.md` 整卡重写，见 `docs/knowledge/preview-settings.md`、`docs/knowledge/go-avatar-decode.md`。
- **D12** — `check-redlines` 补 **R12**（pointer 红线闸）+ **R14**（dom-contract 收编 + 属性名裸写闸），见 `scripts/check-redlines.ts`、`preview-3d/menu/dom-contract.ts\|ARIA_ATTR`。
- **#2 水 clipBias onCommit** — `preview-3d/caps/water-menu.ts\|wSliderNode`（结构键走 S11 onCommit 范式）。
- **#3 frustum 逐根化（ADR-330）** — `PerFrameEntry{f,root?}` + 4 个动效格式补 `root`，见 `preview-3d/infra/render-host.ts\|markCullMatricesDirty`。
- **#4 KTX2 池终止文案** — 盲区登记注释，见 `preview-3d/infra/worker-bridge.ts\|request`。
- **#5 pack 双源过滤** — `web-fs-pack.ts` 补 `webPackModelEntryMatch` 镜像 Go，view 内联 loose filter 删除，见 `backend/web-fs-pack.ts`。
- **N-1 litematic-3d 域逻辑下沉** — 4 个纯域派生判据下沉 `preview-3d/adapters/litematic-adapter.ts`。
- **N10 真死导出删除** — `PoseScene`/`EnvironmentParams`/`ShadowType`/`TRACE_FORMAT_ADAPTERS`/`DecodeSource` 五处删除，见 `preview-3d/` 相应文件。
- **`Prune.KeptCount` 口径** — 见 `go/texture_cache/texture_cache.go\|Prune`。
- **`decodeYSMComponentsViaWASI` 二次解析** — 首遍 `*types.BedrockModel` 入列复用，见 `internal/app/`。
- **`isGlowBone` 措辞** — 见 `go/threejs/spec-bones.go`。
- **cube UV parity / geometry 选择链 parity** — 见 `tests/fixtures/parity/cube-mesh.golden.json`、`tests/fixtures/parity/geometry-select.golden.json`。
- **F1 decoder 取消闩锁 / F5 decoder 纹理键覆盖 revoke / GPU query 孤儿 / pack 纹理引用计数对称 / adapter dispose 隔离 / build 失败归还 / frustum 注册契约** — 逐轮已清偿，见 archive 快照 §各轮记录 + 对应契约测试。

---

## 相关

- 历史快照：`docs/archive/preview-3d-review-tracker-2026-10-12.md`
- 技术债台账：`docs/knowledge/tech-debt-ledger.md`
- 3D 模式/不变量：`docs/knowledge/3d-patterns.md`、`docs/knowledge/model3d.md`
- 错误呈现：`docs/knowledge/utils-errors.md`、`docs/knowledge/safe-error-msg.md`