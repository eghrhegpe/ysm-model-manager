# ADR-228：网页版模型字节直读：消除 base64 往返

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-12
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/backend/read-model-bytes.ts, frontend/src/backend/web-fs-read.ts, frontend/src/preview-3d/decoder/wasm-decode.ts, docs/knowledge/model3d.md`

---

## 1. 背景（Context）

前端解码 `.ysm` 的内存峰值问题（详见 `model3d` 知识卡不变量）。2026-09 专项调研（V8 13.6 / N=64MB 实测）给出的拷贝链口径：

| 层 | 内容 | 量级 |
|----|------|------|
| L1 | base64 字符串 | 1.33N |
| L2 | `atob` 产出串（Latin-1 one-byte） | 1.0N |
| L3 | `charCodeAt` → `Uint8Array` | 1.0N |
| L4 | `HEAPU8.set` 写入 WASM | 1.0N |
| | **合计** | **4.33N** |

其中 **网页版**独有的问题：`web-fs-read.ts|readWebFile` 把 IndexedDB 里的 `ArrayBuffer` 经 `arrayBufferToBase64`（含 `buf.slice(0)` + 字符串 rope + `btoa`）转成 base64 交给解码链，解码链再 `Base64ToBytes` 转回字节。

**关键事实：这里根本没有 IPC / 序列化边界**——`readWebFile` 是纯前端本地函数调用（`web-fs-read.ts` 注释自陈动机是「wasm.ts 解码链零改动复用」）。base64 往返纯属浪费，粗算烧掉 1.33N(b64) + 1.0N(slice) + 1.0N(rope) + 1.0N(atob) ≈ **4.3N**。

而 `isViewerMode()` = 网页版 ∪ Android，**桌面被排除在内存告警外**（见 `large-model`）——即 OOM 风险集中在网页版/Android，桌面不痛。故此项正对风险平台。

同时明确：**桌面无法走同一条路**——Wails 传输只有 JSON（`@wailsio/runtime` 的 `JSON.stringify(body)` → `fetch` → `response.json()`），Go `[]byte` 必然包成 base64 往返，binding 层不存在 ArrayBuffer 通道。桌面侧的传输层优化需另走资产服务器二进制路由（未在本 ADR 范围）。

## 2. 决策（Decision）

**在 backend 层新增统一字节读取 seam，把平台差异收口在 seam 内部；网页版走 IndexedDB `ArrayBuffer` 直出，桌面/Android 保持经 `getApp().ReadFileBytes` + base64 解码不变。**

具体形态：

1. **新增 `backend/read-model-bytes.ts|readModelBytes(path): Promise<Uint8Array | null>`** 作为解码链唯一读取入口：
   - 网页版（`isWebPlatform()`）→ IndexedDB 直读 `ArrayBuffer` → `Uint8Array`，**零 base64 往返**；
   - 桌面 / Android → `getApp().ReadFileBytes(path)` → `base64ToBytes`（现状不变，契约不变）。
2. **`web-fs-read.ts` 抽出 `readWebFileArrayBuffer(path)`**，`readWebFile` 改为复用它再编码——**file key 构造单一事实源**（`parseWebPath` → `file:<type>/<rest>` 只有一处）。
3. **`wasm-decode.ts` 的读取契约从「base64 字符串」上移为「字节」**：`InflightCtx.ReadFileBytes: (p) => Promise<string | null>` 改为 `ReadBytes: (p) => Promise<Uint8Array | null>`，`ReadBytesFromPath` 退化为薄包装（不再各自 `Base64ToBytes`），入口改用 `readModelBytes`。

**为什么不放在 `browserAdapter` 上加方法**：`browser-adapter.ts` 的 `webImpls` 是 `satisfies Partial<GoBindingShape>`——只容纳 **Go binding 存在的键**，且 `get`/`has` trap 仅认 `webImpls` 自有键。加一个非 Wails 契约的方法会破坏该类型约束与能力门控语义；更重要的是**不该为一个纯前端优化去动 Wails binding 契约**（那会波及 `generate:bindings`、`web-fs.ts` 兜底与 Android 桥）。

## 3. 后果（Consequences）

**正面**

- 网页版解码峰值从 4.33N 降至 ~2N（省掉 base64 往返四层中的三层 + 编码侧字符串 rope/slice），正对唯一有 OOM 风险的平台。
- 平台分支收口在 backend seam（`readModelBytes`），**decoder 层不感知平台**；`wasm-decode.ts` 的读取契约从 base64 字符串升格为字节，内部各消费点（avatar / model / tex 三处 `ReadBytesFromPath`）自动受益且**签名不变**。
- Wails binding 契约、`generate:bindings`、Android 桥、桌面行为**全部不变**——零契约风险。
- 顺带消除 `readWebFile` 里 file key 构造的潜在双份（抽 `readWebFileArrayBuffer` 后单点）。

**负面 / 代价**

- 新增一层间接（`wasm-decode` → `readModelBytes` → `web-fs-read`），比原先直接 `getApp().ReadFileBytes` 多一跳；以分层收益换取的。
- 网页版与桌面版的读取实现分叉，两条路径需各自测试（parity 责任落在 `readModelBytes` 的测试上）。

**已知遗留（不在本 ADR 范围）**

- 桌面传输层（`4.33N` 的 L1-L3）仍需资产服务器二进制路由才能砍掉；Wails 无 ArrayBuffer 通道。
- WASM 内部 C++ 的 `m_buffer`/`m_binaryData`/`m_decrypted` 三份中间态（各 ~N_in）与 MEMFS 输出侧 `N_out` 未处理——需改上游解析器且当前 emsdk 工具链缺失。
- **WASM 线性内存只增不减**（上限 2GB，HEAP 高位常驻应用生命周期）——本 ADR 不触及。

## 4. 数据溯源

- 拷贝链四层实测（V8 13.6 / Node 24.16 / N=64MB）：`atob` 后 heapUsed 68.0MB、`charCodeAt` 后 rss 315.3MB vs 基线 183.1MB → L1+L2+L3 = 3.33N，加 `HEAPU8.set` = 4.33N。
- 网页版往返链路：`web-fs-read.ts|readWebFile`（IDB → `arrayBufferToBase64`）→ `decoder/wasm-decode.ts|Base64ToBytes`。
- Wails 传输仅为 JSON：`@wailsio/runtime/dist/runtime.js` 的 `JSON.stringify(body)` → `fetch` → `response.json()`（Android 走 `JSON.parse`）。
- binding 形态约束：`browser-adapter.ts` 的 `webImpls ... satisfies Partial<GoBindingShape>` + Proxy `get`/`has` 仅认自有键。

<!-- 文件名: web-bytes-direct-read.md → 实际文件 ADR-228-web-bytes-direct-read.md -->
