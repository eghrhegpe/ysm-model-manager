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
| A1 | scene-registry 焦点晋升取 Map 插入序末位，非「最近被激活者」 | 产品拍板 | `preview-3d/infra/scene-registry.ts\|unregister`；锁 `scene-registry-focus.test.ts` | 2026-10-12 |
| A4 | sky 4 键（skyTurbidity / Rayleigh / MieCoefficient / MieDirectionalG）UI 出口 | 产品拍板 | `preview-3d/state/env-state-schema.ts`；`preview-3d/caps/sky-capability.ts\|applyUniform` | 2026-10-12 |
| ADR-317 | P1 on-device 终测（CI build-android 仅打 APK，无真机步骤） | 记账观察 | `.github/workflows/release.yml\|build-android`；`scripts/android-build.ts`；`docs/knowledge/ysm-wasi.md` | 2026-10-12 |
| CSP | `new Function` 执行 UMD 文本（unsafe-eval），上严格 CSP 前须换 `import()`/ESM | 记账观察 | `preview-3d/decoder/mmd-ktx2-basis.ts` | 2026-10-12 |
| 族②残余 | `mergeCubes` / `computeBoneLocalPos` 手抄双源，无专属跨语言黄金语料对账（无分叉证据，不开战） | 记账观察 | `preview-3d/mesh/cube-mesh.ts\|mergeCubes`；`preview-3d/mesh/cube-mesh.ts\|computeBoneLocalPos`；`go/threejs/spec.go\|mergeCubes`；`go/threejs/spec-bones.go\|buildBoneLocalData` | 2026-10-12 |
| 机器闸边界 | `write-surface-gate` 方法值链盲区（`r.Restore`/`r.Delete`/`h.Import` 类），换汇聚点即失防、无提醒机制 | 记账观察 | `scripts/_lib/write-surface-gate.ts` | 2026-10-12 |
| 候选 | `check-env-schema-consumers` 补写方检测（写模式多态，误报高，不做） | 候选 | `scripts/check-env-schema-consumers.ts`；`preview-3d/caps/light-persist.ts\|FLATTEN_MAP` | 2026-10-12 |
| 候选 | `applyModelDefaults` 调用方手写有序清单（有契约锁兜底，设计如此） | 候选 | `preview-3d/adapters/shared-infra.ts\|applyModelDefaults`；锁 `preview-3d/adapters/shared-infra.test.ts` | 2026-10-12 |

---

## 已清偿债（不写判词，只指源码 + 简短注记）

> 判词全部留在 archive 快照；此处仅给源码锚，现状以源码树为准。

- **D1 主批** — 7 个 adapter 构造点已 `t()` 收口（2026-10-12）。`friendlyError` 定义处 = `frontend/src/utils/dom/errors.ts:47`（原台账错写成 `errors.ts:64` 已更正）。
- **D1-残余（ADR-331 切片 B，2026-10-12）** — 旁路收窄（B-1 `c462a67ab`，删两处汉字透传）+ 12 处 overlay `safeErrorMessage`→`friendlyError` 与 fbx 保留 Code（B-2 `c3b6dbb51`）+ `i18n-ui-check` 第三通道 THROW_REJECT 把假绿抓成真 59 处（B-3 `f12014f7d`）+ 59 处分类处理（B-4 `9d70a5d27`，8 处用户可见走 `t()` + 51 处内部诊断 `// i18n-allow` 豁免，drift 归零）。见 `frontend/src/utils/dom/errors.ts\|friendlyError`、`docs/knowledge/utils-errors.md`。
- **前向 P3（切片 A，`4accae610`）** — `CODE_KEYS` 补齐 FILE_TOO_LARGE/FILE_EMPTY/MKDIR_FAILED/WRITE_FAILED/IO_ERROR/LINK_FAILED 差集 + 5 处 Go 裸中文 error 改 `AppError`，见 `frontend/src/utils/dom/errors.ts\|CODE_KEYS`、`internal/app/resource_bindings.go\|ReadSchematic`。
- **D2** — `skeleton-fill-panel.ts` 5 处硬编码中文 + `views/app-preview/{mmd-controls,vrm-controls}.ts` 两处 overview 模板全走 `t()`，见 `preview-3d/adapters/mmd/skeleton-fill-panel.ts`。
- **D3** — `i18n-ui-check` 补「UI 值字段上下文」第二判据，见 `scripts/i18n-ui-check.ts`。
- **D4** — 9 处守卫拒绝站点改返回 `types.AppError{Code: ErrInvalidPath, …}`，见 `internal/app/app_guard_apperror_test.go`。
- **D4-残余·ReadFileBytes 错误通道（切片 C / ADR-331-d1，2026-10-12）** — `ReadFileMeta` 加 `ErrorCode`/`Reason`，守卫失败/读失败不再 `continue` 静默丢条目，改填 Meta 保留（`errors.Is(err, fsutil.ErrFileTooLarge)`→FILE_TOO_LARGE，其他→IO_ERROR，守卫→INVALID_PATH）；单文件路径迁到 `ReadFileBytesBatchWithMeta([path])`。见 `internal/app/app_model.go\|ReadFileMeta`、`go/fsutil/limited_read.go\|ErrFileTooLarge`、`frontend/src/backend/read-model-bytes.ts`、`frontend/src/backend/web-fs.ts\|ReadFileBytesBatchWithMeta`。`GetModel3DSpec` 空 spec 另见下方定性条目。
- **D4-残余·GetModel3DSpec 空 spec（2026-10-12 侦察定性）** — **设计行为，非缺口**。空 spec 发生两处：`threejs.Build`/`BuildMulti` 返回 `"{}"`（`internal/app/app_model.go:377/:411`）、`geometry.ParseBedrockGeometry` 无 Bones（`:404`），返回 `&threejs.Model3DSpec{}, nil`。前端 `preview-3d/adapters/ysm-model-preloader.ts:75-85` 已正确处理：空 spec + viewer mode → WASM 兜底降级；空 spec + 桌面非 viewer → `throw new Error(t("preview.err.specEmpty"))`（D1 主批已 i18n，三语齐）。**不派子代理加错误字段**——web/Android 恒空走 WASM 兜底是 ADR-004 降级语义，加字段会破坏降级路径。判词来源：`preview.err.specEmpty` 三语齐 + `ysm-model-preloader.ts:84` 注释 `[D1 收口]`。
- **D5** — 新增 `go/fsutil/limited_read.go::ReadFileLimited`，`app_model.go` 九处裸读全切 50MB 单源口径。
- **D6** — `go/texture_cache/texture_cache.go::ValidHash` + 4 个绑定入口守卫。
- **D7** — **已接线（2026-10-12 `3ab39bd7f`）**：TS `BedrockModel` 补 `texture`/`textures` + 复刻 Go 生产者 + parity 锁面纳入 `textureId`。⚠️ **价值存疑**：字段零业务消费者（全仓 `.textureId` 仅类型声明/测试断言），`tex_<idx>` 为槽位别名非内容哈希，无法缓存命中/按内容去重；历史上一度登记「接线留待产品拍板」（`6ade00e20`），本卡维持接线终态但**不排除未来删除**。**删除路径（低成本）**：拆 `go/threejs/spec_multicomponent_test.go` 3 断言 + `npm run generate:bindings` + 删 TS 字段与两处写入。见 `preview-3d/model/spec-builder.ts\|BedrockModel`、`preview-3d/model/model-group-builder.ts\|postProcessAndTextures`、`go/threejs/spec.go\|TextureID`。
- **D8** — 可折叠容器 disclosure 触发器（`role="button"` + `aria-expanded` + `aria-controls`），见 `preview-3d/menu/render.ts`、`preview-3d/menu/slide-menu.ts\|onActivate`。
- **D9** — ① 去 `role="button"` 包裹 + ② 五处 icon-only 补 `aria-label` + ③ header-toggle `aria-label` + ④ overlay 主动移焦 + ⑤ loadingEl `role="status"` + ⑥ prefers-reduced-motion 热更，见 `preview-3d/adapters/mount-preview-core.ts`、`preview-3d/adapters/mount-shell.ts`、`app-modules.ts`。
- **D10** — `check-a11y` 增 `coverageNeutral` 口径 + 契约测试消费健壮性，见 `scripts/check-a11y.ts`。
- **D11** — `preview-settings.md` 硬计数改指针口径 + 三卡退役 API 标注 + 豁免清单双向对账 + `go-avatar-decode.md` 整卡重写，见 `docs/knowledge/preview-settings.md`、`docs/knowledge/go-avatar-decode.md`。
- **D12** — `check-redlines` 补 **R12**（pointer 红线闸）+ **R14**（dom-contract 收编 + 属性名裸写闸），见 `scripts/check-redlines.ts`、`preview-3d/menu/dom-contract.ts\|ARIA_ATTR`。
- **D12-残余·dock/panel 诊断串（2026-10-12 侦察定性）** — **已清偿**。原 `title` 裸诊断串「`panel: <id>`」/「`dock: <id> · <项 id 列表>」不经 i18n、en/ja 悬停显英文裸串，`[D12 收口 2026-10-12]` 已删，改走机器可读 `data-panel-id`/`data-dock-group`/`data-dock-items`（devtools 右键即见）。判词来源：`preview-3d/menu/engine/core.ts:336` 与 `:606` 的 `[D12 收口]` 注释 + 实际代码用 `list.dataset.panelId`/`btn.dataset.dockGroup`。**原活卡「产品拍板」判词过时，移出未清偿清单。**
- **A2 离屏多角度截图零阴影（2026-10-12 侦察定性）** — **已清偿**。`preview-3d/screenshot/screenshot-render.ts:208-234` 注释「[巡检 2026-10-11 F1 → 2026-10-12 落地] 第四条 WYSIWYG 缝已补：阴影入多角度截图」+ `renderer.shadowMap.enabled` + mesh cast/receiveShadow + applyLights castShadow。双向锁已翻转：`screenshot-render.test.ts:702-750`「阴影边界锁」+ `docs/knowledge/export.md:196-200`「✅ 阴影参与多角度截图（2026-10-12 落地）」。**原活卡「产品拍板」判词过时，移出未清偿清单。**
- **ADR-328 ground cap-enabled（2026-10-12 侦察定性）** — **路径 C 已实施 + ADR 已采纳**。`preview-3d/caps/ground-capability.ts:144` `private enabled` 改名 `private mounted`，注释「能力挂载态…非用户能力开关」= ADR-328 路径 C 原文推荐命名；`node scripts/check-cap-enabled-duality.ts --json` 实测 `errors:0, clean:11`。ADR-328 状态字段已同步「已采纳」。⚠️ **原活卡锚点 `clampFieldValue`/`ARCHIVE_ALIAS` 与 ADR-328 无关，已纠错为 `ground-capability.ts\|mounted`。**
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