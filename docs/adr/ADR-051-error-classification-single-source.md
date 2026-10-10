# ADR-051：错误分类单一事实来源：结构化错误码替代双份文本匹配表

- **状态**：✅ 已采纳（Accepted）
- **日期**：2026-08-11
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-032 错误分类 errno 优先,ADR-035 防回潮立项`

---

## 1. 背景（Context）

2026-08-11 审核轮（go-errors / app-nav / app-resource-manager）发现错误分类存在系统性治理缺口：

1. **`go/errors/errors.go` 是死代码**：`Friendly()` 全库零调用（grep 无任何生产代码 import 或调用），唯一使用方是自身测试。但 `docs/funcmap.md`、`docs/knowledge/go-errors.md`、`docs/architecture.md` 均宣称该包服务于「异常路径 toast」红线——**文档与实际不符**（P1-1）。
2. **前后端双份分类表已漂移且结论矛盾**：前端实际消费方 `frontend/src/utils/dom/errors.ts`（`friendlyError`）维护一套正则表，与 Go 端 `errors.go` 的子串表分叉：
   - `file exists`：前端 `errors.ts:35` 归入 `fileLocked`（文件被占用）；Go 端 `errors.go:29-34` 注释明确论证必须归「文件已存在」——**两层结论直接相反**。
   - `too many`：前端仍用裸 `too many`（测试甚至断言 `"too many open files" → 操作过于频繁`）；Go 端 `errors.go:49-52` 已专门收窄掉 EMFILE/ELOOP 误伤。
3. **英文子串分类是 AGENTS.md 明列反模式**：`errors.go:57-63` 循环 `strings.Contains(strings.ToLower(msg), p)` 16 组英文子串分类，脆弱、跨平台失效。仓库已有三套更稳先例：errno 判定（`installer.go:432` `errnoIs`，ADR-032）、哨兵错误（`fsutil/write.go:20` `ErrTempCreateFailed`）、错误码（`types.AppError.Code`）。
4. **`AppError.Code` 零消费**：`go/types/types.go:104-111` 定义 Code 字段，几十处构造赋值，但全库 grep `.Code` 零命中——**错误码是死字段**，分类仍退回字符串匹配。
5. **错误透传泄漏内部路径**：`errors.go:60/66` 与前端 `errors.ts:54` 兜底均把原始英文错误整段拼给用户（含完整文件路径/主机名）。

## 2. 决策（Decision）

**错误分类收敛为单一事实来源：Go 产结构化错误 → 前端只消费结构化字段做 i18n。**

1. **删除 Go 端文本匹配表**：`go/errors/errors.go` 整体移除（含测试与文档引用），`Friendly()` 不再存在；文档（funcmap / 知识卡 / architecture）同步修正「go-errors 服务 toast」的错误宣称。
2. **Go 端产出结构化错误**：以 `types.AppError` 为唯一错误载体，落地三优先级的分类范式（沿 ADR-032）：
   - **errno 优先**：`errors.Is(err, syscall.Errno(...))` 判定（Windows/Unix 错误码空间不重叠，跨平台安全）；
   - **哨兵错误**：包内定义 `ErrXxx = errors.New(...)`，`errors.Is` 消费；
   - **错误码**：激活 `AppError.Code` 消费链（当前零消费），`AppError` 增加 `Unwrap() error` 保留底层错误链（当前被字符串拼接截断，`errors.Is` 失效）。
3. **前端只消费结构化字段**：`friendlyError` 改为读取 `AppError.Code` / 结构化字段做 i18n 映射；删除前端正则分类表或与 Go 表二选一，**禁止双份维护**。原始错误只进日志（dbg），用户侧只显示分类提示，不拼完整路径。
4. **透传截断**：分类命中后不拼原文（或剥离路径段）；未命中兜底显示通用「操作失败」而非整段英文原文。

## 3. 后果（Consequences）

**正面**：
- 消除死代码 + 文档漂移（P1-1 闭环）；
- 消除前后端分类结论矛盾（`file exists` 双归、`too many` 误伤）；
- 跨平台稳定（不再依赖英文错误文本，Windows 中文系统下英文子串匹配本就失效）；
- 错误链可穿透（`Unwrap` 恢复 `errors.Is` 能力）。

**负面**：
- 前端 `friendlyError` 需改造为消费结构化字段，涉及全库 toast 错误文案的回归验证（30+ 处调用点）；
- Go 侧 `AppError` 增加 `Unwrap` 与 Code 消费链，需补 `errors.Is/As` 单测；
- 中文系统上错误文本变化可能导致既有中文兜底文案的显示差异（属预期改进）。

**已知遗留**：
- `hasChinese` 启发式（CJK 基本区扫描）随删除一并移除；
- 前端 `utils/dom/errors.ts` 正则表删除后，测试断言（如 `"too many open files" → 操作过于频繁`）需同步更新为结构化字段断言；
- 该立项与 ADR-035「防回潮」互补：本 ADR 治理现状，ADR-035 防止未来回归。

## 4. 数据溯源

- 审核轮（2026-08-11）：`go/errors` 全库零调用 grep 实证（`errors.Friendly` / import / `AppError.Code` 均零命中）；
- 前后端表漂移实证：`frontend/src/utils/dom/errors.ts:35` vs `go/errors/errors.go:29-34` 对 `file exists` 结论相反；
- 仓库既有范式先例：`installer.go:432`（errno）、`fsutil/write.go:20`（哨兵）、`types.go:104`（Code）；
- 落地顺序建议：① 删 go/errors + 文档修正 → ② AppError.Unwrap + Code 消费链 → ③ 前端 friendlyError 结构化改造 → ④ 回归验证全库 toast。

<!-- 文件名: error-classification-single-source.md → 实际文件 ADR-051-error-classification-single-source.md -->
