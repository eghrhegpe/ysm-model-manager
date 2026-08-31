# go/repoaudit

> 仓库审计包，检查模型仓库的完整性和一致性。CLI 命令 audit-split/rollback-impact 操作此包。

## 文件结构

- `repoaudit.go`（379 行）— 审计主逻辑（WalkDir 遍历 + 文件校验 + dedup 二次扫描）

## 不变量

- **符号链接守卫**：拒绝根目录符号链接，跳过子树内符号链接（与 dedup 包对齐）
- **R34 P2-3 根 symlink 守卫 filepath.Clean 修复**（repoaudit.go:159）：原 `path == dirPath` 字符串比较，含尾斜杠/`..`/未 clean 路径时比较失败，根符号链接被静默跳过，产出空报告。修复：`path == filepath.Clean(dirPath)`。
- **无界 JSON 解码 OOM 风险**（repoaudit.go:337-353，R34 P3-4 待修）：`json.NewDecoder(f).Decode(&v map[string]interface{})` 无大小上限/无 `io.LimitReader`，单个数 GB 的恶意或损坏 `.json/.ysm` 文件会全量载入内存。修复方向：先 `st.Size()` 上限校验，或包 `io.LimitReader`。
- **无 context/超时**（repoaudit.go:125/256，R34 P3-5 待修）：`Audit` 与 `HealthReportFor` 无 `context.Context`/超时，大仓库审计可能长时阻塞 GUI 绑定层。

## 已知限制 / 待治理

- P2-4 WalkDir 回调对 `err != nil`（无权限目录）仅 `append` warning 后 `return nil`，部分目录不可达时 `TotalFiles` 偏低但分数仍可能 100，静默偏绿。修复方向：累计访问异常计数，超过阈值标记 `partial=true`。
- P2-5 `isModelFileValid` 对未识别扩展名 `return true` 放行，若未来调用方放宽 gate，未知扩展名被误判有效。修复方向：函数内对未识别扩展名 `return false` 防御性收紧。
- P3-6 `HealthReportFor` 中 dedup 扫描失败直接 `return HealthReport{}, err`，丢弃已成功的 `audit` 结果。修复方向：dedup 失败时保留 audit 部分、Dedup 置零并在 warnings 追加。

## 相关

- `go/dedup/` — 去重扫描（repoaudit 调用 `FindDuplicateFiles`）
- CLI 命令 `audit-split` / `rollback-impact`
