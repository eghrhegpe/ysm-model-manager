---
kind: optimization_log
name: 优化记录 optimization-log
tier: architecture
adr:
  - ADR-127
category: config
source_files:
  - frontend/src/preview-3d/adapters/mmd-adapter.ts
  - frontend/src/preview-3d/adapters/mmd-ktx2-encoder.ts
  - frontend/src/preview-3d/adapters/mmd-ktx2-basis.ts
  - frontend/src/preview-3d/adapters/mmd-ktx2-worker.ts
  - frontend/src/preview-3d/adapters/mmd-ktx2-texture-loader.ts
  - frontend/src/preview-3d/adapters/mmd-pmx-parser.ts
  - frontend/src/preview-3d/adapters/mmd-pmx-parser.worker.ts
  - frontend/src/preview-3d/adapters/mmd-texture-decoder.ts
  - frontend/src/utils/main-thread-watch.ts
  - internal/app/app_model.go
  - internal/app/app_texture_cache.go
  - go/texture_cache/texture_cache.go
tests:
  - frontend/src/preview-3d/adapters/mmd-adapter.test.ts
  - frontend/src/preview-3d/adapters/mmd-ktx2-encoder.test.ts
  - frontend/src/preview-3d/adapters/mmd-ktx2-texture-loader.test.ts
  - frontend/src/utils/main-thread-watch.test.ts
use_when:
  - 优化
  - 性能
  - 瓶颈
  - 优化记录
  - optimization
  - perf
  - KTX2
  - 纹理缓存
  - 加载速度
  - 内存
  - GPU 内存
  - 闪退
  - 泄漏
  - dispose
perf:
  - cpu-bound
  - gpu-bound
  - concurrent
  - memory-heavy
invariant_anchors:
  - frontend/src/preview-3d/adapters/mmd-adapter.ts|mmdMenuItems
  - frontend/src/utils/main-thread-watch.ts|startMainThreadWatch
---

# 优化记录 optimization-log

按时间倒序排列的优化日志。每行记录一个优化改动，新 AI 读完本表即可了解项目性能演进历史。

## 优化日志

| 日期 | 领域 | 问题 | 做了什么 | 效果 | 提交 |
|------|------|------|---------|------|------|
| 2026-08-19 | PMX 加载 | PMX 二进制解析 + 纹理解码全在主线程，首次加载数分钟冻结 UI | PMX 解析搬入 Worker（`mmd-pmx-parser.worker.ts`）+ 纹理解码 Worker 池（`createImageBitmap`）+ rAF 12ms 切片构建几何/材质/骨骼；`createPmxParser` 加 Worker 不可用降级守卫 | 小模型 **~3s 登场**；测试环境 18/18 转绿 | `aed0a817`, `2ebcfaf3` |
| 2026-08-19 | KTX2 直载 | 二次加载仍先解码全部 PNG（Decode Image 48 次/3.2s），缓存只省 GPU 内存不省解码时间 | 方案 A：`Ktx2TextureLoader` 拦截 `loadTextureResource` 的 loader 选择（`manager.addHandler`），缓存命中直接拿 CompressedTexture；回退路径合并进占位纹理（修复前发缺失/模型模块化回归） | `texture` 2900→334ms，二次加载 Decode Image 消失，gpu 2056→384MB | `015da0ec`, `586c052d` |
| 2026-08-19 | KTX2 编码 | WASM encode 是同步调用，26 个纹理主线程串行编码，每次 4096² 阻塞 ~10s | 编码核心抽 `mmd-ktx2-basis.ts`（无 DOM 依赖），`encodeToKTX2` 改 3 线程 Worker 池（transfer 零拷贝 + 120s 超时 + 崩溃整池降级） | 首次加载 UI 不再冻结，编码在后台并行跑 | `32474225` |
| 2026-08-19 | KTX2 编码 | ① basis_encoder 默认从 CDN/相对路径拉取 404（`BasisEncoderModule is not a function`）② loaders.gl 4.4.4 `subarray().buffer` 返回整个底层 ArrayBuffer（假成功，落盘原始 RGBA 大小）③ 8192²（256MB RGBA）WASM 编码 abort ④ TGA 浏览器 Image 解码不了 | 注入本地 `/basis/` 路径；绕开 loaders.gl 直接调 BasisEncoder API 用 `slice(0,n)` 截真实长度；超大纹理（>4096²）尺寸守卫跳过；TGA 不参与编码 | 真压缩落盘（4096²→531KB），`abort`/假成功消除 | `406f237e`, `7296e556`, `081ad16c` |
| 2026-08-19 | 主线程观测 | 排查卡顿只能事后 DevTools trace，抓不到进程在干啥 | `PerformanceObserver` longtask 监听 >50ms 主线程阻塞 → 环形日志（`main-thread/longtask`）；`ktx2-replace` 命中日志 + 编码前过滤已缓存 hash（防重复 WASM 编码） | 环形日志直接报「主线程长任务 962ms @ onImageLoad」；二次加载不再重复编码 | `2a2a8081`, `96bc6f77` |
| 2026-08-19 | KTX2 缓存 | mmd-3d.ts 的 port 漏接 `readFileBytesBatchWithMeta` → `blobUrlToHash` 恒空 → KTX2 编码/替换链路全短路，缓存从未落盘 | 补 meta 批量读取接线（一次 RPC 返回数据+hash），顺带修 e2e MOCK_DATA 契约键 | 缓存管线恢复，首次编码可落盘 | `c20f0e9b` |
| 2026-08-19 | KTX2 缓存 | 加载时间翻倍（getCachedTexture 对每个纹理读文件+算 SHA256，而 readFileBytesBatch 已读一次） | 新增 `ReadFileBytesBatchWithMeta` 一次 RPC 返回数据+哈希；新增 `HasCachedTextures` 批量缓存检查；KTX2 替换改为 `Promise.all` 并发执行 | 加载：1 次 RPC 替代 N+1 次；缓存检查：1 次替代 N 次；替换：并行替代串行 | `fd068ac` |
| 2026-08-18 | KTX2 编码 | PNG 纹理无 KTX2 缓存，GPU 内存 1-2GB 导致移动端 OOM | WASM basis_encoder 后台编码（`@loaders.gl/textures` + `encodeKTX2BasisTexture`），加载后自动编码未缓存纹理到用户目录 | 首次加载不阻塞，后续加载命中 KTX2 缓存，GPU 内存降到 1/4~1/8 | `c5953531` |
| 2026-08-18 | KTX2 替换 | 模型加载后 PNG 纹理仍占用 GPU 内存 | KTX2Loader 在 post-load 阶段替换材质纹理，dispose 旧 PNG | 有 KTX2 缓存时自动替换，释放旧 PNG 纹理 | `cfca7c08` |
| 2026-08-18 | KTX2 缓存 | 无 KTX2 缓存基础设施 | Go 侧 `texture_cache` 包（SHA256 内容哈希 key、用户目录落盘、原子写入）+ `GetCachedTexture`/`SaveCachedTexture` 绑定 | 缓存目录可用，可手动放置 KTX2 文件验证管线 | `31713991` |
| 2026-08-18 | MMD dispose | 切换模型 GPU 内存泄漏（`@moeru/three-mmd` 的 `MMD.dispose()` 仅释放物理引擎，不释放几何/材质/纹理） | `disposeMmdMesh()` 遍历 13 个纹理字段 + `mat.dispose()` + `geometry.dispose()`，输出释放统计到环形日志 | 切换 5 个模型不再闪退，dispose 日志：`tex=58 gpu≈1232.1MB` | `80679cd7` |
| 2026-08-18 | MMD 加载 | 单个模型纹理 GPU 内存 1-2GB（4096²×24 + 8192²×2） | manager.onLoad 输出 GPU 内存估算到环形日志，可追踪单模型显存占用 | 日志可见 `gpu≈2053.3MB`，量化优化目标 | `80679cd7` |

## 当前瓶颈

- **MMD IK 解算（运行时）**：`updateWithMixer(dt, mixer, { ik, grant })` 每帧主线程同步跑 IK 级联（200+ 骨骼），是动画循环 CPU 大头——这是运行时开销，非加载阻塞；感知层（breath/gaze/blink）同样每帧跑，可降频到 30fps
- **超大纹理（>4096²）跳过 KTX2**：8192²（256MB RGBA）WASM 编码内存峰值超限 abort，尺寸守卫直接跳过——这类纹理仍是 GPU 内存大户，只能 PNG 直渲
- **TGA 纹理不参与 KTX2**：浏览器 Image 解码不了 TGA，无法编码缓存（TGALoader 直渲）

## 关键指标

| 指标 | 优化前 | 优化后 | 目标 |
|------|--------|--------|------|
| 模型切换（5 次） | 闪退 | 正常 | 稳定 |
| 单模型 GPU 内存 | 1-2GB | **~384MB**（KTX2 命中） | ~200MB |
| 二次加载 texture 阶段 | ~2900ms | **~334ms** | <500ms |
| 首次加载主线程冻结 | 数分钟（串行 WASM 编码） | **~3s 登场**（Worker 化） | <3s |
| 主线程 >200ms 长任务 | 1122 个 | **13 个** | <20 个 |
| 纹理加载 RPC 次数 | N+1 次 | 1 次 | 1 次 |
| 缓存检查 RPC 次数 | N 次 | 1 次 | 1 次 |

## 相关

- [ADR-098: 3D 预览性能优化](../adr/ADR-098-3d-preview-perf.md)
- [ADR-101: MMD 场景加载性能分析与优化方向](../adr/ADR-101-mmd-loading-perf.md)
- [MMD 适配器知识卡](app-preview.md)
