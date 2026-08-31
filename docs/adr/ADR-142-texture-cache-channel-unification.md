# ADR-142：缓存三通道统一：texture-cache 内存池 + 磁盘压缩分层

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-08-31
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-098 texture-cache / ADR-101 方向E KTX2 / ADR-066 vrm GLTF / ADR-112 fbx GLTF；frontend/src/preview-3d/texture-cache.ts；pack-model-adapter.ts；mmd-adapter.ts；mmd-ktx2-texture-loader.ts`

---

## 1. 背景（Context）

「按 URL 复用 GPU 纹理」这一个概念，在 3D 预览层存在三套并行实现，各有出生证但生命周期/契约不统一：

1. **前端内存池**：`frontend/src/preview-3d/texture-cache.ts` 的 `TextureCacheImpl`（LRU + 引用计数，`acquire`/`release`/`disposeAll`/`invalidate`）。由 **ADR-098 P0** 建立，当前只服务「需要显式生命周期」的 YSM `loadTextures`（Image + Texture）与 `pack-model-adapter`（TextureLoader）。其文件头注释自认「MMD/VRM 走 blob URL + 内置 Loader，暂不接入」。
2. **磁盘压缩层**：Go `texture_cache` 包 + WASM basis_encoder（KTX2 跨会话压缩），**ADR-101 方向 E** 追踪。服务 MMD：`mmd-adapter.ts` 走 `HasCachedTextures` / `cachedHashes` / blob URL，配 `mmd-ktx2-texture-loader.ts` 拦截 MMDLoader 纹理路径。
3. **GLTF 原生**：`GLTFLoader` 内嵌纹理经 `LoadingManager.setURLModifier` 重定向 blob URL，纹理由 three 自管，随 scene/geometry 释放。服务 VRM（**ADR-066**）、FBX（**ADR-112**）。

对外表现：缓存设施建好了却只通一个出口——pack/ysm 走池，MMD 走磁盘压缩，VRM/FBX 走 three 自管，三套并存未统一。

## 2. 决策（Decision）

**收敛边界：内存池统一 + 分层，非全格式强归一。**

- **决策 1（统一）**：所有「需要显式生命周期管理」的适配器——pack / ysm / **mmd** / fbx——统一以 `texture-cache.ts` 的 `acquire`/`release`/`disposeAll` 引用计数契约为唯一会话内纹理内存出口（同 URL 只 upload 一次 GPU + 统一释放）。MMD 由「磁盘压缩旁路」纳入池，消除第 2 通道在「会话内内存复用」上的重复。
- **决策 2（例外）**：VRM 的 GLTF 内嵌纹理**不**强塞 JS 池。纹理由 three 的 GLTFLoader 自管，需释放时经 `PreviewScene.dispose` → `VRMUtils.deepDispose`（既有统一出口，见 `cleanup-3d.ts`）兜底。强塞需改 GLTF 内部纹理管线、屏蔽 three 自有优化，ROI 低、行为漂移风险高。
- **决策 3（分层而非合并）**：texture-cache（内存池）与 Go `texture_cache`（KTX2 磁盘压缩）**分层**——前者解决同会话 GPU 去重，后者解决跨会话压缩解码省带宽/省上传。两者关注点不同；若需叠加，KTX2 作为 `acquire` 时 `make()` 的纹理提供方挂在池上层（cache 的 entry 由 KTX2 loader 产出），但定位为**可选适配、不强制**——当 make 因管线不可改造时，允许该 URL 跳过池但不破坏引用计数契约。

**理由**：三通道的真实语义差异（内存生命周期 vs 磁盘压缩 vs three 自管）决定「全格式强归一」是伪需求——强行统一会破坏 three 自有管理并屏蔽 GLTF 内部优化。真正的收敛收益集中在「显式生命周期」这一撮（pack/ysm/mmd/fbx）：一次统一引用计数契约即可消灭大部分重复实现，VRM 生命周期已有 deepDispose 出口。本决策与 ADR-098、ADR-101 方向E 互补，不取代。

## 3. 后果（Consequences）

**正面**：
- pack/ysm/mmd/fbx 共享一个 LRU 引用计数池，同 URL 纹理只 upload 一次 GPU；MMD 纹理反复切换不再各自生成多份副本（兑现 ADR-097 P0 目标）。
- 显式生命周期出口单一，`disposeAll` 集中释放覆盖面扩大，WebGL 泄漏面收敛。

**负面 / 代价**：
- MMD 接入内存池是**真实改造、非纯搬家**——需改动其纹理加载入口（`mmd-ktx2-texture-loader` / `fallback TextureLoader` / `HasCachedTextures` blob 替换）让其经 `acquire` 的 `make()` 层产出 entry；动画（VMD/VPD）与解析链路不受影响。
- texture-cache LRU 容量上限（当前默认 200 条目）对 MMD 的贴图数量需评估 `maxEntries` 调优，避免淘汰过早导致复用失效。

**已知遗留**：
- VRM 保持 GLTF 原生；若未来出现需显式释放的 VRM 贴图场景，再评估脱离。
- FBX 外链贴图缺口（ADR-112 已知）不在本项目范围。

## 4. 数据溯源

- 通道划分与「暂不接入」自认：`texture-cache.ts` 文件头注释。
- 通道2（MMD 磁盘压缩）：`mmd-adapter.ts` 的 `HasCachedTextures`/`cachedHashes`/blob URL + `mmd-ktx2-texture-loader.ts`；决策方向见 ADR-101。
- 通道3（GLTF 原生）：ADR-066（VRM）、ADR-112（FBX）。
- 内存池出生证与 API：ADR-098 P0，`texture-cache.ts` 全文。

<!-- 文件名: texture-cache-channel-unification.md → 实际文件 ADR-142-texture-cache-channel-unification.md -->