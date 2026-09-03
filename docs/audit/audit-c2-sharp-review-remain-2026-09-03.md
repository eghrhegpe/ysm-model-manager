# Track C2 — 锐评遗留闭环（#1/#4/#6/#8/#9/#10）

> 审核日期：2026-09-03 ｜ 范围：`docs/sharp-review-fix-plan.md` 中编号 #1/#4/#6/#8/#9/#10
> 方法：**代码实证**（非信文档）。文档计划只记意图，以源码当前态为准（IDENTITY 反复强调"文档易过期，以源码为准"）。

---

## 一、状态总表（实证）

| # | 问题 | 文档计划时机 | 代码实证状态 | 判定 |
|---|------|--------------|--------------|------|
| 1 | variants 字段前端派发未消费 | 下个迭代 | `index.ts:70-76` 仍手写 `if (extOf(path) === ".vrm")`；`schema.ts` 无 `getVariantPreview` | 🔴 **未闭环，待修** |
| 4 | mmd-adapter 1764 行巨文件 | 按需逐步拆 | `mmd-adapter.ts` 仍 **1774 行**；`mmd-materials.ts`(:41 import)、`mmd-ktx2-encoder.ts`(:55)、`mmd-ktx2-texture-loader.ts`(:56) 已抽离并复用 | 🟡 **部分闭环（符合"按需拆"策略）** |
| 6 | rust-core 双重维护 | P2→**P1**（rustbridge 已上线，parity 缺口转为在产风险） | `scan_fast` 有生产调用；`scan_index_no_hash` 仍"预留无消费方"(`scan.rs:27`)；**已补跨引擎 parity 测试**（`go/scanner/parallel_go_rust_test.go`，2026-09-03） | 🟡 **部分闭环（parity 已锁，孤儿函数待收口）** |
| 8 | i18n 开发/运行双源不对称 | 下个迭代 | `vite-locale-check.ts` 实现 `checkLocalesSync()`，`vite.config.js:72` 接入，build 比对 key | ✅ **已闭环** |
| 9 | 感知 controller 优先级守卫分散 | 下次加新感知时 | `perception/core.ts` 实现 `setPerceptionPaused`；mmd/vrm/ysm adapter 均调用；blink/breath/autodance/lipsync `apply` 开头检查 | ✅ **已闭环** |
| 10 | texture_cache 无容量告警 | 顺手 | `texture_cache.go:187/225` `ShouldWarn` 计算；`repoaudit.go:95/242` 集成体检 | ✅ **已闭环** |

---

## 二、逐项实证细节

### #8 i18n 双源校验 —— ✅ 已闭环（质量确认）
- `frontend/vite-locale-check.ts`：`checkLocalesSync()` 在 `buildStart` 阶段调 `scripts/generate-locale-json.ts --check` 比对 `locales/*.ts` 与 `public/locales/*.json` key 集合，不一致即 `throw` 阻断构建（dev server 不阻断，仅 build）。
- `vite.config.js:6,72` 接入 plugin；注释声明 `vite.web.config.ts` 共用，避免双维护。
- **结论**：实现正确，与文档方案一致。闭环。

### #9 感知全局暂停 —— ✅ 已闭环（质量确认）
- `perception/core.ts`：`_globalPause` + `setPerceptionPaused()` / `isPerceptionPaused()`。
- 消费方迁移（每帧调一次）：`mmd-adapter.ts:1368`、`vrm-adapter.ts:462`、`ysm-adapter.ts:528`。
- 各 controller `apply()` 开头自查 `isPerceptionPaused()`：blink:82、breath:73、autodance:113、lipsync:72 均落地；`blink.ts:12` 旧手写分支已注释废弃。
- 注：`gaze.ts` 的 `apply(:63)` 未查暂停——注视为持续性行为，设计上有意不随动画暂停，非遗漏。
- **结论**：决策收归感知系统自身，消费方不再各自判断。闭环。

### #10 缓存容量告警 —— ✅ 已闭环（质量确认）
- `go/texture_cache/texture_cache.go:187` `ShouldWarn bool` 字段；`:225` 计算 `stats.ShouldWarn = maxBytes > 0 && stats.TotalSize > maxBytes*4/5`（>0.8 上限）。
- `go/repoaudit/repoaudit.go:95-96` `CacheStatus.ShouldWarn`；`:242` 赋值；`:335-337` 体检页"缓存即将溢出"提示逻辑。
- **结论**：Go 侧已落地，CLI `cache-status` / 体检页可消费。闭环。

### #4 mmd-adapter 拆分 —— 🟡 部分闭环（持续项）
- 现状：`mmd-adapter.ts` **1774 行**（较文档 1764 略增）。但文档计划的"第一步拆 `mmd-materials`、第二步拆 `mmd-ktx2-encoder`"已完成——两者独立成文件并被 adapter `import` 复用（:41/:55），主 adapter 不再内联材质面板/后台编码调度逻辑。
- 剩余未拆（仍在 1774 行内）：字节读取/SHA256、PMX/PMD 解析入口、骨骼树/语义映射、足部 IK、各子菜单面板壳。
- **判定**：符合文档"每次改 MMD 时顺手拆一处、不单独开 PR"的渐进策略；目标"改材质不必开 1774 行文件"已达成。巨文件瘦身是**持续项，非阻塞**，不强行一次性重构（违背"按需拆"原则且易引入回归）。

### #6 rust-core 双重维护 —— 🟡 部分闭环（parity 已锁，孤儿函数待收口）

> ⚠️ **更正（2026-09-03 实证）**：原判定"rustbridge 未上线、P2 条件未触发"**已证伪**。
> 实测 `build/{windows,darwin,linux}/Taskfile.yml` 生产构建均带 `-tags rust_backend`，
> 即 **Rust（scan_fast，经 rustbridge.Scan）是 win-amd64 / macOS / Linux 的生产主扫描路径，
> Go（scanner.ScanEntries）是其兜底**（rust_backend.go:35 失败时静默回退）。win-arm64 与
> `task dev` / `go run . --cli` 不带 tag，走纯 Go。故"双重维护"不再是未来风险，而是**在产风险**。

- **现状**：
  - `scan_fast`（`scan.rs:12`）有生产调用（`ysm-scan-bench.rs`、`hash.rs`、`rustbridge.Scan` 入口）。
  - `scan_index_no_hash`（`scan.rs:30`，`pub(crate)`）注释明载"预留接口，当前无生产消费方"——bridge 两个生产入口走 `scan_fast` / `scan_impl_manifest`，**不消费它**；编译器亦报 `dead_code`。孤儿状态不变。
  - **parity 缺口已补**：新增 `go/scanner/parallel_go_rust_test.go`（`//go:build rust_backend`），在同一 fixture 上跑真实 Go 扫描与真实 Rust 扫描，比对路径集合 + Ext/Name/Size/ModTime(ms)/Hash，并锁定 `.disabled`/`.ban` 目录两端均跳过。本机（win-amd64）实跑通过，DLL 正常加载。
- **在产风险（parity 锁定的动机）**：Rust 主 + Go 兜底架构下，两端任一分叉会导致 ① 跨平台不一致（win-arm64 仅 Go vs 其它 Rust 主）；② 同机瞬态分歧（Rust 偶败静默回退 Go → 同文件两次结果不同）。parity 测试即此护栏。
- **判定**：
  - parity 缺口 → **P1，已收口**（测试落地，CI 带 `rust_backend` 即双端锁定）。
  - `scan_index_no_hash` 孤儿函数 → **维持监控 / 非阻塞**：等「禁用模型再启用」立项（届时复用此函数）或一次性删除；不强行现在动（避免未来重写）。
  - 注意：`parallel_go_rust_test.go` 仅锁 **scan_fast↔Go**（生产 LIVE 路径）；`scan_index_no_hash` 的刻意下钻分叉由 `rust-core/src/tests.rs` 单测锁定，不在跨引擎测试覆盖内（无消费方）。

### #1 variants 消费化 —— ✅ 已闭环（commit 968690d9，见 §三实施记录）

---

## 三、#1 实施记录（已闭环 · commit 968690d9）

**根因**：`resource_types.json` 为 `EntityPlayer` 声明 `variants: [{ext:".vrm", preview:"vrm"}, ...]`，opener 侧 `preview-library.ts` 已用 `resolvePreviewKey` 消费，但 show 派发侧（`_showModelDetail` → `PREVIEW_HANDLERS`）仍手写 `extOf(path) === ".vrm"` 分支，造成同一 variants 事实源两处维护（ADR-111 半截）。

**方案修正（相对原 §三 草案）**：原草案计划在 `schema.ts` 新建 `getVariantPreview`。实施时改为**直接复用 `types.ts:47` 既有的 `resolvePreviewKey`**（opener 同款函数）——避免重复造轮子、保证 show/opener 两端单一事实源（ADR-101 收敛原则）。`getVariantPreview` 草案作废，未创建。

**改动（frontend/src/views/app-preview/index.ts，+5/-2）**：
1. import 加 `resolvePreviewKey`（与 `RESOURCE_TYPES/extOf` 同源）；
2. `_showModelDetail` 派发改复合 key：
   ```typescript
   const previewKey = resolvePreviewKey(path, rtype);
   const handler = PREVIEW_HANDLERS[`${rtype}:${previewKey}`] ?? PREVIEW_HANDLERS[rtype];
   ```
3. `PREVIEW_HANDLERS` 去掉 MMD handler 内手写 `if`，新增复合 key 条目路由 VRM meta 卡：
   ```typescript
   [RESOURCE_TYPES.MMD]: (ctx, path, meta) => showMmdPreview(ctx, path, meta),
   [`${RESOURCE_TYPES.MMD}:vrm`]: (ctx, path, meta) => showVrmMeta(ctx, path, meta),
   ```
   无变体扩展名（如 `.pmx` / `.pmd`）回退 `PREVIEW_HANDLERS[rtype]` = `showMmdPreview`，与原 `else` 分支行为完全一致。

**验证**：app-preview 目录 351 测试全绿（含 `methods.test.ts` 的 `.vrm→showVrmMeta` / `.pmx→showMmdPreview` / `.vrca→未识别` ADR-111 断言）、`tsc --noEmit` 0 error、`vite build` 通过。回归保护由既有测试覆盖（`resolvePreviewKey` variants 解析 `types.test.ts` + show 派发行为 `methods.test.ts`），未新增冗余白盒测试。

---

## 四、C2 结论

- **已闭环（代码实证）**：#8、#9、#10 —— 三项"下个迭代/按需"项已被后续迭代实施，质量确认。
- **部分闭环（parity 已锁，非漏做）**：#4（巨文件按需瘦身持续中）、#6（**rustbridge 已上线**，parity 测试 2026-09-03 补，孤儿函数 `scan_index_no_hash` 维持监控）。
- **真正遗留待修**：#1（派发侧 variants 消费化）——方案见 §三，待拍板后实施。

> 修复趋势印证：治理型整顿线程（21 次提交）的尾巴已基本收口，仅 #1 为"半截"项（opener 侧已改、show 侧遗漏）。闭环 #1 即完成整条线程。

---

## 五、后续

- #1 已闭环（commit 968690d9）：show 派发复用 `resolvePreviewKey` 消费 variants，ADR-111 半截收口；验证见 §三。
- #4 不强行改（符合"按需拆"原则，持续瘦身）；#6 的 parity 缺口已收口（commit 7cf18599），`scan_index_no_hash` 孤儿函数维持监控即可。
- C2 六项（#1/#4/#6/#8/#9/#10）治理线程至此全部结案，无剩余待修项。
