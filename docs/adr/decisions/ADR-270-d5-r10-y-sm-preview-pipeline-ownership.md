# ADR-270-d5：R10 穿透债归属纠正：YSM 预览数据装配流水线自 views 迁入 preview-3d/adapters（否决再导出面）

- **状态**：✅ 已采纳（Adopted，2026-10-06；d2 遗留项「需入口面 API 设计，另立战役」，本会话规划呈报后用户以「按优先级来」授权推进）
- **日期**：2026-10-06
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **关联主 ADR**：ADR-270

---

## 背景（一句）

R10 立法时（ADR-270-d2 决策 3）把 14 条 views→preview-3d 穿透边判为「需入口面 API 设计，另立战役」入基线；本轮复勘发现**这 14 条不是 import 写法问题，而是归属错位**——`views/app-preview/loader.ts`（缓存→WASM 解码→Go 兜底→动画 clips/纹理映射日志→作者头像回填）与 `views/app-preview/model3d-loader.ts`（spec 获取 → 无 Node 通道兜底解码 → spec LRU → 纹理装载 → R1 契约校验 → load trace）合计约 530 行**纯引擎装配流水线**住在视图层，直接 import p3d 内部细节只是「它住在哪」的结果，不是原因。

## 决策（三行）

1. **否决「在 `preview-3d/adapters/` 建再导出面」路线**（把 7 个目标符号再导出、views 只改说明符）：违反 `frontend/AGENTS.md` 反桶契约 R1「不新增以 re-export 为主体的聚合文件（不限于 `index.ts`，含 `*-re-export.ts` 这类命名）」；且 ADR-270-d2 决策 2 刚以「斩掉经巨型文件再导出面绕行」立过判词——**再导出是以新绕行替旧穿透**，不采纳。
2. **采纳归属纠正**：把 YSM 预览数据装配流水线**整段迁入** `preview-3d/adapters/`（承载真逻辑，非转发）——迁移内容 = `loader.ts` 的 `loadModelData` / `fillAuthorsAsync` 全链 + `model3d-loader.ts` 的 `preloadModel` / `fetchSpec` / `fetchSpecViaWasmFallback` 与 spec LRU；views 侧只留视图接口（`app-preview/utils.ts` 的 `YsmDecoder` / `PreviewDebugger` 注入契约——该注入缝已存在，流水线沿用 `ctx.decodeYsmViaWasm` 而非自建 import）与渲染/DOM。
   该层直引 `backend/app.ts` 与既有实践一致：`preview-3d/decoder/wasm-decode.ts`、`preview-3d/screenshot/screenshot-render.ts` 已如此；preview-3d 不在 `LAYER_ORDER` 内，R5 射程外。
3. **范围收窄与收尾**：本 ADR 只治「解码 / 缓存 / spec / 纹理 / 作者」一族的 10 条边；`menu/panels/multi-model` 菜单声明边（2 条）与 `screenshot/screenshot-lights|render` 截图引擎边（2 条）**另立**（前者属 MenuNode 声明层设计——AGENTS.md「3d 菜单只允许 MenuNode schema」，后者属多角度渲染编排，均与本刀解耦）。迁移落地后 `check-layering.ts --update` 收紧 R10 基线 **14 → 4**（基线只减不增守卫自动拦截新增）；**R9 的 ADR-249「默认值单一事实源」立法边不在任何射程内，不动**。

## 后果（一句）

收益 = views 层不再承载引擎装配（R10 14→4），且新视图模块无法再以「顺手把装配写在这里」扩张耦合面；代价 = 约 530 行跨目录搬迁 + 同目录测试 `loader.test.ts` / `model3d-loader.test.ts` 随迁，硬验收 = **行为等价**（测试用例除 import 路径外零改动即须全绿，另加 `npx vite build` + `npm run typecheck` + `check-layering` R10=4 且回归 0 + `check-path-hygiene`）；回退 = `git revert` 该提交并把基线还原 14 条（无数据迁移、无持久格式变更，可独立回滚）。

<!-- 文件名: r10-y-sm-preview-pipeline-ownership.md → 实际文件 decisions/ADR-270-d5-r10-y-sm-preview-pipeline-ownership.md（ADR-320 decisions 轻量模板） -->
