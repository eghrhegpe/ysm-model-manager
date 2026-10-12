# ADR-331-d1：ReadFileBytes 无 error 通道缺口：ReadFileMeta 结构化错误字段（切片 C）

- **状态**：📝 提议中（Proposed）
- **日期**：2026-10-12
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **关联主 ADR**：ADR-331

---

## 背景（一句）

ADR-331 §3「范围外」点名的 `ReadFileBytes`/`ReadFileBytesBatch`/`ReadFileBytesBatchWithMeta` 四个绑定无 error 通道：守卫失败（`isPathInRootOrSelf` false）或 `ReadFileLimited` 失败（读超限/IO 错）时，`ReadFileBytesBatchWithMeta` 直接 `continue` 跳过条目，`readFileWithHashUnchecked` 把 `fsutil.ReadFileLimited` 的错误信息**丢弃**（`return nil, ""`），前端 `mmd-data-port` 只看到"条目缺失"，`read-model-bytes` 只看到 `null`，**无法区分「路径非法」「文件不存在」「超限」「IO 错」，也无法 i18n**。

## 决策（三行）

1. **不新增 `ReadFileBytesEx` 增量绑定**——给现有 `ReadFileMeta` 加 `ErrorCode string`（Go `types.ErrorCode` 常量名）+ `Reason string`（中文描述）两个字段；守卫失败填 `ERR_INVALID_PATH`、`ReadFileLimited` 失败填 `ERR_IO`/`ERR_FILE_TOO_LARGE`（按 `fsutil` 错误类型映射），`Data=nil, Hash=""` 但**条目保留**（不 `continue`）。
2. **单文件场景复用 `ReadFileBytesBatchWithMeta([path])`**——`read-model-bytes.ts` 桌面/Android 路径改走该绑定读 `Meta.ErrorCode`，前端据此构造 `AppError` 走 `friendlyError`（ADR-331 §2.1 已收窄旁路）。`ReadFileBytes`/`ReadFileBytesBatch` 保留原契约（纯 bytes，零 error 通道），**供不需要 error 的消费点继续使用**。
3. **web 模式同步**：`web-fs.ts` browserAdapter 的 `ReadFileBytesBatchWithMeta` 返回对象同步加 `errorCode`/`reason` 字段（web 侧从 `readWebFile` 失败类型映射），保持 Go/前端跨平台语义一致。

## 后果（一句）

改动面 = Go（`ReadFileMeta` +2 字段 + `readFileWithHashUnchecked` 返回 error + 两分支填 Meta）+ `npm run generate:bindings` 刷新前端类型 + `web-fs.ts` 同步 + `mmd-data-port`/`read-model-bytes` 读 `ErrorCode` 构造 AppError + 相关测试更新；不回退方案：若确认不需要单文件 error，回滚 `read-model-bytes` 单文件路径到 `ReadFileBytes`，`ReadFileMeta.ErrorCode` 字段留作增量保留（不删字段、只停用消费）。