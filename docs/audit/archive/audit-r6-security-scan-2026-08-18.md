# R6 审核报告：安全横切扫描（全仓）

**审核日期**：2026-08-18
**审核范围**：全仓 TypeScript/Go 源码
**审核维度**：XSS、注入攻击、URL 安全、事件监听泄漏、rAF 泄漏

---

## 进度统计

| 指标 | 数值 |
|------|------|
| 审核文件数 | ~5000（前端 TS）+ ~400（Go） |
| 发现问题总数 | 2 |
| P1（严重） | 0 |
| P2（一般） | 1 |
| P3（建议） | 1 |

---

## P2 问题（一般）

### P2-1: addEventListener/removeEventListener 数量不匹配

| 项目 | 内容 |
|------|------|
| 范围 | 全仓前端 |
| 问题描述 | `addEventListener` 调用 261 次，`removeEventListener` 仅 73 次，存在 188 次的潜在泄漏。多数情况下通过组件卸载、生命周期钩子或全局清理函数处理，但需要确认所有路径都有配套移除。 |
| 风险 | 中等：主要影响网页版（browserAdapter），桌面版由 Wails 生命周期管理。在长时间运行场景下，未清理的事件监听器会导致内存泄漏和意外行为。 |
| 修复建议 | 对动态创建的组件（如社区下载队列、预览面板）增加卸载时的监听器清理逻辑。建议在组件工厂函数中统一返回 cleanup 函数。 |

---

## P3 问题（建议）

### P3-1: innerHTML 使用广泛，部分场景依赖调用方保证安全

| 项目 | 内容 |
|------|------|
| 范围 | frontend/src/features/community/, frontend/src/features/import-queue-*.ts |
| 问题描述 | 多处使用 `.innerHTML =` 赋值，虽然已有 `esc()` 转义函数，但部分拼接字符串（如错误信息、用户数据）依赖调用方主动调用转义。如果未来新增调用时遗漏转义，可能引入 XSS。 |
| 风险 | 低：现有代码均已正确使用 `esc()`，但缺乏强制性的编译期保护。 |
| 修复建议 | 考虑将 `esc()` 集成到模板系统中，或添加 ESLint 规则禁止直接使用 `innerHTML`（强制使用 `textContent` 或安全的拼接函数）。 |

---

## 安全基线检查（全部通过 ✅）

| 检查项 | 状态 | 说明 |
|--------|------|------|
| `eval()` 使用 | ✅ 无 | 未发现 eval 调用 |
| `new Function()` | ✅ 无 | 未发现动态函数构造 |
| `document.write()` | ✅ 无 | 未发现 document.write |
| `dangerouslySetInnerHTML` | ✅ 无 | 无 React，未引入 |
| URL 重定向 | ✅ 安全 | 使用 `noopener` 开新窗口 |
| HTML 转义 | ✅ 已覆盖 | `esc()` 函数统一处理 |
| JSON 解析 | ✅ 安全 | 仅用于结构化数据 |
| 事件监听清理 | ⚠️ 需关注 | 见 P2-1 |
| rAF 清理 | ✅ 已实现 | cleanup-3d.ts 统一管理 |
| ESC 处理器 | ✅ 已修复 | R1 审核已修复双重注册 |

---

## 良好实践

| # | 实践 | 位置 | 说明 |
|---|------|------|------|
| 1 | **统一转义函数** | `frontend/src/utils/dom/html.ts` | `esc()` 函数集中处理 HTML 特殊字符转义，所有 innerHTML 拼接均经过此函数。 |
| 2 | **noopener 安全链接** | `web-common.ts:112`, `settings/init.ts:289` | 所有 `window.open` 调用均使用 `noopener` 特性，防止新页面访问原窗口对象。 |
| 3 | **Proxy fail-fast** | `browser-adapter.ts:56-65` | 未实现的 binding 返回抛出错误的函数，避免 undefined 穿透导致静默安全漏洞。 |
| 4 | **IDB 异常降级** | `idb.ts`, `web-store.ts` | IndexedDB 操作失败时降级为内存存储，避免敏感数据泄露到不可靠的持久化层。 |

---

## R1/R2/R3/R4/R5 审核交叉验证

- **R1 修复验证**：ESC handler 双重注册已修复（`mount-preview-core.ts:645`），rAF 泄漏已修复（`cleanup-3d.ts:62`）
- **R2 对齐**：Go 后端的 `isPathInRootOrSelf` 守卫与前端的路径校验形成双重保护
- **R3 补充**：SSRF 防护在 proxy.go 中已实现，前端无直接网络请求绕过风险
- **R4 验证**：MMD 子目录同步不涉及安全边界变更
- **R5 结论**：前端数据层无新增安全风险

---

## 结论

**R6 安全横切扫描通过** ✅。代码库整体安全基线优秀：
- 零高危 XSS/注入漏洞
- 统一转义机制覆盖全面
- 安全链接规范一致
- 事件监听泄漏为已知技术债，非即时风险

建议后续迭代中逐步解决 P2-1 的监听器配对问题，并考虑添加 ESLint 规则防止未来的 innerHTML 误用。
