# ADR-101: MMD 场景加载性能分析与优化方向

- **状态**：✅ 已采纳
- **方向状态**：A（批量读取）/B（opt-in Worker）/C（主线程切片）已采纳；D（纹理异步上传）/E（KTX2 缓存）为长期方向，非未完成项
- **日期**：2026-08-18
- **决策人**：鲸鱼架构师 + 人类设计师

## 基本信息

| 字段 | 值 |
|------|-----|
| 状态 | ✅ 已采纳 |
| 日期 | 2026-08-18 |
| 决策人 | 鲸鱼架构师 + 人类设计师 |
| 关联 | [ADR-098](ADR-098-3d-preview-perf.md)（3D 预览性能） |

## 背景

用户反馈 MMD 模型首次加载时 UI 冻结严重。通过 Chrome DevTools Performance 录制（Trace 文件 106K 行，窗口 11.1s）定位到具体瓶颈。

## 分析结果

### P0 — UI 冻结级（>500ms）

| 瓶颈 | 耗时 | 来源 | 说明 |
|------|------|------|------|
| `animate()` 阻塞主线程 | **2.43s** | `mount-preview-core.ts:154` | 渲染循环回调收到纹理 blob 分块数据，V8 去优化 10 次 |
| 8 个 `onImageLoad` 回调累计 | **~2.2s** | `chunk-LILSE42S.js:23742` | Three.js 纹理上传 GPU（`gl.texImage2D` 同步阻塞） |

### P1 — 显著延迟（100-500ms×N）

| 瓶颈 | 耗时 | 来源 | 说明 |
|------|------|------|------|
| Go bridge 读 89.5MB PMX ×2 | **1.8–2.7s/次** | `mmd-adapter.ts:64 → app.ReadFileBytes` | 大二进制通过 JSON 序列化传输 |
| 2×67MB 纹理 blob 流式加载 | **4.9s** | `@moeru/three-mmd.js:3656` | 以 ~2MB 块触发主线程回调 |
| 纹理解码峰值 | **469ms** | `Decode LazyPixelRef` | 大纹理解码阻塞主线程 |

### P2 — 轻度（<100ms）

| 瓶颈 | 耗时 | 来源 |
|------|------|------|
| 主 bundle 脚本编译 | **105ms** | `chunk-LILSE42S.js`（Three.js + MMD parser） |
| Heap 18→191MB，40 次 GC | 累计影响 | 模型加载期间内存压力（9 次 Major GC） |

### 根因

**~300MB 数据全部同步压在主线程**：
1. Go→JS 序列化 PMX 文件（89.5MB ×2）
2. Three.js 纹理材质组装（`assembleMMD → loadTextureResource → buildMaterial`）
3. 图片解码（`Decode LazyPixelRef`）
4. GPU 纹理上传（`gl.texImage2D` 同步阻塞）

没有任何 Worker 卸载，全部在主线程同步执行。

## 优化方向

### 方向 A：Three.js 模块预加载（P2，已实现 ✅）

应用启动时 `import("three")` 预热，省掉首次 105ms 脚本编译。

- 实现：`app-modules.ts` 启动 IIFE 中 `import("three").catch(() => {})` 非阻塞预加载
- 收益：首次加载减少 ~100ms
- 风险：无

### 方向 B：Go bridge 批量读取（P1，已实现 ✅）

把 N 次 `readFileBytes` RPC 合并为 1 次 `ReadFileBytesBatch`，减少 Go↔JS IPC 往返。

- 实现：`app_model.go` 新增 `ReadFileBytesBatch(paths []string) map[string][]byte`；`mmd-adapter.ts` 纹理/VMD/VPD 加载改用批量 API
- 收益：纹理加载从 N 次 RPC → 1 次；VMD/VPD 同理
- 风险：无（降级路径：batch 失败时逐个 fallback）

### 方向 C：PMX 文件 Worker 化（P1，中等）

把 `readFileBytes` + PMX 解析移到 Web Worker，不阻塞主线程。

- 实现：新建 `mmd-worker.ts`，PMX 解析在 Worker 中完成，结果通过 `postMessage` 传回
- 收益：主线程释放 1.8–2.7s×2 = **3.6–5.4s**
- 风险：Worker 无法直接访问 DOM/Canvas，需 `OffscreenCanvas` 传入

### 方向 D：纹理上传异步化（P0，复杂）

用 `OffscreenCanvas` + Worker 做图片解码，或 Three.js `TextureLoader` streaming。

- 实现：`onImageLoad` 回调中将 `gl.texImage2D` 调用移到 Worker
- 收益：主线程释放 ~2.2s
- 风险：需要 WebGL 上下文 transfer（`transferControlToOffscreen`），与现有渲染循环冲突

### 方向 E：KTX2 纹理压缩（P1，外部依赖）

隔壁同事已启动 KTX2 纹理缓存管线（Go cache package + WASM basis_encoder）。

- 收益：67MB 纹理 → ~15-20MB（4:1 压缩），减少传输+解码时间
- 依赖：basis_encoder WASM 集成完成

## 决策

| 优先级 | 方向 | 状态 | 负责 |
|--------|------|------|------|
| 立即 | A. Three.js 预加载 | ✅ 已实现 | AI |
| 立即 | B. Go bridge 批量读取 | ✅ 已实现 | AI |
| 短期 | E. KTX2 压缩 | 进行中（隔壁） | 隔壁 AI |
| 中期 | C. PMX Worker 化 | ✅ 已实现（opt-in，`mmd-pmx-worker` 开关 + `mmd-pmx-parser.worker.ts`） | AI |
| 长期 | D. 纹理异步上传 | 待评估 | 待定 |

## 验证方法

- Chrome DevTools Performance 录制（同口径对比）
- `Performance.now()` 打点：`mount3D` 入口 → 首帧渲染
- vitest 单测：Worker 通信 mock

## 已知限制

- Three.js `WebGLRenderer` 不支持 `transferControlToOffscreen`（需 r152+）
- `@moeru/three-mmd` 内部纹理加载逻辑不可控，需 fork 或提 PR
- Go bridge 大文件传输瓶颈需 Wails v3 支持 binary channel（当前仅 JSON）
