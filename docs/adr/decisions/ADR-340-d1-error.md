# ADR-340-d1：拉取结果结构化：部分失败不再是 error（绑定层不吞成功计数）

- **状态**：✅ 已采纳
- **日期**：2026-10-14
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **关联主 ADR**：ADR-340（推送链去总线化：请求-响应回归直调）——本条是「直调之下结果体裁」的执行切片
- **准入理由**：公共契约变更（`PullResourceFromInstance` 返回值由 `(int, error)` 改为 `types.PullSyncResult`）

---

## 背景（一句）

直调模式下（ADR-340）绑定的 **error 非 nil 即以 reject 交付、第一个返回值在途中丢失**——而 `PullResources` 恰恰把「部分失败」编码成 `(count, ErrPartialSync)`，于是侧栏拉取只能说「拉取 0 个文件, N 个失败」，**文件其实已经搬进仓库**（对用户说谎）。

## 决策（三行）

1. `go/sync/sync_push.go|PullResources` 返回 `types.PullSyncResult{OK, Failed, FirstError}`（**无 error 返回值**——本函数没有可前置失败的路径）；条目级失败进结果字段。
2. `internal/app|PullResourceFromInstance` 绑定同步改签名（error 只留**前置不满足**：未配置 mcRoot / 类型目录解析失败），`go/cli|AppService` 接口与 `instance pull` 命令照改（CLI 也如实分开报「拉了多少」与「几个失败」），并**重生成绑定**（`cd frontend && npm run generate:bindings`）。
3. 前端 `sync-flow.ts|runPull` 消费结构化结果：跨类型累加 `ok`/`failed`，汇总 toast 追加首个失败原因（`sidebar.pullFirstError`，三语）；reject 只剩前置不满足，按「一个类型批次失败」计入。

## 后果（一句）

拉取的成功计数不再丢失、失败原因可点名；**对称性留白**：`PushResources` 仍用 `(int, ErrPartialSync)`——它的绑定 `PushResourceToInstance` 当前无 UI 消费者（推送计数走 `features/sync|downloadMissing` 展开后的文件级结果），`ErrPartialSync` 仍被 `RelinkDir` 的「零成功上抛」使用；将来若要接线推送绑定，照本结构改（已在 `types.PullSyncResult` 注释登记）。回退方式：改回 `(int, error)` 即退回旧谎报，无数据风险。

<!-- 文件名: error.md → 实际文件 decisions/ADR-340-d1-error.md（ADR-320 decisions 轻量模板） -->
