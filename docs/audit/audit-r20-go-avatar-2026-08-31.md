# R20 审核 — go/avatar 头像提取与缓存 + App 对接

**审核日期**：2026-08-31
**审核者**：主模型（用户指定串行模式）
**范围**：`go/avatar/`（910 行源码 + 1695 行测试）+ `internal/app/app_avatar.go`（137 行）+ `internal/app/app.go:124`（log 重定向到 runtimeLogs）+ `internal/app/wasm_decoder.go:18,26,162`（`SetNodeJS` 注入点与超时护栏引用）
**方向岔开依据**：最近 50 条提交全部集中在 `frontend/src`(163) / `go/fsutil`(7) / `go/sync`(6) / `go/importer`(3) / `go/fileops`(2) / `internal/app`(9)；**`go/avatar` 零提交、零 staged**，routes 表「头像/作者/创作者/缓存/缩略图」高价值热点
**门禁状态**：`go build ./go/...` ✅；`go test -race -timeout 90s ./go/avatar/...` → `ok 11.735s` ✅

---

## 总体结论

**有条件通过**——本模块是项目里**测试密度最高的 Go 包之一**（910 行源码 + 1695 行测试 ≈ 1:1.86，覆盖路径守卫 15 例 + Node 子进程管线 13 例 + zip 8 例 + json 8 例 + .7z 3 例 + mime 嗅探 2 例 + 并发缓存 1 例 + 缓存 no-op 4 例）。**2 项真实缺陷**（1 项 P2 缓存命中路径 MIME 不一致，1 项 P3 并发启动场景）+ **3 项轻微反模式**。本模块不需要结构性重写，建议 P2 修复后再发版。

---

## 亮点（15+ 项，不一一列举）

| # | 模式 | 位置 |
|---|------|------|
| 1 | **路径守卫分四层**：强校验（isSafeAvatarPath 拒 `..`）+ 候选路径（avatarCandidates 补裸名/扩展名）+ 调用前 Rel 复查（`avatar_extract.go:200, 284`）+ 缓存写前 SafeName（含 Windows 保留设备名 `CON/PRN/AUX/NUL/COM1-9/LPT1-9` 与尾点空格 `SafeName:46-67`） | 全包 |
| 2 | **空 CacheDir 全链路 no-op**：SaveAvatarData 返回 data URI 即时显示 + 不写 CWD（ADR-046 P2） | `avatar.go:140-142, 165-181` + `TestAvatarCacheDirEmpty_NoOp` |
| 3 | **`WriteFileAtomic` 原子替换**（替代原 `os.WriteFile` 竞态截断） | `avatar.go:174-180` + `TestSaveAvatarData_Concurrent`（16 goroutines，-race 验证） |
| 4 | **JPEG 文件头嗅探**（FFD8FF → image/jpeg）——修了原硬编码 `image/png` 与 JPEG 不匹配 | `avatar.go:154-161` + `TestReadCachedAvatar_MimeSniff` |
| 5 | **Zip-bomb 防线**：条目解压后 `LimitReader+1` 截断探测 + 超限跳过（ADR-033 防止恰上限静默截断） | `avatar_zip.go:38-47, 70-80` + `TestReadFileFromZip_Oversize` |
| 6 | **CRC 损坏 / 不支持算法条目**：`f.Open` 失败记录日志返回 nil 不 panic | `avatar_zip.go:30-34` + `TestReadFileFromZip_ChecksumCorrupt` + `TestReadFileFromZip_EntryOpenFail` |
| 7 | **matchAvatarZipEntry 三段语义**：精确相等 / 目录级前缀 / 裸名任意目录子后缀——P3-3 收紧点（防 `sub/avatar/alice.png` 误命中 `avatar/alice.png`） | `avatar_zip.go:92-104` + `TestReadFileFromZip_ExactPathOnly` |
| 8 | **统一容器桥（ADR-068）**：zip 专用路径收敛进 `container.Reader`，7z 同走容器 | `avatar_extract.go:148-162, 416-478` + `TestExtractAvatarURI_From7zFallback` |
| 9 | **后缀精确名**（`notysm.json` 不得误作 ysm.json）——通过 `types.IsYsmEntryJSON` 单一事实源（ADR-038 D2） | `avatar_zip.go:111-114` + `TestExtractAvatarURI_FromYSM_NotYSMJSON` |
| 10 | **Node 子进程多防线**：`exec.CommandContext` 60s 超时 + 8MB stderr 截断 + `limitedBuffer` 200MB stdout 流式上限 + `HideWindow` Windows 隐藏控制台 | `avatar_decode.go:122-152` + `TestDecodeYSMFiles_StderrTooLarge`（修复 `buf.String()[:512]` 越界 panic） |
| 11 | **SetNodeJS 未注入 / 空注入 nil 化**：无 panic，调用方按 nil 处理 | `avatar_decode.go:67-74` + `TestDecodeYSMFiles_SetupGuards` 5 例 |
| 12 | **裸文件名声明兼容**：原 `.ysm`/`.zip` 分支 `avatarCandidates` 补 avatar/ 前缀与扩展名变体；`.json` 分支对齐 | `avatar.go:110-135` + `avatar_extract.go:197-211, 281-293` + `TestExtractAvatarURI_FromJSON_BareName` |
| 13 | **`isPathInRootOrSelf` 路径守卫**：Wails binding `CacheModelAvatars` 前置校验（防前端传任意路径） | `app_avatar.go:131-136` |
| 14 | **`isTypeModelFile("ysm")` 走注册表**（ADR-064）——而非硬编码 `.ysm`/`.zip`/`.7z`/`.json`，新增 YSM 承载格式自动跟进 | `app_avatar.go:49, 99` |
| 15 | **测试端到端覆盖**：假 YSMParser 胶水 `fakeGlueModule` 让 Node 管线单测无需真 WASM；`requireNode` 跳过无 node 的 CI | `avatar_node_test.go:53-101` |
| 16 | **MkdirAll 错误显式化**：原 `SaveAvatarData` 与 `CacheAvatarsFromJSON` 都静默吞 MkdirAll 失败——修复后 log 上抛、调用方按读取失败处理 | `avatar_extract.go:261-264, 311-315` |

---

## 风险清单

### 🟠 P2（高优先，建议本轮修）

#### P2-1 `BatchExtractCreatorAvatars` 缓存命中路径**硬编码 `data:image/png`**，绕开 `ReadCachedAvatar` 的 JPEG 嗅探——同一缓存文件两条 binding 返回不同 MIME
**位置**：`internal/app/app_avatar.go:60-66`
**观察**：

```go
if _, err := os.Stat(cachedPath); err == nil {
    data, _ := os.ReadFile(cachedPath)
    if data != nil {
        result[author] = "data:image/png;base64," + base64.StdEncoding.EncodeToString(data)
    }
    continue
}
```

**两条 binding 路径不一致**：
- `CachedCreatorAvatar(authorName) (string, error)` → `avatar.ReadCachedAvatar` → 嗅探 `FFD8FF` → 正确 `image/jpeg`（`avatar.go:154-161`）
- `BatchExtractCreatorAvatars()` 缓存命中分支 → 直接 `os.ReadFile` + **硬编码** `data:image/png`

**实测影响**：
- 创作者 JPEG 头像已落盘 → `CachedCreatorAvatar` 返回 `image/jpeg`（正确）
- 同文件经 `BatchExtractCreatorAvatars` 返回 `image/png`（**错误**）
- 前端 `<img src=...>` 仍可显示（浏览器嗅探更宽容），但**导出 data URI 给外部工具 / 复制到剪贴板 / 第三方 API 上传时 type 不匹配**
- 与 `avatar.ReadCachedAvatar` 的「P3 修复：按文件头嗅探 mime」意图直接冲突（`avatar.go:154-156` 注释明示）

**为什么没被发现**：测试只覆盖了 `CachedCreatorAvatar` 的 mime 嗅探（`TestReadCachedAvatar_MimeSniff`），**未覆盖 `BatchExtractCreatorAvatars` 的缓存命中分支**。

**严重性**：P2（用户可见的契约不一致，修复代价低）。

**修复建议**（最小变更，删 6 行调一行）：

```diff
--- a/internal/app/app_avatar.go
+++ b/internal/app/app_avatar.go
@@ -57,11 +57,7 @@ func (a *App) BatchExtractCreatorAvatars() (map[string]string, error) {
 	for author, modelPath := range seen {
 		safe := avatar.SafeName(author)
-		cachedPath := filepath.Join(cacheDir, safe+".png")
-		if _, err := os.Stat(cachedPath); err == nil {
-			data, _ := os.ReadFile(cachedPath)
-			if data != nil {
-				result[author] = "data:image/png;base64," + base64.StdEncoding.EncodeToString(data)
-			}
-			continue
+		// 走 ReadCachedAvatar：含 JPEG 嗅探，与 CachedCreatorAvatar 口径一致
+		// （avatar.go:154-161 FFD8FF → image/jpeg 修复）；原直接 ReadFile +
+		// 硬编码 image/png 路径在 JPEG 头像缓存命中时返回错误 MIME。
+		if dataURI, _ := avatar.ReadCachedAvatar(author); dataURI != "" {
+			result[author] = dataURI
 		}
 		dataURI := avatar.ExtractAvatarURI(modelPath, safe)
```

**配套测试**：在 `internal/app/app_avatar_test.go`（如不存在则新建）新增：

```go
// TestBatchExtractCreatorAvatars_CachedMime JPEG 头像缓存命中时，
// BatchExtractCreatorAvatars 必须返回 image/jpeg 而非硬编码 image/png
// （与 CachedCreatorAvatar 口径一致，P2-1 修复）
func TestBatchExtractCreatorAvatars_CachedMime(t *testing.T) {
    oldDir := avatar.CacheDir
    cacheDir := t.TempDir()
    avatar.CacheDir = func() string { cacheDir }
    t.Cleanup(func() { avatar.CacheDir = oldDir })

    // 写 JPEG 魔数头像到缓存（safe name 为 "testuser"）
    jpegBytes := []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10}
    avatar.SaveAvatarData("testuser", jpegBytes, "image/jpeg")

    app := &App{} // isPathInRootOrSelf / ScanModelEntries 走 mock
    // ... mock ScanModelEntries 返回含 "[testuser]model.ysm" 的条目
    result, err := app.BatchExtractCreatorAvatars()
    if err != nil { t.Fatal(err) }
    if got := result["testuser"]; !strings.HasPrefix(got, "data:image/jpeg;base64,") {
        t.Fatalf("JPEG 头像应嗅探为 image/jpeg, 得到 %q", got[:min(50, len(got))])
    }
}
```

**验收**：`go test -race ./internal/app/...` ✅

---

### 🟡 P3（中优先，建议下次审核轮一并修）

#### P3-1 `SetNodeJS` 全局可变状态**非并发安全**
**位置**：`avatar_decode.go:33-43`
**观察**：

```go
var nodeJSPath string
var getGlueCode func() string
var getWasmBinary func() []byte

func SetNodeJS(nodePath string, glueFn func() string, wasmFn func() []byte) {
    nodeJSPath = nodePath
    getGlueCode = glueFn
    getWasmBinary = wasmFn
}
```

**触发场景**：
- `app.go:ServiceStartup` 调一次 `SetNodeJS` 注入 `wasm_decoder.go` 持有的注入器
- `app_modules.boot.test.ts` 等前端测试在 `mockApp` 路径上直接调 `DecodeYSMFiles`——`wasm_decoder.go` 又是另一份注入
- **多 goroutine 同时调 `DecodeYSMFiles`** 时，若有谁在运行中 `SetNodeJS` 重置——三变量赋值非原子，可见竞态

**严重性**：
- 生产路径上 `SetNodeJS` 仅启动期调一次，之后 0 改动——`go test -race` 未复现（`avatar_node_test.go` 用 `t.Cleanup` 串行还原）
- 但**没有「重置场景必须用 Mutex + 手动状态」的硬约束**——根 AGENTS §Go 专属坑点明示「`sync.Once` 只执行一次；**重置场景不能用**，改 `sync.Mutex` + 手动状态」

**修复建议**（推荐 mutex 包裹，避免引入 sync.Once 死结）：

```diff
--- a/go/avatar/avatar_decode.go
+++ b/go/avatar/avatar_decode.go
@@ -30,14 +30,24 @@ const decodeMaxOutput = 200 << 20

-// DecodeYSMFiles 通过 Node.js + WASM 解码 YSM 文件。
-// nodeJSPath 是 Node.js 可执行文件路径（可全局设置）。
-var nodeJSPath string
-
-var getGlueCode func() string
-var getWasmBinary func() []byte
+// nodeEnv 持有 SetNodeJS 注入的解码环境（原子读写：启动期一次注入，运行时只读）
+type nodeEnv struct {
+    mu       sync.Mutex
+    nodePath string
+    glue     func() string
+    wasm     func() []byte
+}

-// SetNodeJS 设置 Node.js 路径和 WASM/胶水代码加载函数。
-func SetNodeJS(nodePath string, glueFn func() string, wasmFn func() []byte) {
-	nodeJSPath = nodePath
-	getGlueCode = glueFn
-	getWasmBinary = wasmFn
+var env nodeEnv
+
+// SetNodeJS 设置 Node.js 路径和 WASM/胶水代码加载函数（线程安全）。
+func SetNodeJS(nodePath string, glueFn func() string, wasmFn func() []byte) {
+    env.mu.Lock()
+    env.nodePath, env.glue, env.wasm = nodePath, glueFn, wasmFn
+    env.mu.Unlock()
+}
+
+// getEnv 读取当前注入的环境（线程安全快照）。
+func getEnv() (string, func() string, func() []byte) {
+    env.mu.Lock()
+    defer env.mu.Unlock()
+    return env.nodePath, env.glue, env.wasm
 }
```

并在 `DecodeYSMFiles:67` 改用：

```diff
-    if nodeJSPath == "" || getGlueCode == nil || getWasmBinary == nil {
+    nodePath, glueFn, wasmFn := getEnv()
+    if nodePath == "" || glueFn == nil || wasmFn == nil {
         return nil
     }
-    glueRaw := getGlueCode()
-    wasmBin := getWasmBinary()
+    glueRaw := glueFn()
+    wasmBin := wasmFn()
```

测试侧 `avatar_node_test.go:28-48` 的 `withFakeNode` 改为 `t.Cleanup(func() { env = oldEnv })`——同样线程安全。

**严重性**：低（生产路径不触发），但属于根 AGENTS「重置场景必须用 Mutex」的明确条款。

#### P3-2 `BatchExtractCreatorAvatars` 错误吞咽（无显式无操作）
**位置**：`app_avatar.go:30, 87, 115`
**观察**：三处 `os.MkdirAll(cacheDir, fsutil.DirPerms)` 返回的 `err` 全部丢弃。

**严重性**：低——`SaveAvatarData` 内部也会 MkdirAll 并 log，所以最终行为一致。但语义上 `BatchExtractCreatorAvatars` 应至少记录一次失败。

**修复建议**：合并到 `SaveAvatarData` 之前显式 mkdir + err log：

```diff
-    if cacheDir != "" {
-        os.MkdirAll(cacheDir, fsutil.DirPerms)
-    }
+    if cacheDir != "" {
+        if err := os.MkdirAll(cacheDir, fsutil.DirPerms); err != nil {
+            log.Printf("[avatar] 创建缓存目录失败 %s: %v", cacheDir, err)
+        }
+    }
```

#### P3-3 `BatchExtractCreatorAvatars` 同作者多个模型只看第一个 `[Author]xxx.ysm`
**位置**：`app_avatar.go:46-52`
**观察**：

```go
if _, ok := seen[author]; !ok {
    if types.IsTypeModelFile(e.Name, "ysm") {
        seen[author] = e.Path
    }
}
```

**触发场景**：同一作者多个模型 `[Author]modelA.ysm`、`[Author]modelB.ysm`——只看第一个。第二个模型可能含更新的头像，但被忽略。

**严重性**：低——`seen[author]` 去重逻辑存在理由（避免重复缓存同作者），但第一个未必最新。`CacheAvatarsFromModel` 已缓存的不会再覆盖（`avatar_extract.go:319-321` 已缓存跳过），所以首次进入时谁先被看到即定型。

**修复建议**：可选改进——按修改时间 mtime 取最新，或**接受当前实现**（明确注释意图）。

---

### 🟢 P4（低优先，不阻塞）

#### P4-1 `SaveAvatarData` 接收 `mime` 参数但**不验证**——调用方可传任意字符串
**位置**：`avatar.go:165`
**观察**：`SaveAvatarData(safeName, data, mime)` 不做 mime 白名单校验。`ExtractAvatarURI` 内部按扩展名推 mime，传值合理；但理论上调用方可传 `mime="image/svg+xml"` 而实际是 PNG 字节——`ReadCachedAvatar` 嗅探兜底（只认 JPEG 头），其他全部当 PNG。

**严重性**：极低。所有当前调用点都传 PNG/JPEG，且走 `ReadCachedAvatar` 嗅探。**不需要改**。

#### P4-2 `extractAvatarFromYSM` 调用 `DecodeYSMFiles` 时未传递超时
**位置**：`avatar_extract.go:37`
**观察**：`DecodeYSMFiles` 内部 `context.WithTimeout(context.Background(), decodeTimeout)` 60s——已有防线。**OK**，记录为审计判断。

#### P4-3 `modelAuthorNames` 的 `.7z` 分支未实现
**位置**：`avatar_extract.go:329-397`
**观察**：switch 仅 `.json` / `.zip` / `.ysm` 三分支，`.7z` 落到 `raw == nil → return nil`——但 `CacheAvatarsFromModel:301-305` 的 switch **也不包含 `.7z`**，所以无功能影响。

**严重性**：低。**知识卡 `go-avatar.md` 注明 P3 观察**：「降级取 avatar/ 第一张图已由 .ysm/.zip/.7z 三态实现」——但仅 `ExtractAvatarURI` 路径，**批量 `CacheAvatarsFromModel` 路径未对齐**。

**修复建议**（一致性补齐）：

```diff
--- a/go/avatar/avatar_extract.go
+++ b/go/avatar/avatar_extract.go
@@ -301,7 +301,7 @@ func CacheAvatarsFromModel(modelPath string) {
 	ext := strings.ToLower(filepath.Ext(modelPath))
 	switch ext {
 	case ".json":
 		CacheAvatarsFromJSON(modelPath)
-	case ".ysm", ".zip":
+	case ".ysm", ".zip", ".7z":
 		names := modelAuthorNames(modelPath)
 		...
 	}
```

**严重性**：低——`.7z` 批量缓存用户场景罕见。

---

## 反模式 / 致命陷阱 排查清单

按 audit-framework.md §一 §二 全量比对：

| 编号 | 检查项 | 结果 |
|------|--------|------|
| 反模式-1 | 隐式状态写入 | ⚠️ `SetNodeJS` 三全局变量非并发安全 → P3-1 |
| 反模式-2 | 职责过载 | ✅ avatar.go 拆 5 文件（ADR-040 ≤400 行） |
| 反模式-3 | 魔法数值 | ✅ 常量化（`debounceDelay`/`stopWaitTimeout`/`decodeTimeout`/`decodeMaxOutput`/`maxAvatarBytes`） |
| 反模式-4 | 显著重复 | ✅ `isSafeAvatarPath`/`avatarCandidates`/`ReadFileFromContainer`/`SaveAvatarData`/`readLimitedAvatar` 全部单源 |
| 反模式-9 | 防抖只合并调度 | N/A |
| 反模式-10 | 已关闭 channel 复用 | ✅ zip/容器读全用 `defer Close` 或 `Close()` 显式 |
| 反模式-13 | `sync.Once` 重置 | ✅ `containerCacheOnce` / `tagsStoreOnce` 无重置场景 |
| 反模式-14 | goroutine 泄漏 | N/A（本包无裸 `go func()`） |
| 反模式-15 | defer 在循环内 | ✅ `for _, e := range r.Entries()`（line 451）内**无** defer；rc.Close() 显式调用 |
| 反模式-17 | io.Reader 未 Close | ✅ zip/容器条目全 Close（`avatar_zip.go:35, 67, 467`） |

致命陷阱 §二：

| # | 检查项 | 结果 |
|---|--------|------|
| 5 | Go Binding 函数名 | ✅ App 侧 4 个方法 grep 验证一致 |
| 17 | 零值哨兵 | ✅ `cacheDir == ""` 是显式空串非零值判断 |

治理红线 §三：

| # | 检查项 | 结果 |
|---|--------|------|
| 3.4 ① 异步范式 | N/A（无 await） |
| 3.4 ② 数值守卫范式 | N/A |
| 3.4 ③ 边界对称范式 | ✅ `isSafeAvatarPath` 拒绝 `..` 与 `.` 段双侧 + Rel 复查 |

---

## ADR 关联

| ADR | 关联点 | 状态 |
|-----|--------|------|
| ADR-033 限流器截断静默 | ✅ `LimitReader+1` + 截断探测 | 已采纳 |
| ADR-038 D2 zip 路径匹配 | ✅ `matchAvatarZipEntry` 三段语义 + `types.IsYsmEntryJSON` 单一事实源 | 已采纳 |
| ADR-040 文件行数治理 | ✅ avatar.go 767 → 5 文件 ≤500 行 | 已采纳 |
| ADR-046 P2 平台配置根 | ✅ `CacheDir` fail-fast，不降级 CWD/exe 旁 | 已采纳 |
| ADR-064 注册表优先 | ✅ `types.IsTypeModelFile("ysm")` 替代硬编码 | 已采纳 |
| ADR-068 容器桥 | ✅ zip/7z 统一走 `container.Reader` | 已采纳 |

无新 ADR 建议。

---

## 修复清单（精确 diff）

### 🟠 P2 必修

**R20-FIX-1**：`internal/app/app_avatar.go` `BatchExtractCreatorAvatars` 缓存命中改走 `ReadCachedAvatar`
- 文件：`internal/app/app_avatar.go:60-66`
- 改动：`-6 +5` 行（见 P2-1 修复建议）
- 配套测试：`internal/app/app_avatar_test.go` 新增 `TestBatchExtractCreatorAvatars_CachedMime`
- 验收：`go test -race ./internal/app/...` ✅；`grep BatchExtractCreatorAvatars` 无硬编码 `image/png` 残留

### 🟡 P3 建议

**R20-FIX-2**：`go/avatar/avatar_decode.go` `SetNodeJS` 全局变量改 `nodeEnv` 结构 + mutex
- 文件：`go/avatar/avatar_decode.go:33-43, 67-71`
- 改动：`+15 -5` 行（mutex 包裹 + `getEnv()` 快照读）
- 配套测试：`avatar_node_test.go` `withFakeNode` 改为 `t.Cleanup(env restore)`
- 验收：`go test -race ./go/avatar/...` ✅；`-race` 报警零

**R20-FIX-3**：`internal/app/app_avatar.go` 三处 `MkdirAll` 错误补 log
- 文件：`internal/app/app_avatar.go:30, 115`
- 改动：`±6` 行（增 import `log`）
- 验收：build ✅；现有测试不破

**R20-FIX-4**：`go/avatar/avatar_extract.go` `CacheAvatarsFromModel` 补 `.7z` 分支
- 文件：`go/avatar/avatar_extract.go:301-305` + `modelAuthorNames` `.7z` 分支
- 改动：`+10` 行
- 验收：`TestExtractAvatarURI_From7zFallback` 已通过；新增 `TestCacheAvatarsFromModel_7z` 覆盖批量路径
- 知识卡同步：`go-avatar.md` 不变量段「P3 观察」改为「已对齐」

### 🟢 P4 不修

P4-1/2 仅为审计记录，不需要改。P4-3 包含在 P3-4 内。

---

## 审核元数据

- 审核耗时：单轮串行审，约 35 分钟（材料密度高：910 源码 + 1695 测试 = 2605 行）
- 阅读文件：
  - `go/avatar/avatar.go`（198 行）
  - `go/avatar/avatar_extract.go`（479 行）
  - `go/avatar/avatar_decode.go`（179 行）
  - `go/avatar/avatar_zip.go`（114 行）
  - `go/avatar/avatar_test.go`（326 行）
  - `go/avatar/avatar_extra_test.go`（795 行）
  - `go/avatar/avatar_extract_test.go`（157 行）
  - `go/avatar/avatar_guard_test.go`（65 行）
  - `go/avatar/avatar_node_test.go`（448 行）
  - `go/avatar/avatar_7z_test.go`（101 行）
  - `internal/app/app_avatar.go`（137 行）
  - `internal/app/app.go:14, 121-216`（watcher 注入 + 启动）
  - `internal/app/app_scan.go:278-300`（scanModelEntries 注释）
  - `frontend/src/views/app-content/workshop-avatar.ts`（调用方追溯）
- 工具：`git log -50`、`grep` 范围限位 + 关系面、`go build`、`go test -race`、`docs/knowledge/routes.md`
- 未触达：`scripts/check-knowledge-drift.mjs --affected`（本轮无文件改动）

---

## 与 R19 审核的对照

| 维度 | R19 (go/watcher) | R20 (go/avatar) |
|---|---|---|
| 源码体量 | 297 行 | 910 行 |
| 测试体量 | 669 行（1:2.25） | 1695 行（1:1.86） |
| 测试设计深度 | TestStartStopRestart / DebounceAfterStop / StopClearsDebounceTimer / LoopNoiseEventFiltered | 假胶水端到端 Node 管线 / 多入口并发 / Zip-bomb / CRC 损坏 / Oversize / 路径逃逸 |
| 致命陷阱复现 | goroutine + 已关闭 channel 复用 → 全堵 | zip-bomb + 子进程超时 + mime 不一致 → 大部分堵 |
| **真实 P2 缺陷** | syncPending 未清零（panic 风暴） | **BatchExtractCreatorAvatars 缓存命中硬编码 png** |
| **真实 P3 缺陷** | Stop 三段锁 / println 不走 runtimeLogs | SetNodeJS 非并发安全 / MkdirAll 错误吞咽 / .7z 批量缓存缺位 |
| 推荐范围 | `go/avatar` 同等级高价值 | **下一次：`go/dedup` + `strategy.go`（304+82 行零提交）** |

---

**下次审核建议**：**`go/dedup` + `strategy.go`**（386 行 + 测试）；**`internal/app/app_workshop.go`**（352 行，创意工坊 UI 编排，零提交）。两者均与最近 50 条方向完全无交点。