# ADR-342-d1：重链接失败结构化下发（RelinkResult 取代 ErrPartialSync 抬升）

- **状态**：✅ 已采纳（Adopted）
- **日期**：2026-10-14
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **关联主 ADR**：ADR-342（§D7/D7′）
- **相关**：`go/types/types.go, go/sync/sync_relink.go, internal/app/app_install_instance.go, frontend/src/views/app-content/settings/init.ts`

---

## 背景（一句）

ADR-342 D7 用 `ErrPartialSync` 把「零成功且有失败」抬成 error，但 `(int, error)` 体裁在 Wails 绑定下仍有半截问题：**部分成功时失败计数被扔掉**——`RelinkAllInstanceResources` 返回 `(total, nil)`，设置页 toast 只能弹「已重新链接 N 个文件」，`settings.relinkDonePartial`（N 成功 M 失败）三语 key 因前端 `failed` 恒为 0/1 而长期不可达。

## 决策（三行）

- `RelinkDir(...) (types.RelinkResult, error)`：error 仅前置不满足（参数/scanFn 空）；条目级失败进 `res.Failed` + `res.FirstError`（经 `sink` Logger 包装闭包归集首个原因），**零成功不是 error**。
- `RelinkAllInstanceResources(instanceName) (types.RelinkResult, error)`：聚合各类型 `RelinkResult`，单类型部分失败不中断循环；绑定签名 `number` → `RelinkResult`，重生成 bindings。
- 前端据此弹「已重新链接 N 个文件（M 个失败；首个失败原因：…）」；`ErrPartialSync` 仍保留给 `PushResources` 使用。

## 后果（一句）

既有 D7 用例的 `ErrorIs(…, ErrPartialSync)` 断言改为 `NoError` + `res.OK`/`res.Failed`/`res.FirstError` 断言（行为等价，仅承载体裁变了）；摘掉 `sink` 的 firstErr 归集 → 四条 D7 用例的 `FirstError` 断言立即红（已变异检查）。回退：改回 `(int, error)` + `ErrPartialSync` 抬升，同步回滚绑定签名与前端 toast 文案。
