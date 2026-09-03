# YSM 前后端统一 & 架构问题研究与修复方案

> 上一轮"锐评"发现的 18 个问题，本文件逐一分析影响面、修复成本、推荐方案。
> 按 **P0（阻塞/易错）→ P1（维护性）→ P2（整洁度）** 排序。

---

## P0 — 阻塞/易错（必须在发版前或近期解决）

### #1 resource_types.json 的 variants 字段在前端派发器未消费

**问题：** `resource_types.json` 为 `EntityPlayer` 声明了 `variants: [{ext: ".vrm", preview: "vrm"}, ...]`，
但 `frontend/src/views/app-preview/index.ts` 的 `PREVIEW_HANDLERS` 仍手写 `if (extOf(path) === ".vrm")` 分支。

```typescript
// 现状（index.ts:70-76）—— 与 JSON variants 平行维护
[RESOURCE_TYPES.MMD]: (ctx, path, meta) => {
  if (extOf(path) === ".vrm") {
    showVrmMeta(ctx, path, meta);
  } else {
    showMmdPreview(ctx, path, meta);
  }
},
```

**影响：** 新增 variant（如 `.fbx` → 某个新预览适配器）必须同时改 JSON 和前端 IF 链。
已有一个测试 `app-preview.methods.test.ts:199` 专门验证 ADR-111 的 `.vrca` 场景，
说明这条分支有回归风险。

**方案：** 在 `PREVIEW_HANDLERS` 之前构建一个 `variantDispatchMap`：
```typescript
// utils/resource/schema.ts 新增
export function getVariantPreview(rt: ResourceType | null, path: string): string {
  if (!rt?.variants?.length) return rt?.id ?? "";
  const ext = extOf(path);
  return rt.variants.find(v => v.ext === ext)?.preview ?? rt.id;
}

// PREVIEW_HANDLERS 用 rtype+previewKey 联合作为 key
const PREVIEW_HANDLERS: Record<string, PreviewShowFn> = {
  "EntityPlayer:mmd": (ctx, path) => showMmdPreview(ctx, path),
  "EntityPlayer:vrm": (ctx, path) => showVrmMeta(ctx, path),
  // ... 其他不变
};

// 派发逻辑
const rt = allResourceTypes.find(t => t.id === rtype);
const previewKey = getVariantPreview(rt, path);
const handler = PREVIEW_HANDLERS[`${rtype}:${previewKey}`] ?? PREVIEW_HANDLERS[rtype];
```
**成本：** 低（30 行改动，核心逻辑在 schema.ts）。
**风险：** 极低——旧分支逻辑完整保留，只是外移为查表。

---

### #2 RESOURCE_TYPES / RESOURCE_TYPE_LABELS 手写双表

**问题：** `types.ts` 里有 14 条 `RESOURCE_TYPES`（标签→ID）和 14 条 `RESOURCE_TYPE_LABELS`（ID→中文名）。
标签语义是前端契约（参与 Go ScanModelEntriesWithLabel 扫描匹配），无法从 JSON 派生。
但**中文名**完全可以由 JSON 的 `name` 字段派生。

**影响：** JSON 新增类型 → 必须手动同步这两张表 → 漏同步 → 前端显示错误类型名。

**方案：** 将 `RESOURCE_TYPE_LABELS` 改为从 `allResourceTypes` 派生：
```typescript
// types.ts
export const RESOURCE_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  allResourceTypes.map(t => [t.id, t.name ?? t.id])
);
```
`RESOURCE_TYPES`（短标签映射）保持手写，注释明确标注"仅此表需手动维护"。
新增一行 TypeScript 测试断言：`Object.keys(RESOURCE_TYPE_LABELS).sort()` 与
`ALL_RESOURCE_TYPES` 完全一致，漏任何一条即 CI 失败。

**成本：** 极低（5 行改动 + 1 行测试）。
**风险：** 零——JSON 的 `name` 字段已在所有条目上填写。

---

### #3 ANDROID_UNAVAILABLE 硬编码列表

**问题：** `platform-web.ts` 的 `ANDROID_UNAVAILABLE` 列表手动维护，每新增一个桌面专属 binding
必须加到这里，否则在 Android 上会调用到一个不存在的函数导致运行时错误。

**影响：** 漏加 → Android 运行期 crash（静默 fail-fast 而非 UI 隐藏）。

**方案：** 不改变现有机制，但在 `check-binding-usage.ts` 或新增 `binding-platform-guard.ts`
里加入自动化对账：
```typescript
// 扫描 bindings/ysm-model-manager/**/*.ts 获取全部 binding 名
// 与 ANDROID_UNAVAILABLE 对比，输出未声明的 desktop-only bindings
```
这是一个**检测工具**而非代码改动，成本极低，能在 pre-commit 阶段捕获遗漏。

---

## P1 — 维护性（应该在发版前或下个迭代解决）

### #4 mmd-adapter.ts 单文件 1764 行

**问题：** 这是整个前端最大的单文件，职责已远超"适配器"：
- 字节读取 / SHA256 hash
- PMX/PMD 解析（独立 parser 模块）
- KTX2 纹理解码（worker + 内存管理）
- 骨骼树构建 / 语义骨骼映射
- 足部 IK / 唇形同步 / 呼吸 / 眨眼 / 注视 / AutoDance 5 个感知 controller
- 材质面板 / 骨骼面板 / 播放面板 / 截图面板 4 个子菜单
- 背景编码调度

**影响：**
- 代码 review 困难（大文件是 reviewer 的噩梦）
- 增量改动容易引入副作用（改一处可能影响另一处的闭包状态）
- 测试覆盖困难（1764 行的文件，测试入口如何组织？）
- 未来新增 MMD 特性（如新的 morph 类型）需要在 1764 行里"找位置"

**方案：** 按**职责层**拆分，而非按行数机械切：

```
mmd-adapter.ts (核心 build() 函数，约 200 行)
├── mmd-pmx-parser.ts          ← 已拆出
├── mmd-ktx2-texture-loader.ts ← 已拆出
├── mmd-texture-decoder.ts     ← 已拆出
├── mmd-anim-library.ts        ← 已拆出
├── mmd-zip-overlay.ts         ← 已拆出
├── mmd-utils.ts               ← 已拆出
├── mmd-materials.ts           ← 未拆（材质控制逻辑，~150 行）
├── mmd-ktx2-encoder.ts        ← 未拆（后台编码调度，~200 行）
├── mmd-foot-ik.ts             ← 在 perception/ 下，已拆出 ✓
└── perception/                ← 已拆出 ✓ (breath/blink/gaze/autodance/lipsync)
```

**优先拆 `mmd-materials.ts`（~150 行，完全自包含）**：材质控制面板是独立功能单元，
与主 adapter 无循环依赖，拆出后 mmd-adapter 减少 ~150 行。

**优先级策略：** 不要求一次性拆分完——按"每次修改 mmd-adapter 时顺手拆一处"的原则，
逐步瘦身。目标是：下次有人需要改 MMD 材质相关逻辑时，不需要打开 1764 行的文件。

---

### #5 CLI↔GUI 参数传递链是损耗型桥梁

**问题：** `ExecuteCLI` Wails 绑定走 `map[string]interface{}` → JSON → `os.Args` → `flag.Parse` 的链路，
每条命令的参数都经过字符串化/类型推断，`filesRoot` 还硬编码特殊处理。

**影响：** 新增 CLI 命令参数 → 必须手动处理 JSON→flag 的类型转换，漏处理 → 参数静默丢弃。

**方案：** 短期：为每个命令参数写一个 `paramType` 注释（如 `// param: filesRoot -> --files-root (string, required)`），
让新开发者一眼知道要改哪里。

中期：在 `cli` 包增加一个 `ParamSpec` 元数据表，`ExecuteCLI` 根据元数据自动构建 `os.Args`，
不再手写 switch case。这相当于给 CLI 注册表加一个"参数 schema"。

**成本：** 中期方案较大（需改 cli_bridge.go + 所有命令注册），短期方案是文档化。
**建议：** 先做短期方案（doc comment），在下一个大型功能（如 workshop 重构）时顺带实现中期方案。

---

### #6 rust-core 扫描与 Go 扫描的双重维护

**问题：** `rust-core/src/scan.rs` 有 `scan_fast`（兼容 Go 语义）和 `scan_index_no_hash`（故意分叉）两个函数。
前者是"零用途的备份实现"，后者是"预留接口"，两者都没有生产调用方。

**影响：** Go scanner 改了扫描规则（如新增禁用目录处理），Rust 不一定同步。
目前无生产风险，但未来如果 rustbridge 被启用，双重维护就是隐患。

**方案：** 在 `.githooks/pre-commit` 的 `GEN_CMDS` 中增加一项：
跑 `rust-test-utils` 的 parity test，对同一份扫描目录，Go 和 Rust 产出相同结构。
这是"契约测试"模式——不保证实现相同，但保证行为相同。

**成本：** 低（已有 rust-test-utils 框架，只需加一个 parity 用例）。
**优先级：** P2，等 rustbridge 真正投入生产后再提升。

---

## P2 — 整洁度（改善可读性和开发者体验）

### #7 repoaudit Result vs HealthReport 双结构体

**问题：** `repoaudit.go` 里 `Result`（单目录）和 `HealthReport`（全仓库合并）语义不同但命名接近，
注释只写了"这是内部结构"，未文档化为什么有两个。

**方案：** 重命名 `Result` → `DirAuditResult`，让名字本身说明语义边界。
同时在 `repoaudit.go` 顶部加模块注释：

```go
// 模块说明：
// DirAuditResult = 单目录审计结果（Audit() 返回）
// HealthReport   = 全仓库体检聚合结果（RepoHealthAuditAll() 返回，合并多个 DirAuditResult）
// CLI health-report 命令调用 DirAuditResult → 序列化输出
// GUI 体检页面调用 HealthReport → 展示综合分数
```

**成本：** 极低（改名 + 加注释）。

---

### #8 i18n 开发/运行双源不对称

**问题：** 翻译函数 `t.ts` 的类型来自 `zh-CN.ts`（编译期），运行时查表用的是 `fetch('locales/zh-CN.json')`。
改 TS 源 → 必须重新 build 才能看到效果；忘记 gen 脚本 → 用户看到英文 key。

**方案：** 在 `vite.config.js` 的 build 阶段增加一个检查：
```javascript
// 构建时比对 zh-CN.ts 的所有 key 与 public/locales/zh-CN.json 的所有 key
// 不一致 → build fail
```
这是一个 pre-build hook，成本极低（~50 行 Node.js 脚本），能完全消除这个不对称。

---

### #9 感知 controller 动画优先级守卫分散在各消费方

**问题：** `blink.ts`/`breath.ts`/`autodance.ts` 的消费方示例都写：
```typescript
if (!action || action.paused) {
  blink.apply(dt, callback);
}
```
这个"动画优先"决策写在每个消费方，而非感知系统本身。

**方案：** 给感知 controller 增加一个全局"暂停标志"：
```typescript
// perception/core.ts
let _globalPause = false;
export function setPerceptionPaused(p: boolean) {
  _globalPause = p;
}
// 各 controller 的 apply() 开头检查：
if (_globalPause) return;
```
消费方只需调用 `setPerceptionPaused(action?.paused ?? false)` 一次，
不需要每个 controller 都判断。

**成本：** 低（新增一个文件 + 5 行修改到每个 controller）。
**风险：** 低（纯内部优化，不影响外部 API）。

---

### #10 texture_cache 无容量限制告警

**问题：** `texture_cache.go` 有 prune 逻辑（5 分钟扫一次，删最老条目），但没有"容量接近上限时告警"。
用户可能不知不觉缓存膨胀到数 GB。

**方案：** 在 `GetCacheStats()` 返回时附加一个 `shouldWarn` 标志：
```go
type CacheStats struct {
    Dir       string
    FileCount int
    TotalSize int64
    ShouldWarn bool // TotalSize > 0.8 * maxCacheBytes
}
```
`RepoHealthAudit` 的 `CacheStatus` 增加 `ShouldWarn` 字段，体检页显示"缓存即将溢出"警告。

**成本：** 低（~30 行）。

---

## 汇总

| # | 问题 | 优先级 | 成本 | 风险 | 建议执行时机 |
|---|------|--------|------|------|-------------|
| 1 | variants 字段未消费 | **P0** | 低（30行） | 低 | 下次改 preview 时顺手 |
| 2 | LABELS 手写双表 | **P0** | 极低（5行） | 零 | 本周 |
| 3 | ANDROID_UNAVAILABLE 漏维护 | **P0** | 极低（加检测） | 中（Android crash） | 下个 commit |
| 4 | mmd-adapter 1764 行 | P1 | 中（逐步拆） | 低 | 按需拆，不急 |
| 5 | CLI 参数传递链损耗 | P1 | 中 | 低 | 下次大改 CLI 时 |
| 6 | rust-core 双重维护 | P2 | 低 | 零 | rustbridge 上线前 |
| 7 | Result vs HealthReport | P2 | 极低 | 零 | 顺手改 |
| 8 | i18n 双源不对称 | P2 | 低（50行 hook） | 低 | 下个迭代 |
| 9 | 感知优先级守卫分散 | P2 | 低 | 零 | 下次加新感知功能时 |
| 10 | texture_cache 无容量告警 | P2 | 低 | 零 | 顺手 |

### 立即执行（本周）✅ 已完成

**#2：RESOURCE_TYPE_LABELS 从 JSON 派生** — ✅ 已修复
- 文件：`frontend/src/utils/resource/types.ts`
- 改动：将 `RESOURCE_TYPE_LABELS` 从手写表改为 `Object.fromEntries(allResourceTypes.filter(t => t.name).map(t => [t.id, t.name!]))`
- 测试：在 `types.test.ts` 新增"与 JSON name 字段完全一致"断言；在 `consistency.test.ts` 新增跨文件对账
- 影响：`maid-model` 的中文名从"车万女仆"变为"车万女仆模型"（与 JSON name 对齐），短标签仍走 `short-label.ts` 的 i18n 体系

**#3：ANDROID_UNAVAILABLE 黑名单扩展** — ✅ 已修复
- 新增 15 项桌面专属 binding（广场/文件选择器/Wails 窗口注入/Minecraft 路径等）
- 新增 `scripts/check-android-unavailable.ts` 检测脚本（pre-commit 可集成）
- 更新 `platform-web.test.ts` 覆盖全部 19 项

### 下个迭代（2周内）

**#1：variants 消费化**
- 文件：`frontend/src/utils/resource/schema.ts`（加 `getVariantPreview`）、`frontend/src/views/app-preview/index.ts`（改派发）
- 改动：构建 `variantDispatchMap: Record<string, PreviewShowFn>`，派发时先查 variants 再 fallback rtype
- 成本：~30 行

**#8：i18n build-time key 一致性校验**
- 文件：`frontend/vite.config.js`（加 checkLocales hook）
- 改动：build 时比对 `zh-CN.ts` 所有 key 与 `public/locales/zh-CN.json` 所有 key，不一致则 build fail
- 成本：~50 行 Node.js

### 按需执行（不影响当前体验）

**#4：mmd-adapter 逐步拆分**
- 第一步：拆 `mmd-materials.ts`（~150 行，完全自包含）
- 第二步：拆 `mmd-ktx2-encoder.ts`（~200 行，后台编码调度）
- 策略：每次修改 mmd-adapter 时顺手拆一处，不单独开 PR

**#5：CLI 参数元数据化**
- 短期：每个命令参数的 JSON→flag 转换加 doc comment（`// param: filesRoot → --files-root (string, required)`）
- 中期：在 `go/cli/registry.go` 加 `ParamSpec` 结构，`ExecuteCLI` 自动构建 `os.Args`

**#6：rust-core 契约测试**
- 条件：rustbridge 投入生产前才做
- 方案：在 `rust-test-utils` 加 `pariy_test.rs`，同一份目录，Go 和 Rust 产出相同结构体

**#7：命名统一**
- `repoaudit.Result` → `DirAuditResult`
- 顶部加模块注释说明两层结构语义

**#9：感知全局暂停标志**
- 新建 `frontend/src/preview-3d/perception/core.ts`（~10 行）
- 各 controller 的 `apply()` 开头检查全局暂停标志
- 消费方改为调用一次 `setPerceptionPaused(flag)` 而非每个 controller 各自判断

**#10：缓存容量告警**
- `texture_cache.CacheStats` 加 `ShouldWarn bool` 字段
- `repoaudit.CacheStatus` 加对应字段
- 体检页显示"缓存即将溢出"警告
