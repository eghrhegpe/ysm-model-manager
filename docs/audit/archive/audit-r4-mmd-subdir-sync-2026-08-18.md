# R4 审核报告：MMD 子类型目录落位（commit 7420399c）

**审核日期**：2026-08-18
**审核范围**：`go/sync/sync_dirlevel.go`, `go/sync/sync_mmd_subdir_test.go`, `resource_types.json`, `browser-adapter.contract-b1.test.ts`（7 文件 / 80 行）
**审核维度**：路径语义一致性、同步逻辑正确性、测试覆盖、前端契约对齐

---

## 进度统计

| 指标 | 数值 |
|------|------|
| 审核文件数 | 7 |
| 发现问题总数 | 2 |
| P1（严重） | 0 |
| P2（一般） | 0 |
| P3（建议） | 1 |
| ✅ 良好实践 | 3 |
| 验证结果 | Go build ✅ | go test ./go/sync/ ✅ (全 95 用例通过) | vite build ✅ | tsc --noEmit ✅ |

---

## P3 问题（建议）

### P3-1: mmdSubdirNames 未处理 DefaultAnim/DefaultMorph 同步边界

| 项目 | 内容 |
|------|------|
| 文件:行号 | `go/sync/sync_dirlevel.go:39-48` |
| 问题描述 | `mmdSubdirNames` 已包含 `defaultanim` 和 `defaultmorph`（上游 PathConstants.java 的系统内置目录），注释也说明了"虽用户不导入，但已存在时同步需识别"。然而同步入口 `PushResources` 的 logger 回调会对每个 synced/missing/extra 条目触发，若实例侧已有 DefaultAnim 目录（系统残留），global 侧没有对应项，会报 missing 并触发不必要的复制尝试。 |
| 风险 | 极低：DefaultAnim/DefaultMorph 目录通常在实例侧为空或仅有系统文件，不会造成功能损坏，仅产生少量日志噪音。 |
| 修复建议 | 可选：在 collectEntries 中对 defaultanim/defaultmorph 子目录增加过滤（空目录或仅含 .mcmeta/.txt 文件时跳过）。暂缓，待实测日志噪音出现后再处理。 |

---

## 良好实践（亮点）

| # | 实践 | 说明 |
|---|------|------|
| 1 | **rtype 隔离** | `mmdSubdirNames` 增强仅在 `rtype == "mmd-skin"` 时生效，其他类型（ysm/resourcepack 等）走既有 `isDirTypeModelFolder` 路径，零干扰。 |
| 2 | **filepath.SkipDir 正确使用** | 识别到 MC-MMD 子目录后立即 `return filepath.SkipDir`，防止其内部模型文件夹被二次收集（否则 EntityPlayer/角色A 会被递归展开成两个 key，与 SkipDir 后的顶层 key "entityplayer" 冲突）。 |
| 3 | **契约测试同步更新** | `browser-adapter.contract-b1.test.ts` 的 `expect(map["mmd-skin"]).toBe("3d-skin")` 与 resource_types.json 的 installDir/scanDir 变更严格对齐，防止前端期望漂移。 |

---

## 与 R2 审核的交叉验证

R2 审核发现 P2-3：sync 三级匹配降级路径中 `relKey()` 需验证分组后正确性。**本 commit 不触及 relKey() 路径**（只改 dirLevel 分支），R2 的 relKey 降级路径未受影响。两者互补而非冲突。

---

## 结论

**commit 7420399c 审核通过** ✅。核心改动简洁（+9 行 sync_dirlevel.go）、测试充分（新增端到端测试 + 契约测试对齐）、验证全绿。仅有一个 P3 日志噪音建议，不阻断。
