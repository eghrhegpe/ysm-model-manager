# ADR-164：Node+WASM 解码桥单实现收敛（avatar × wasm_decoder 双胞胎）

- **状态**：✅ 已采纳
- **日期**：2026-09-03
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：[go_design_critique](../knowledge/go_design_critique.md)（锐评共识榜 #4 跨域双胞胎复制）、[go-avatar-decode](../knowledge/go-avatar-decode.md)、[ADR-044](../adr/ADR-044/ADR-044.md?)（文件读写收敛、ReadLimitedEntry 统一口径）

---

## 1. 背景（Context）

2026-09-03 Go 三路锐评（`go_design_critique.md`）实证：同一份「Node.js 子进程 + YSMParser WASM 解码 .ysm」实现被**逐字复刻成两份**：

- `go/avatar/avatar_decode.go` 的 `DecodeYSMFiles`（avatar 头像/作者提取消费）
- `internal/app/wasm_decoder.go` 的 `runYSMNodeJSDecode`（YSM 预览/几何/纹理消费）

逐行对比确认重复面：`limitedBuffer`（流式输出护栏）×2、`";updateMemoryViews()"` glue 补丁 ×2、base64 三明治脚本模板（`wb64/yb64/FS.writeFile/callMain/cl()`）×2、`FILES_JSON:` 文本标记协议 ×2、`200MB/8MB` 输出上限 ×2、`[]int→toBytes` 字节转换 ×2。注释里互相指认「与对方同款，跨包无法共享故本地复制」。

**「无法共享」是伪理由**：`internal/app` 本就 `import go/avatar` 并调用 `avatar.SetNodeJS` 注入环境（wasm_decoder.go:40），两包同处一个 module，静态依赖完全允许。双份实现的真实代价：协议改动需两边同步（漂移即行为分叉）、200 行重复代码、锐评背书「同一协议只保留一份实现」红线。

三处行为差异（收敛前必须裁定）：

| 差异点 | avatar 版 | app 版 | 裁定 |
|--------|-----------|--------|------|
| 输出路径前缀 | 脚本 `p.substring(8)` 剥 `/output/` 前缀 | 脚本保留完整路径 | 统一剥前缀（avatar 语义）——app 消费方（`filepath.Base` / `strings.HasSuffix` / `HasPrefix(avatar)` / `path.Base`）经复查全部兼容，剥前缀更干净 |
| 返回类型 | `Path string; Data []int`（JSON 数组 + toBytes 兜底） | `Path string; Data []byte` 直接 | 共享实现返回 `[]byte`；`DecodeYSMFiles` 旧签名保留薄封装（内部 toBytes），不破坏 avatar_extract.go:37/384 两处消费 |
| 输入护栏 | 无（调用方 readLimitedModel 50MB 限读） | 200MB（`ysmDecodeMaxInput`） | 共享实现统一加 200MB 输入护栏（保守上限，两消费方现有输入都远低于此） |

## 2. 决策（Decision）

将 Node+WASM .ysm 解码桥**收敛为单实现**，落点 `go/avatar`（包内已有 `SetNodeJS` 环境注入 + 完整测试基建 `avatar_node_test.go`）：

1. `go/avatar` 内部新增统一实现 `decodeYSMViaNode(data []byte) []ysm.DecodedFile`（`Path string; Data []byte`），脚本统一剥 `/output/` 前缀，统一 200MB 输入护栏 + 60s 超时 + 200MB stdout / 8MB stderr 输出护栏（全部常量收敛）。
2. `DecodeYSMFiles`（对外签名 `[]struct{Path string; Data []int}`）降级为薄封装：调统一实现 + `toBytes` 转换，**签名不变**——avatar_extract.go 消费方零改动。
3. `internal/app/wasm_decoder.go` 的 `runYSMNodeJSDecode` 删除本地复刻（~180 行），改为调用 `go/avatar` 的统一实现 + 类型转换 `[]decodedYSMExtra`；`ysmDecodeMaxInput` 护栏语义由共享实现承接。
4. `ysm.SetDecoder` 注入链不变（internal/app 仍负责把 `runYSMNodeJSDecode` 包装进 `go/ysm` 注入点）。
5. 就地删除 avatar 版 `limitedBuffer`/`toBytes` 的重复定义，仅保留一份于统一实现。

**不纳入本次**：`FILES_JSON` 文本标记协议升级为纯 JSON 输出（涉及脚本模板与两端解析，收益低于风险）；`[]int` 老签名退役（等前端绑定面完全无引用后另行清理）。

## 3. 后果（Consequences）

**正面**：
- -200 行重复代码；协议改动一处生效（防漂移回归，锐评红线 #3 落地）
- `[]byte` 直通消除 `[]int→toBytes` 的认知怪味（锐评「字节身世曲折」缓解）
- 输入护栏统一到 200MB，avatar 路径获得与 app 同等的防膨胀保护

**负面 / 风险**：
- 行为收敛有裁定风险（前缀/护栏/返回类型三处），需 `go build ./go/...` + 两包测试（avatar_node_test.go / wasm_decoder_test.go…）验证通过才合入
- `DecodeYSMFiles` 的 `[]int` 签名是历史包袱（Wails 绑定面历史遗留），本次不拆，留作已知遗留

**已知遗留**：
- `FILES_JSON:` 文本标记协议未升级（收益低于风险）
- JSON 数组 `[]int` 字节传输未改（`ysm.DecodedFile.Data []byte` 仅统一实现内部使用，`DecodeYSMFiles` 老签名仍走 JSON 数组)

## 4. 数据溯源

- 锐评三路报告（IO/扫描 3.4、解析 3.2、应用 2.8）→ 主模型逐行对比 `avatar_decode.go` 与 `wasm_decoder.go` → 铁证「逐字复刻双胞胎」
- 消费方核查：`DecodeYSMFiles` 生产消费仅 `avatar_extract.go:37`（extractAvatarFromYSM）与 `:384`（modelAuthorNames），均为 `[]int` 消费 → 签名保留兼容
- `internal/app` 已 `import go/avatar`（wasm_decoder.go:18）→ 收敛方向可行
- 测试基建：`avatar_node_test.go`（fake node/glue 管线测试）为统一实现提供现成覆盖