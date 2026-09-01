---
kind: utils-errors
name: 错误处理 errors
tier: architecture
category: utils
source_files:
  - frontend/src/utils/dom/errors.ts
tests:
  - frontend/src/utils/dom/errors.test.ts
quick_groups:
  - 跨组件通信与页面
quick_intents:
  - 错误提示、友好错误、friendlyError
  - toast 文案、报错翻译、网络错误
  - isFileExistsError
quick_risk_lines:
  - 所有异常路径必须经 friendlyError 转中文提示，禁止裸抛原始错误到 UI
pitfalls:
  - 裸抛原始错误 → 用户看不懂、违反治理红线；必须经 friendlyError 翻译
  - 网络错误未分类 → 一律显示未知错误；必须经 friendlyError 的网络错误分支

use_when:
  - 错误提示
  - 友好错误
  - friendlyError
  - toast 文案
  - 报错翻译
  - 网络错误
  - 文件被占用
invariant_anchors:
  - frontend/src/utils/dom/errors.ts|friendlyError
  - frontend/src/utils/dom/errors.ts|isFileExistsError
---

# 错误处理 errors

## 概览

把 Go 端/运行时返回的原始错误转换为用户可读的中文提示，是异常路径 toast 文案的统一入口（治理红线：所有异常路径必须有 toast 反馈）。

## 核心职责

- Go 结构化 AppError.Code → i18n key 映射（单一事实来源，ADR-051 完成）
- 未列出的 Code：透传 Reason 中文（Go 端已在 Reason 中填写用户可读文案），含内部路径段经 `stripPathSegments` 剥离
- 非 AppError（纯字符串/JS Error）：含汉字直接透传；英文兜底拼接可配置前缀
- 已含中文的消息直接透传（Go 端已友好化/已翻译）

## 对外 API / 入口

- `friendlyError(err: unknown, fallback = "操作失败"): string`
  - 空值 → `"未知错误"`；err 可为 Error 对象或字符串
  - 优先级：**① 结构化 AppError.Code**（CODE_KEYS 映射 → i18n key）→ **② 未列出 Code 含中文 Reason**（透传，剥离路径段）→ **③ 含汉字消息**（透传）→ **④ 英文兜底**（`${fallback}: ${message}`）
  - CODE_KEYS 覆盖：FILE_EXISTS/ALREADY_EXISTS → alreadyExists；INVALID_PARAM/INVALID_PATH/FILENAME_INVALID → invalidArg；FILE_TYPE_UNSUPPORTED/UNSUPPORTED_FORMAT → unsupported；DECODE_FAILED → dataFormat
  - 未列出 Code（IO_ERROR/MKDIR_FAILED/WRITE_FAILED/FILE_EMPTY/FILE_TOO_LARGE/LINK_FAILED）靠 Reason 中文透传，不武断归类

## 与其他子系统关系

- 消费方覆盖全部异步操作层：`core/handler-sync` + `handler-other` + `context-menus`、`features/version-updater` + `recycle-bin` + `import-queue`、`app-tree`（instance-actions / bus-handlers / toolbar-events）、`app-content/community`（settings / site-view）、`app-sync-manager`
- 标准调用模式：`catch (e) { bus.emit("toast:show", { type: "error", message: friendlyError(e, "XX失败") }) }`，toast 呈现见 [app_toast](./app-toast.md)
- Go 端错误源头经 `types.AppError` 结构化错误码（ADR-051：Go 产 errno/哨兵/Code，前端 friendlyError 消费 Code 做 i18n，原 go/errors 文本匹配表已删除）

## 不变量

- 治理红线：**所有异常路径必须有 toast 反馈**（AGENTS.md §3.3），禁止静默 `catch {}`；catch 后消息一律经 friendlyError 再给用户
- 不把技术栈细节（堆栈/英文原文）直接暴露给用户，仅在 fallback 分支附原文以便排查
- ADR-051 完成后：正则表已删除，分类单一事实来源为 Go `AppError.Code`；前端只消费结构化字段做 i18n

## 审计遗留备案（2026-08-11）

> 以下为多轮子代理审计确认的已知遗留，部分已随 ADR-051 收尾解决。

- ~~**正则表整体保留**~~：✅ ADR-051 已完成——前端正则模式表已删除，单一事实来源为 Go `AppError.Code`。errors.test.ts 中的 16 类正则断言已同步更新为结构化 Code 断言。
- **`!err` 分支忽略 fallback 参数（低）**：`friendlyError(null, "重命名失败")` 返回「未知错误」而非带上下文前缀；测试仅覆盖无 fallback 情形。若需统一语义，应改为 `fallback` 兜底（与 L94 一致）。
- **透传剥离路径段（P2 已修复，2026-08-11）**：Go 端 `AppError.Error()` 拼入 `源路径：/目标路径：` 内部绝对路径，friendlyError 中文透传/兜底前经 `stripPathSegments` 剥离（ADR-051「透传截断」）；新增模式注意勿重新引入原文拼接。

## esc 转义统一备案（2026-08-11，子代理审计）

> esc（`utils/dom/html.ts`，5-replace 含引号）是全项目 HTML 转义唯一入口（陷阱 #15，check-redlines R10 扫描）。以下旁路属已知遗留，落地前先 Grep 确认无重复实现。

- **modal.ts re-export 双入口**：`dialogs/modal.ts` re-export `esc`，导致 version-updater.ts / adv-filter.ts / rename.ts 经 modal 导入、其余文件直连 html.ts——函数同一无行为分歧，但违反「统一入口」精神，且未来 modal.ts 改动 re-export 会漂移。建议统一从 `utils/dom/html.ts` 导入。
- **3 处手写部分转义绕过 esc**（均在 utils/dom 之外）：
  - `views/app-content/index.ts` — `String(insName).replace(/"/g, "&quot;")`：只转义引号，`&`/`<` 未转义，拼入 innerHTML 属性。
  - `views/app-content/site/render.ts` 与 `site/events.ts` — `fallbackDiv.replace(/"/g, '&quot;')`：已转义 HTML 嵌入单引号属性时手写引号转义。
  - 测试内联 mock（import-queue.test.ts / community.test.ts / site/events.test.ts）自建 3-replace esc（缺 `>`、`'`），与真实 5 字符 esc 不一致——测试断言无法锁定真实转义行为。
  - 建议统一改 `esc`（或与 html.ts 输出语义对齐的共享函数），并修正测试内联 mock。

## 相关

- [app_toast](./app-toast.md) — toast 呈现
- [event_bus](./event-bus.md) — toast:show 事件通道
- `frontend/src/utils/dom/errors.test.js` — 单元测试（验证入口）
