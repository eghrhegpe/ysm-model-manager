# ADR-331-d2：i18n-ui-check 补第四通道：toast 载荷

- **状态**：✅ 已采纳（Accepted）
- **日期**：2026-10-15
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **关联主 ADR**：ADR-331
- **相关**：`scripts/i18n-ui-check.ts, tests/test_i18n_ui_check.ts`

---

## 背景（一句）

ADR-331 补了第三通道（throw/reject）后，闸的射程仍缺一角：`toast()` / `toastError()` **就是**把文案推上屏的函数，却既无 HTML 信号、非 `value/text/tooltip` 赋值、也非错误构造头——三通道全不覆盖（锐评 2026-10-13 已记录该「门禁覆盖缺口」，当时判为「比单个漏网更值得记」）。

## 决策（三行）

1. `scripts/i18n-ui-check.ts` 增**通道四**：字面量含汉字、行内前缀为裸 `toast(` / `toastError(` 调用头、且未包 `t()` → 判漂移；命中行或上一行 `// i18n-allow: <理由>` 台账照旧豁免（四通道同一处判定）。
2. 射程边界明写：与既有三通道同为**行内**判据，跨行 toast 载荷不覆盖；带点号前缀的别名调用（`foo.toast(...)`）不认，只认本仓 `@/utils/dom/toast.ts` 的裸 helper。
3. **不做观察期/基线**：补闸前一次性清偿该盲区下的存量（探针实测 6 处，全为 en/ja 用户可见硬编码：`app-modules` 组件加载失败与系统主题跟随、创意工坊下载/操作失败、3D 预览不支持类型、截图保存失败）——处置后 `--json` 的 `drift` 仍为 0，故直接生效。

## 后果（一句）

新增一条「UI 文案必须走 `t()`」的覆盖面；回退 = 摘掉 `TOAST_CALL` 判据一处（一行），无数据/契约影响。

<!-- 文件名: i18n-ui-check-toast-channel.md → 实际文件 decisions/ADR-331-d2-i18n-ui-check-toast-channel.md（ADR-320 decisions 轻量模板） -->
