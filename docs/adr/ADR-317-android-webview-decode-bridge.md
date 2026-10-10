# ADR-317：Android .ysm 解码 WebView 桥后端（Decoder 策略平台化）

- **状态**：✅ 已采纳（2026-09-27 P1 桥骨架落地，桌面 E2E 全链路验证通过；P2 on-device 终测待办）
- **日期**：2026-09-27
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-316（wazero 退役 Node 桥）、docs/knowledge/ysm-wasi.md（三路基准实证）、internal/app/wasm_decoder.go（ysm.SetDecoder 注入点）、frontend/src/wasm/parser-shared.ts（前端解码管线）`

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

ADR-316 将 `.ysm` 解码切到 wazero 内存直解，Android 首次获得加密模型解码能力（此前 Node 子进程桥在 Android 无法运行）。但 wazero 在 Android **长期只支持 interpreter 模式**（无 optimizing compiler，上游架构决定），同一 V3 样本（1.7MB，i7-13700HX 实测）：

| 路径 | 耗时 | 说明 |
|------|------|------|
| wazero compiler（桌面） | 0.76s | 桌面现状 |
| wazero interpreter（Android 现状） | **32.8s** | 手机 silicon 只会更慢，撞 60s 超时护栏 |
| **WebView V8 JIT**（frontend 同源 wasm 资产） | **1.1s** | Node V8 实测（与 WebView V8 同引擎），产物逐字节同量 |

即「Android 无编译器」是 wazero 单一运行时的局限，而非 wasm 解码本身的宿命——Android WebView 内置的 V8（Liftoff/TurboFan）解码同一模型是秒级。ADR-316 遗留的产品决策（回退 metadata-only / 接受慢速 / 等 runtime 成熟）因此浮出第④项：**委托 WebView 解码**。此项是当时唯一阻塞 Android 发版的技术项。

## 2. 决策（Decision）

**平台化 `ysm.SetDecoder` 策略：桌面保持 wazero compiler，Android 默认装配 WebView 桥后端，wazero interpreter 保留为兜底。**

关键设计：

1. **缝隙已存在**：`internal/app/wasm_decoder.go` 的 `ysm.SetDecoder()` 注入点是全部消费端（fileops 封面提取、单/多组件解码）的唯一入口。Android 侧以 build tag `android` 装配桥后端即可，消费端零改动，桌面路径零改动。
2. **通道全用既有机制**：Go→前端 `app.Event.Emit`（`app.go:124` 既有封装）携带解码请求（base64 输入）；前端复用 `frontend/src/wasm/parser-shared.ts` 现成管线（lazy module + collectOutputFiles）执行解码；前端→Go 走新增绑定回调（id + 产物 JSON），Go 侧 request map + channel + 超时收结果。
3. **护栏对齐旧口径且全在 Go 层**：200MB 输入 / 200MB 输出 / 60s 超时，前端不做任何判定（红线论证：解码是数据加工而非类型归属语义，且复用前端已有预览管线——「前端只读不判」禁的是归属判定，不越线）。
4. **大 payload 通道容量有生产先例背书**：前端→Go `ImportModelFile`（整模型压缩包 base64，数十 MB 级，生产在用）；Go→前端 `ReadFileBytes`/`ReadFileBytesBatch`（纹理批量，MB 级）。唯一无先例的 Emit 方向大 payload 由 P0 spike 实测（结果记知识卡）。

### 与 ADR-316 的关系

ADR-316 退役的是 **Node 子进程桥**（需分发 Node 运行时、进程管理复杂度）；本桥复用 **系统必带的 WebView**，零额外分发，且不复活进程生命周期管理（WebView 随 app 生命周期）。两者不矛盾，但需承认形式上「桥」回来了——这正是要在 ADR 层面记录权衡的原因。

## 3. 后果（Consequences）

**正面**：
- Android 加密模型解码达秒级（与桌面同量级），metadata-only 降级方案作废
- 消费端零改动；桌面路径零改动（build tag 隔离，回归面为零）
- 复用前端预览的同一份 wasm 资产与加载管线，无重复构建

**负面 / 已知遗留**：
- Android WebView 后台冻结：app 切后台时 JS 暂停，解码中请求会卡住——超时按前台时间计或后台取消重来
- WebView 首次编译 wasm 有冷启动开销（V8 code cache 二次进入秒级内），首次扫描偏慢
- 事件通道大 payload（base64 膨胀 4/3）若超预期需分块传输（备选已备：4MB 分片）
- wazero interpreter 路径保留为兜底，不删除（WebView 不可用场景）

## 4. 数据溯源

- 2026-09-27 三路基准实证 → `docs/knowledge/ysm-wasi.md`（Node V8 1.1s / wazero compiler 0.76s / interpreter 32.8s，产物逐字节同量）
- P0 spike（Emit 大 payload 往返 + WebView 冷启动）→ 结果记知识卡，数据不过关则本 ADR 回退提议中重议
- 真机终测（Android WebView 实测）→ P2，on-device 数据另行补录
