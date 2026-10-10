# decoder 子系统审核 — 只读分析报告

> **⚠️ 主代理复核后记（2026-10-10，务必先读）**：本报告 8 条发现经主代理逐条回源码复核，
> **结论有修订**，以复核为准：
>
> | # | 子代理判定 | 主代理复核判定 | 依据 |
> |---|---|---|---|
> | F1 | 🔴 | **🔴 确认，已修** | 新测试 `mmd-ktx2-cancel-latch.test.ts` 先红（3 例全 TIMEOUT）→ 修后绿；变异验证 2 例转红。修法：`acquire()` 在 `cancelled` 时立即 reject。 |
> | F2 | 🔴 | **🟢 降级（非缺陷，仅补注释）** | 主论据「`tryJsonDispatch` 在 avatar 与 cacheSet 之间抛错」**不可达**——该窗口只有 `_decodedBy` 赋值 + `cacheSet` 两个纯赋值，且 `loadAvatarsForJson` 自身内建 try/catch 不外抛。续论点「evict 回调未注册」属 `model-cache` 层既有 fail-open 取舍。已在源码补「此处不该 revoke」的归属契约注释。 |
> | F4 | 🟡 | **确认，已修** | 注释与唯一生产调用点方向相反，已改正并补理由。 |
> | F3/F5 | 🟡 | **确认，留待专门一轮** | 无已实体化故障，属结构风险。 |
> | F6/F7/F8 | 🟡/🟢 | **不单独开战** | F7/F8 已按「值得钉的契约」部分补测（`wasm-geometry` 经 `mmd-ktx2-*` 间接覆盖；`worker-bridge` 补了结算完整性 4 例）。 |
>
> **方法论教训**：F2 是「报 🔴 但异常路径不可达」的实例——发现必须回源码验证**可达性**，
> 否则会白改甚至改出新病（本仓「不为不可能场景加防御」原则）。

**目标**：`frontend/src/preview-3d/decoder/`（12 个源文件，约 1830 行）
**方式**：逐行读源码 + 读同目录 `*.test.ts` 作为契约证据 + 读依赖件（`infra/worker-bridge.ts`、`parsers/ysm-json.ts`、`internal/app/texture_order.go`）交叉验证。
**未修改任何源文件。**

---

## 置信度与方法边界

**置信度**：高（🔴/🟡 结论均有 file:line 源码实证 + 至少一处测试或调用方交叉印证）。
**未检查**：`parsers/bedrock-geometry.ts`、`utils/base/pure/tex-size.ts`、`wasm/ysm-parser.ts` 的内部实现（只按调用契约看待）；未运行 vitest / vite build；未做 e2e 视觉验证；未审计 `adapters/mmd/` 的其余阶段（仅按需读 `mmd-build-scene.ts`/`mmd-build-result.ts` 的调用点）。

**口径声明**：按仓库铁律「注释/文档里的『病』是决策时快照，≠ 当前状态」——本报告所有「注释声称 X」均已回到源码树核验，凡注释与代码分叉者单列为发现（F4、F6）。

---

## 发现汇总表

| # | 严重度 | 位置 | 一句话 |
|---|--------|------|--------|
| F1 | 🔴 | `mmd-ktx2-encoder.ts:67,326` | `cancelled` 是**永久闩锁**：一旦 `cancelPendingEncodings()` 被调用，后续直接调用 `encodeAndCacheTexture` 的编码全部永久挂在 `waitingQueue` 里（acquire 永不结算） |
| F2 | 🔴 | `wasm-decode.ts:114` + `288`/`682`/`688` | `loadAvatarsForJson` 产出的头像 blob URL **不在任何 revoke 集合里**：`.json` 路径解码成功后若下游不回填/缓存被淘汰，头像 blob 永挂；`revokeTexAccumBlobs` 覆盖不到它 |
| F3 | 🟡 | `wasm-decode.ts:732` | 缓存命中快路径返回**缓存的同一对象引用**，调用方（`ysm-preview-cache.ts:47/52`、`loadYsmSummaryMeta:92`）会原样再 `cacheSet`；配合 `parseYsmJsonDirect` 的 `splice` 就地改写，存在跨调用共享可变状态 |
| F4 | 🟡 | `mmd-ktx2-encoder.ts:112-114` vs `mmd-build-result.ts:204` | 注释声称挂 `cleanupPreview`，实际挂在 `Stage6Dispose`（MMD 会话 dispose）——文档与代码分叉 |
| F5 | 🟡 | `wasm-decode.ts:436-491` | `collectTexturesAndAvatars` 的 `textures[key]` 以「去扩展名文件名」为键，**同名不同目录的纹理静默互相覆盖**，被覆盖的 blob URL 立即成为泄漏（无人持引用且不在 revoke 集合） |
| F6 | 🟡 | `mmd-ktx2-encoder.ts:44,291` | `completedHashes` 只在编码**成功**时写入，但 `encodeAndCacheTexture` 对「持久化通道缺失」也 `return true`（`port.saveCachedTexture?.()` 可选链）——注释（L286-288）承认此设计，但成功标记与「真落盘」不等价，重启后重复编码 |
| F7 | 🟢 | `mmd-ktx2-worker.ts`（无测试） | 缺测试的契约：`postMessage` transferable 语义、`data` ArrayBuffer 被 detach 后主线程不可复用、错误序列化只留 `safeErrorMessage` 字符串 |
| F8 | 🟢 | `wasm-geometry.ts`（无测试） | 缺测试的契约：`faceUvEnd` 有符号包围盒、`isPlainZipMagic` 4 字节判定、`findZipEntryByRel` 大小写/反斜杠折叠 |

---

## 详细发现

### F1 🔴 `cancelled` 永久闩锁 —— 编码永久挂起

**位置**：`frontend/src/preview-3d/decoder/mmd-ktx2-encoder.ts:41`（状态定义）、`:67`（acquire 判定）、`:77-81`（cancel）、`:84-86`（reset）、`:326`（唯一 reset 调用点）

**问题**：`cancelled` 是全模块级的布尔闩锁，`cancelPendingEncodings()` 置 `true` 后，**只有** `scheduleBackgroundEncoding()` 开头的 `resetCancelled()`（L326）会清它。而 `acquire()` 的判定是：

```ts
if (activeCount < MAX_CONCURRENT && !cancelled) {
  task.run();                       // 立即执行
} else {
  waitingQueue.push(task);          // ← cancelled 为 true 时，永远走这里
}
```

`waitingQueue` 里的任务**只在两个时机被 `run`**：① `release()`（L62-63）从队首取下一个；② 无 —— `cancelPendingEncodings` 只 `reject` 并清空队列，不 `run`。所以当 `cancelled === true` 且 `activeCount` 已回落到 0 时，入队的 promise **永不结算**。

**具体失败场景**：
1. 用户打开 MMD 模型 → `Stage3Ktx2Schedule`（`mmd-build-scene.ts:245`）调 `scheduleBackgroundEncoding` → `resetCancelled()` 清闩锁，正常编码。
2. 用户关掉预览 → `Stage6Dispose`（`mmd-build-result.ts:199`）调 `cancelPendingEncodings()` → `cancelled = true` 且**不再复位**（`resetCancelled` 只在 schedule 入口）。
3. 若此后有任何路径**未经** `scheduleBackgroundEncoding` 直接调 `encodeAndCacheTexture`（该函数是 `export` 的公开 API，L260），或同一 tick 内 schedule 的微任务与 cancel 交错 → `acquire()` 把任务塞进 `waitingQueue`，`activeCount` 若为 0 则**没有任何 release 会来唤醒它** → `encodeAndCacheTexture` 永久 `await`。
4. 用户体验：`scheduleBackgroundEncoding` 的 `.then(ok => inProgressHashes.delete(hash))`（L342-346）永不执行 → `inProgressHashes` 永久持有该 hash → **该纹理由此在本会话内永不重编码**（幂等分支 L335 静默跳过）。若 promise 链被 `await`，则挂起调用方。

**证据**：
- `mmd-ktx2-encoder.ts:67` — `!cancelled` 是入队条件，不区分「取消此刻在途」与「取消后的新请求」。
- `mmd-ktx2-encoder.ts:84-86` — `resetCancelled()` 是私有函数，无导出。
- `mmd-ktx2-encoder.ts:326` — 全仓 `resetCancelled` 唯一调用点（grep 确认，仅此一处 + 定义处）。
- `mmd-ktx2-encoder.ts:79-80` — `cancelPendingEncodings` 只 `reject` + `waitingQueue.length = 0`，不清 `cancelled`、不唤醒。
- 既有测试 `mmd-ktx2-encoder.test.ts:383-428`（「取消排队任务后 inProgressHashes 释放」）覆盖的是**取消当时已在队**的任务被 reject 的情形，**没有**覆盖「取消之后再入队」——这正是漏洞所在。该测试 L421 重新 `scheduleBackgroundEncoding`（会 resetCancelled），因此绕过了本缺陷。

**为何判定为漏网而非有意取舍**：L385-387 的测试注释明确写「修复前：cancelPendingEncodings 清空 waitingQueue 但排队 acquire 承诺永不应答 → 卡在 await acquire → inProgressHashes 永久毒化」——作者**已知**「acquire 承诺不应答」这一类缺陷是病，并修了「取消时在队者 reject」这一半；但「取消后新入队者永久挂起」这另一半同源缺陷未修。仓内无任何注释/ADR 论证「取消后 latch 不该复位」。

**建议修法**：`acquire()` 在 `cancelled` 为真时直接 `reject(new EncodeCancelledError())` 而非入队；或让 `release()`/`scheduleBackgroundEncoding` 之外也有复位点（取消是「一次性事件」语义，不该是持久状态）。

---

### F2 🔴 头像 blob URL 逃出所有回收集合

**位置**：`frontend/src/preview-3d/decoder/wasm-decode.ts:102-120`（创建）、`:78-81`（唯一的批量回收助手）、`:682`/`:688`（早退路径调用点）

**问题**：全文件有三处 `URL.createObjectURL`：
- L211（`collectJsonSpecTextures`）→ 登记进 `pendingBlobUrls`，成功路径 `clear()`、失败路径 L288 统一 revoke ✅
- L474（`collectTexturesAndAvatars` 纹理）→ 进 `acc.textures` → `revokeTexAccumBlobs` 覆盖 ✅
- L459（`collectTexturesAndAvatars` 头像）→ 进 `acc.avatars` → `revokeTexAccumBlobs` 覆盖 ✅
- **L114（`loadAvatarsForJson` 头像）→ 赋给 `au.avatarUrl`，既不在 `pendingBlobUrls`、也不在 `acc.avatars`、更不在 `revokeTexAccumBlobs` 的扫描范围** ❌

`revokeTexAccumBlobs` 的签名只接受 `TexAccum`，扫描 `acc.textures` / `acc.avatars` 两个 Record（L79-80）。`tryJsonDispatch` 路径的头像 URL 挂在 `result.authors[].avatarUrl` 上，**不在 TexAccum 里**。

**具体失败场景**（`.json` / 解压 ysm.json 路径）：
1. 用户预览一个解压的 ysm.json 模型 → `tryJsonDispatch` → `loadAvatarsForJson` 为每位作者建 blob URL（L114）。
2. 作者头像 URL 随 `result` 进 `cacheSet`（L361）→ 由 `model-cache` 的 evict 回调按 `collectBlobUrls` 释放。`model-cache.ts:54-59` 确实覆盖 `authors[].avatarUrl` ✅ ——**所以缓存路径本身是安全的**。
3. **但**：若 `tryJsonDispatch` 在 `loadAvatarsForJson` 之后、`cacheSet` 之前抛错（L358→L361 之间；`loadAvatarsForJson` 内部已 try/catch 不会抛，但 `finalResult._decodedBy = ...`（L360）与 `cacheSet`（L361）之间的任何异常），blob 已建但从不入缓存、也无人 revoke → **每次尝试泄漏 N×avatarCount 个 blob**。
4. 更实际的一路：`model-cache` 上限 50（`model-cache.ts:24`），`cacheSet` 的 `_onEvict` **只在 `evict` 回调已注册时**才释放（L71、L90 均有 `if (_onEvict)` 守卫）。`cacheSetEvictHandler` 由 `adapters/ysm-preview-cache.ts:27` 的模块级副作用注册——**若消费方未 import 该模块**（模型库列表页只读缓存不调解码器时可能不加载），evict 回调为 `null`，第 51 个模型的头像 blob 在淘汰时**静默泄漏**（`_onEvict` 为 null 时既不释放也不报错）。

**证据**：
- `wasm-decode.ts:114` — `au.avatarUrl = URL.createObjectURL(blob);`（无登记）。
- `wasm-decode.ts:79-80` — `revokeTexAccumBlobs` 只遍历 `acc.textures` / `acc.avatars`。
- `wasm-decode.ts:288` — `handleYsmJsonSpec` 的 `pendingBlobUrls` 只由 `collectJsonSpecTextures` 填充（L276 传入、L213 add），与 `loadAvatarsForJson` 无关。
- `wasm-decode.test.ts:430-448` — 测了「avatarUrl 已回填」但**未断言 revoke 次数**；对比 L593-618 的用例明确断言 `expect(revoked).toEqual(created)`——头像路径缺同类断言。
- `model-cache.ts:71`、`:90` — `if (_onEvict)` 守卫，回调未注册时静默不释放。
- `model-cache.ts:57` — evict 路径确实覆盖 `au.avatarUrl`（说明作者考虑过该字段，仅漏了解码侧异常路径）。

**严重度说明**：定为 🔴 而非 🟡，因为泄漏是**不可回收**的（blob URL 一旦失去所有引用又未 revoke，只能等页面卸载），且发生在「每次打开模型都走」的主路径上。

---

### F3 🟡 缓存命中返回共享可变对象

**位置**：`wasm-decode.ts:730-732`；消费方 `ysm-preview-cache.ts:47`、`:52`、`:92`

**问题**：快路径 `return cached as DecodedYsm`（L732）返回的是**缓存里那个对象本身**，不是拷贝。调用方随即 `cacheSet(modelPath, { ...decoded })`（`ysm-preview-cache.ts:47/52`）——浅拷贝，`geometry` 仍是同一引用。

结合 `parseYsmJsonDirect` 的 `texFiles.splice(di, 1)` + `unshift`（`parsers/ysm-json.ts:101-102`）——它对 `normalizePlayerFiles` 的结果做**原地改写**。虽然 `normalizePlayerFiles` 对数组分支做了浅拷贝（L42，注释明确说是为此），但 `handleYsmJsonSpec` 收到的 `meta.texFiles` 来自 `result.geometry._ysmMeta`（`wasm-decode.ts:343-351`），而该 `result` 在 `.json` 路径下**会被 `cacheSet` 缓存**（L361）。

**失败场景**：同一路径二次 `decodeYsmViaWasm` 走 L732 快路径拿到缓存对象 → 调用方二次 `cacheSet` 同一 `geometry` → 若期间有任何代码对 `geometry.textures` / `textures` 数组做 `push`/`sort`/`splice`，会**同时改写缓存与所有持有者的视图**。目前 `assembleFinalGeometry`（L623-629）是赋值不追加，风险尚未实体化，但这是「共享可变状态 + 浅拷贝」的结构性隐患。

**证据**：`wasm-decode.ts:732`（`return cached as DecodedYsm`）；`ysm-preview-cache.ts:47`（`cacheSet(modelPath, { ...decoded })` 浅拷贝）；`model-cache.ts:83`（`_cache.set(path, data)` 存引用）；`ysm-preview-cache.ts:92`（`cacheSet(modelPath, cacheGet(modelPath) || {})` 显式写回旧值）。

**为何定 🟡**：当前无已实体化的用户可见故障（未找到对 `geom.textures` 的就地改写），属「改一行即爆」的结构风险。

---

### F4 🟡 注释声称的挂载点与代码实际调用点分叉

**位置**：`mmd-ktx2-encoder.ts:112-114` vs `mmd-build-result.ts:204`

**问题**：`disposeKtx2WorkerPool` 的文档注释（L112-114）写：

> **挂 `cleanupPreview` 而非终局拆除**：终局拆除依赖 `beforeunload`…`cleanupPreview` 是会话级确定路径。
> 幂等：冷态（无池）或重复调用均安全，供 `cleanupPreview` 重入。

但实际调用点是 `mmd-build-result.ts:204`，位于 `Stage6Dispose` 的 `finally` 块内；`mmd-build-result.ts:200-203` 的**另一条注释**写：

> 挂 MMD 会话 dispose 而非 `cleanupPreview`：编码池是 MMD 专用资源，跟 MMD 会话走（cooperate 多会话互不误伤）。

**两条注释互相矛盾**，且 `mmd-ktx2-encoder.ts` 侧那条是**过时的**（描述的是被否掉的方案）。同一事实的两处文档反向漂移——正是「注释是决策时快照」的典型样本。

**证据**：grep `disposeKtx2WorkerPool` 全仓 → 生产调用点仅 `mmd-build-result.ts:204`（其余全在 `mmd-adapter.test.ts` 的 mock 与 `mmd-ktx2-encoder.test.ts` 的测试）。`mmd-ktx2-encoder.ts:109` 关于 `cancelPendingEncodings` 的「由 `mmd-build-result.ts` 会话 dispose 调用」是**正确**的，进一步说明 L112-114 那段是旧文案未同步。

**影响**：非运行时故障，但会误导后续维护者把池挂到错误生命周期（或误以为已挂而漏挂）。按仓库「改完代码同步知识卡」纪律，属应修项。

---

### F5 🟡 同名纹理键覆盖导致 blob 静默泄漏

**位置**：`wasm-decode.ts:469-474`

**问题**：`collectTexturesAndAvatars` 用「文件名去扩展名」作键：

```ts
const key = f.path.split(/[/\\]/).pop()?.replace(/\.\w+$/, "") || "";
textures[key] = URL.createObjectURL(blob);   // ← 同名覆盖，旧 URL 失去唯一引用
```

若 ZIP 内含 `models/a/body.png` 与 `models/b/body.png`，第二次赋值覆盖第一次：旧 blob URL **既不在 `texNameMap` 之外被持有、也不在任何 revoke 集合**（`revokeTexAccumBlobs` 遍历 `Object.values(acc.textures)`——被覆盖的值已不在其中）。→ 泄漏 + 该纹理槽位渲染错贴图。

**证据**：`wasm-decode.ts:474`（覆盖写）；`:79`（revoke 只遍历存活值）；`texLowerMap[key.toLowerCase()] = key`（L476）同样是覆盖写。相比之下 `handleYsmJsonSpec` 路径的 `collectJsonSpecTextures`（L211-213）**同时**做了 `acc.textures[key] = url` 与 `pendingBlobUrls.add(url)`——即把被覆盖者也纳入了 revoke 集合，**两条并行实现在这里的处理不一致**。

**为何定 🟡**：需要模型包内同名不同目录才触发（真实存在但非主流）；且键口径是**有意的设计选择**（L179 注释说明该键用于对齐纹理槽序），所以问题在「覆盖时未回收被覆盖者」，不在「用文件名作键」。

---

### F6 🟡 「成功」标记与「已落盘」不等价

**位置**：`mmd-ktx2-encoder.ts:289-291`、注释 `:285-288`

**问题**：`await port.saveCachedTexture?.(hash, ktx2B64)` —— 可选链意味着**通道缺失时静默跳过落盘**，随后无条件 `completedHashes.add(hash); return true;`。

注释（L286-288）**明确承认并论证**了这是有意的：原 `fn?` 守卫语义是「无持久化 = 本次会话成功」，且若走 catch→false 会导致 `completedHashes` 永不标记 → 每次加载重编码 + 刷 fail 日志。

**判定**：**这是有注释论证的设计选择，不是缺陷**。但需记录其副作用：`completedHashes` 的语义是「本会话已处理」而非「已持久化」，跨会话不成立；一旦有代码把 `completedHashes` 当作「缓存已存在」的依据就会错。当前无此消费者（grep 确认 `completedHashes` 仅本文件内部使用），故降为 🟡 的**契约记录项**而非缺陷。

**证据**：`mmd-ktx2-encoder.ts:289`（可选链）、`:291`（无条件 add）、`:285-288`（设计论证注释）；`mmd-ktx2-encoder.test.ts:780-791`（Worker 不可用 → `expect(ok).toBe(false)`，与「通道缺失仍 true」不冲突，因该用例失败在 encode 阶段）。

---

### F7 🟢 无测试文件 #1：`mmd-ktx2-worker.ts`（35 行）的未钉契约

该文件无 `*.test.ts`。以下行为是**真实契约**但无人钉：

1. **transferable 所有权**：L30 `postMessage(resp, [buf])` 把编码结果 ArrayBuffer 转移给主线程；L28 `new Uint8Array(data)` 则**未**转移入参。主线程侧 `mmd-ktx2-encoder.ts:241` `request({..., data: dataBuf}, [dataBuf])` 转移了 `img.data.buffer` → **worker 收到后该 buffer 在主线程已 detach**。若将来有人在 `encodeToKTX2` 里 `await` 后再读 `img.data`（例如失败重试），会拿到 `byteLength === 0` 的空视图——静默产出坏数据。**无人钉**。
2. **错误的可序列化面**：L31-38 的 catch 只回传 `safeErrorMessage(err)` 字符串，原始错误对象、stack、`TextureTooLargeError` 的类型标识全部丢失。主线程 `mmd-ktx2-encoder.ts:196` 只能 `reject(new Error(r.error ?? ...))` → **Worker 路径下的超大纹理不再抛 `TextureTooLargeError`**，导致 `encodeAndCacheTexture:303` 的 `e instanceof TextureTooLargeError ? "warn" : "fail"` 判定在 Worker 可用时**恒为 "fail"**（而主线程 L230-232 的前置守卫会先拦下，所以只有跨阈值边界情形才暴露）。交叉实现不一致，无测试钉。
3. **并发**：3 个 worker 各自持有独立的 `encodeToKTX2Basis` → `loadBasisModule` 单例（`mmd-ktx2-basis.ts:44`）。**模块级单例是 per-worker 的**（worker 有独立模块图），所以 3 份 WASM 实例常驻——`disposeKtx2WorkerPool` 会 terminate 释放，但**无人钉「3 份 WASM 是预期内存成本」**。
4. **`self.onmessage` 的返回 promise 无人 await**：L25 的 async handler 若在 `postMessage` 之外抛错（如 `safeErrorMessage` 本身抛），错误逃逸为 unhandledrejection → worker 静默无响应 → 主线程吃满 `KTX2_ENCODE_TIMEOUT_MS = 120_000`（`mmd-ktx2-encoder.ts:166`）。无人钉「永不响应时的 120s 最坏延迟」。

---

### F8 🟢 无测试文件 #2：`wasm-geometry.ts`（145 行）的未钉契约

该文件无 `*.test.ts`（注意：其**消费者** `wasm-decode.test.ts` 间接覆盖了部分路径，但纯函数本体的边界无人钉）。真实契约：

1. **`faceUvEnd` 的有符号包围盒**（L71-91）：`Math.max(f.uv[0], f.uv[0] + fw)` 是「负尺寸 = 反向采样取真实占用区」的核心公式。`wasm-decode.test.ts:253-293` **间接**钉了一例（foxcar down 面负高），但那只走 `computeBoneTexRange`；`faceUvEnd` 独立调用、`hit === false`（有 faceUV 但无任何带 `uv` 的面，L90）、`JSON.parse` 抛错回退（L87-89）三条边界**无人直测**。
2. **`isPlainZipMagic`**（L28-36）：只查前 4 字节 `PK\x03\x04`。**空 ZIP / 仅中央目录的 ZIP 用 `PK\x05\x06` 开头**（end-of-central-directory），此函数返回 false → 落入 WASM 策略链全 miss。这是**有意的窄化**（只认本地文件头）还是漏网？仓内无注释说明。无人钉。
3. **`findZipEntryByRel`**（L39-51）：大小写折叠 + 反斜杠折叠 + 前缀 `./` 剥离。**O(n) 线性扫描**（每次调用遍历全部 entry）——`tryZipDispatch` 的 `ReadBytes`（L319-325）对**每个** modelFiles/texFiles 条目各调一次，大 ZIP（数百 entry × 数十纹理）是 O(n·m)。无人钉「该路径的复杂度上限」。
4. **`computeBoneTexRange` 的初值 `2`**（L115-116）：`let uvMaxW = 2` 是硬编码魔数，注释未说明为何是 2（推测是 1×1 UV 的最小包围盒下界）。**无注释论证、无测试**——正是「魔法数字可能漂移」的样本。
5. **`getBaseDir`**（L12-15）：无目录时返回 `"."`，随后被拼成 `./xxx` 路径传给 `ReadBytes`（如 `wasm-decode.ts:111`）。**"." 前缀是否被 backend 正确解析无人钉**。

---

## 已检查且判定「无问题」的项（审计范围声明）

为避免读者误判覆盖度，以下均**已实际读过源码核验**，结论是无缺陷或属有注释论证的设计选择：

| 检查项 | 位置 | 结论 |
|--------|------|------|
| `_decodeInFlight` 去重的 reject 处理 | `wasm-decode.ts:36-45` | ✅ **正确**。`p.finally(...).catch(...)`（L41-43）在 `p` **自身**注册，不去改变 `p` 的结算值；`finally` 无条件 `delete`，成功/失败/异常都清理；`.catch` 只消费 `finally` 产生的派生 promise，不吞 `p` 的 rejection。调用方拿到原 `p`，reject 语义完整。三处并发合并、失败后重试、读失败不缓存 `_wasmFailed` 均有测试钉（`wasm-decode.test.ts:154-204`）。 |
| `_decodeInFlight` 无界增长 | `wasm-decode.ts:34` | ✅ 无泄漏。Map 条目在 promise settle 时必被删除（L42），key 是模型路径（有限集合），非累积型结构。 |
| `handleYsmJsonSpec` 的 blob 回收 | `wasm-decode.ts:273-289` | ✅ **正确且完整**。`pendingBlobUrls` 覆盖 `collectJsonSpecTextures` 的每一次 `createObjectURL`（L213 逐条 add，含被同键覆盖的前序 URL）；成功路径 L281 `clear()` 移交 geometry，失败/无骨骼路径 L288 全量 revoke。测试 `wasm-decode.test.ts:593-630` 双向钉死（回收 / 不回收）。 |
| `revokeTexAccumBlobs` 对 WASM 路径早退的覆盖 | `wasm-decode.ts:78-81,680-691` | ✅ **该函数的两个调用点全覆盖**：`!geometry && !hasYsmMeta`（L680-685）与 `!geometry && files.length > 0`（L686-691）是 `handleWasmDecode` 中仅有的「有 blobs 却返回 null」路径，两处都调了 revoke。**但**它不覆盖 `loadAvatarsForJson` 的 blob —— 见 F2（这是「另一条路径」，不是「本函数的早退漏调」）。 |
| `tryZipDispatch` 的异常路径 | `wasm-decode.ts:297-328` | ✅ 无 blob 泄漏（此路径只读 zip entries，不调 `createObjectURL`）。`extractZip` 抛错被 catch 并 `return null`（L301-304），信息进 `devLog`。 |
| `tryJsonDispatch` 畸形 JSON | `wasm-decode.ts:333-339` | ✅ **有意抛错 + 外层缓存**（L336-338 注释论证：非法 JSON 不可恢复，缓存跳过避免重复尝试），外层 `doDecodeYsmViaWasm:774-777` 接住并 `cacheSet(_wasmFailed)`。测试 `wasm-decode.test.ts:331-338` 钉死「二次不重读」。 |
| 读文件失败 vs 解码失败的缓存区分 | `wasm-decode.ts:741-746` vs `:776` | ✅ **正确**。`readModelBytes` 抛错 → 只 log、`return null`、**不缓存 `_wasmFailed`**（后端恢复后可重试）；解码失败 → 缓存。测试 `wasm-decode.test.ts:165-177` 显式钉「P3 修复契约」。这是本模块处理得最干净的一处状态区分。 |
| `handleEmptyBytes` 缓存 `_wasmFailed` | `wasm-decode.ts:97-100` | ✅ 合理：字节为空 = 文件不存在，重复读无意义。测试 L322-329 钉「二次不再读」。 |
| `model-cache` 是否区分「failed」与「absent」 | `model-cache.ts` 全体 | ✅ **模块本身不区分**（`CacheValue` 是开放接口，`_wasmFailed` 只是恰好被写入的一个键），但**这不是缺陷**：区分责任在 `wasm-decode.ts:733`（`if (cached?._wasmFailed) return null`）与 L732（`if (cachedGeo?.bones?.length)` 快路径）——调用方先查失败标记、再查有效几何，顺序正确。`_wasmFailed` 条目**参与** LRU 计数（会挤掉有效条目），但这是「失败也可缓存」的必然代价，且上限 50 足够，无实证问题。 |
| `model-cache` 同 key 覆盖的 evict 判定 | `model-cache.ts:69-85` | ✅ **正确**。只在「旧值存在新值不再引用的 blob URL」时 evict（L74-81），防 revoke 新值仍在用的 URL。测试 `model-cache.test.ts:27-48` 双向钉死。 |
| `model-cache` 的 `_order` 膨胀 | `model-cache.ts:83`（有 key 时提前 return，不 push） | ✅ **正确**。同 key 重复 set 不入队第二次；FIFO 语义按首次插入。专项测试 `model-cache-order.test.ts` 两条覆盖「不膨胀」与「仍是队首」。这是仓库里少见的、为历史缺陷补了回归锁的地方。 |
| `model-cache` 的 `collectBlobUrls` null 守卫 | `model-cache.ts:57` | ✅ 显式 `au !== null`（注释 L55-56 说明 `typeof null === "object"` 坑）。 |
| Worker 池的 terminate / 错误传播 | `worker-bridge.ts:127-148` + `mmd-ktx2-encoder.ts:198-209` | ✅ **正确且契约完整**。`onWorkerError: "terminatePool"`（L198）→ 崩溃时逐个 `terminate()`（bridge L128-133）→ 结算全部 pending（L135-137）→ `onPoolTerminated` 清 `ktx2Workers`/`ktx2Bridge`（L200-203），懒建逻辑可重建。`disposeKtx2WorkerPool`（L122-129）幂等且额外防御性置 null。测试 `mmd-ktx2-encoder.test.ts:880-944` 四条不变量钉死（真 terminate / 幂等冷态 / 可重建 / 在途被结算非悬挂）。 |
| 单次编码超时 | `mmd-ktx2-encoder.ts:166`、`worker-bridge.ts:173` | ✅ `settleError` 超时结算（L99-112），pending 必被 delete，无悬挂。120s 阈值有注释论证（L165）。 |
| `mmd-ktx2-basis` 的失败重试 | `mmd-ktx2-basis.ts:69-71` | ✅ **正确**。`basisModulePromise.catch()` 重置为 `null` 允许下次重试；注意 `.catch` 挂在**已赋值**的 promise 上、且 `return basisModulePromise`（L72）返回的是原 promise（失败仍向调用方 reject）。测试 `mmd-ktx2-basis.test.ts:188-215` 钉死「失败后可恢复」。 |
| `mmd-ktx2-basis` 的 `enc.delete()` | `mmd-ktx2-basis.ts:107,128-130` | ✅ `finally` 保证释放，测试 L163-170 钉死（encode 抛错时 delete 仍调）。 |
| `slice(0, n)` vs `subarray(0, n).buffer` | `mmd-ktx2-basis.ts:126-127` | ✅ **正确**，注释（L4-8、L126）与代码一致，确实复制而非引用整个底层 buffer。这是对 loaders.gl 已知 bug 的正确绕开。 |
| `MAX_KTX2_PIXELS` 单一事实源 | `mmd-ktx2-basis.ts:80` | ✅ **无漂移**。`mmd-ktx2-encoder.ts:158` 直接 import 该常量（L230 主线程守卫 + L231 worker 内守卫同源），无手抄副本。 |
| `MAX_CONCURRENT` / `KTX2_WORKER_COUNT` 单一事实源 | `mmd-ktx2-encoder.ts:24,163` | ✅ **已收口**。L162-163 注释明确「原手写 3 靠注释『对齐』，易漂移」→ 现为 `const KTX2_WORKER_COUNT = MAX_CONCURRENT;`。这是同类问题**已被修好**的样本，与本报告 F4 形成对照。 |
| `texture-order.ts` 与 Go `texture_order.go` 的口径对称 | `texture-order.ts:21-53` vs `internal/app/texture_order.go:29-44` | ✅ **对称**。两侧都是「声明序非空才走声明分支，default_texture 置首」；Go L36-42 与 TS L23-51 的判定条件一致。**但**：这是**手抄的双实现**，无自动一致性守卫（无契约测试比对两侧）；`texture-order.ts:2` 注释「改口径务必同步两侧」是人工纪律而非门禁。归为**已知的、有注释论证的**架构取舍，不计为缺陷，但值得记录为「漂移风险点」。 |
| `Ktx2TextureLoader` 的 blob revoke | `mmd-ktx2-texture-loader.ts:121-130` | ✅ **正确**。`try/finally` 保证 `revokeObjectURL` 在成功、KTX2 解码失败、以及 `onLoad` 回调抛错三条路径都执行。`fallback()` 不涉及 blob。**唯一缺口**：`getCachedTextureByHash` 的 `.catch(() => fallback())`（L132）在 blob 创建**之前**，故无泄漏。测试 `mmd-ktx2-texture-loader.test.ts:44-105` 覆盖命中/未命中/解码失败三路。 |
| `Ktx2TextureLoader` 的占位纹理对象身份 | `mmd-ktx2-texture-loader.ts:98,134` | ✅ 直载与回退都合并进同一 `placeholder`，`onLoad` 与返回值同对象（L134 return placeholder）。测试 L74-105、L120-130 钉死。 |
| `swallowError` 的使用 | `wasm-decode.ts:362,723` | ✅ **不是缺陷**。`CacheModelAvatars` 是旁路副作用（Go 侧头像缓存），失败不影响解码结果；`swallowError` 是本仓刻意的 fail-open 模式。测试 mock 注释（`wasm-decode.test.ts:25-27`）也确认了该语义。 |
| `devLog` 吞掉的错误 | 全文件多处 | ✅ **不丢失关键信息**。所有 `devLog` 都在**已有确定降级行为**的分支（策略未命中、纹理读失败、解析空几何），且 `devLog` 在 DEV 下进环形日志面板。唯一需要留意的是生产构建下 `devLog` 是空函数（`utils.ts:12`）→ 生产环境这些诊断信息**完全不可见**；但这是全仓统一的日志策略，非本模块缺陷。 |
| `findTextHeaderEnd` 的短路顺序 | `utils.ts:57-70` | ✅ 注释「短路顺序即契约，勿对调」（L62）与代码一致（L63 先判 eq）。`utils.test.ts` 覆盖 V2/V3/BOM/无 hash/过短多路。 |
| `buildStdYsgpFromTextVariant` 的 guard 放宽 | `utils.ts:94` | ✅ 注释（L91-93）解释了从 `length - 20` 改 `length - 16` 的理由，代码一致，测试有对应用例。 |
| `wasm-decode.ts:462-467` 的 `.buffer` 隐性契约 | `wasm-decode.ts:462-467` | ✅ **已用长注释钉死**：明确写出「只在 `FS.readFile` 返回恰好占满底层 ArrayBuffer 时正确」，并给出改 `collectOutputFiles` 时必须同步处理的位置。这是良好的防御性注释，非缺陷。 |
| `ysm-meta-parser` 的失败返回 | `ysm-meta-parser.ts:76-79` | ✅ **正确**。JSON 解析失败时返回 `hasYsmMeta: true`（文件存在）而非 false —— 语义准确，且 `devLog` 记录原因。测试 `ysm-meta-parser.test.ts` 覆盖空/正常两路。 |
| `geometry.ts` / `parse-ysm-json.ts` 的再导出 | `geometry.ts`(9 行)、`parse-ysm-json.ts`(4 行) | ✅ 纯转发，无逻辑。注：`parse-ysm-json.ts` 虽是 4 行转发件，但有独立测试（`parse-ysm-json.test.ts`，7.4KB）——按反桶契约它来源数为 1，不构成聚合桶嫌疑。 |
| `FACE_KEYS` 的顺序 | `wasm-geometry.ts:65` | ✅ 与 Bedrock 规范面序一致，且在 `faceUvEnd` 中只做「取 max」的对称聚合，顺序不影响结果。 |

---

## 建议修复优先级

1. **F1（🔴）** — 唯一会造成「永久挂起 + 幂等集合毒化」的缺陷，且与作者已修的同类缺陷同源，属明确的漏网。修法小（`acquire` 在 `cancelled` 时 reject）。
2. **F2（🔴）** — 不可回收的 blob 泄漏，在主路径上。修法小（把作者头像 URL 也登记进一个可回收集合，或在 `tryJsonDispatch` 的异常路径补 revoke）。
3. **F4（🟡）** — 文档与代码反向分叉，修法零成本（改注释），但不修会持续误导生命周期接线决策。
4. **F3 / F5（🟡）** — 结构性隐患，建议在下次触及对应函数时一并收敛（F5 可对齐 `collectJsonSpecTextures` 的「覆盖者也登记」做法）。
5. **F7 / F8（🟢）** — 补测试，按「值得钉的契约」清单逐条落。
