# ADR-096-d1：repo_subdir 运行时通道去留裁定：保留为跨语言契约占位、禁新增消费者

- **状态**：📝 提议中（Proposed）
- **日期**：2026-10-14
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **关联主 ADR**：ADR-096
- **相关**：`frontend/src/utils/resource/types.ts|typesMetaOf; frontend/src/views/app-content/init-pages.ts; frontend/src/features/import/loader.ts; app-tree.md 知识卡`

---

## 背景（一句）

ADR-096 已点出「`app-nav` 的 MMD 子目录下拉 `repo_subdir` 写入后零消费，选了没效果」——2026-10-13 锐评复核后确认它是一条**跨 6 文件的完整死链**（生产者 `types.ts|typesMetaOf` 恒回 `""`，下游 `init-pages.ts` 恒 `removeAttribute("subdir")`、`loader.ts` 的 `subdir || rtype` 分支恒假、`app-sync-manager` 订阅体恒早退），两路子代理独立报出同一处。

## 决策（三行）

1. **保留** `repo_subdir` 通道为跨语言契约占位，**不删除、不激活**——三重牵连：Go/TS 绑定签名同源、`localStorage` 已存量写入、未来 MMD 子目录消费恢复预期。
2. **禁新增消费者**：任何新代码不得依赖 `repo_subdir` 传播或读取；知识卡正文标注其为「死链」事实，`check-knowledge-drift` 不因符号存在而豁免正文断言。
3. **将来触发删除**：当 `repo_subdir` 不再被任何 localStorage 版本兼容需求引用时，作为跨语言清理任务一次性移除（前端字段 + Go 绑定 + `app-tree.md` 知识卡同步删）。

## 后果（一句）

行为零变化（通道本已死），但死链从「无主遗留」转为「有裁定、有边界、有退路」；回退方式 = 删除任务前随时可撤销本裁定，删除任务本身按常规回滚。  

<!-- 文件名: repo-subdir-channel-disposition.md → 实际文件 decisions/ADR-096-d1-repo-subdir-channel-disposition.md（ADR-320 decisions 轻量模板） -->
