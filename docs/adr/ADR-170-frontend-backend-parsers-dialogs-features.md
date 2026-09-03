# ADR-170：frontend 分层:backend 桥层收窄+解析簇下沉 parsers,dialogs 升格 features(二段式)

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-03
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：前端架构锐评 P0-1（`docs/knowledge/frontend_design_critique.md`）、ADR-123（右键可达性单一事实源）

---

## 1. 背景（Context）

前端架构锐评 P0-1 指控：`backend/`（797K，55 文件）与 `utils/dom/dialogs/` 分类事故——`backend/` 混装纯解析器（ysm-header 732 行 / voxel-parse 658 / nbt-parse 501）、纯数据（voxel-colors-data.json 63K）、Service Worker（coi-sw）、CLI 白名单、浏览器运行时（web-* 20 件）；`utils/dom/dialogs/` 内是完整业务功能（批量重命名/标签编辑器/高级筛选）。

**实测内部依赖图（2026-09-03 取证）推翻「5 类清爽拆分」可行性**：

- 桥层是强互连链：`app → platform-web → browser-adapter → web-* 20 件` 一环扣一环（browser-adapter 直接调用 web-* 全家，web-* 是 web 模式的事实后端而非「假后端」）。
- 外部消费高度集中：103 个消费方文件的 **123 处 import 全部打在 6 个桥文件**（app 90 / platform-web 17 / browser-adapter 8 / runtime 4 / platform 3 / types 1）；被移候选文件（解析簇 + coi-sw）的外部消费仅 ~7 处 + dialogs 22 处。
- 解析簇是真叶子：ysm-header/voxel-parse/nbt-parse/extract/pack-meta/voxel-colors 内部互引 + 只依赖 web-common 一个跨簇工具。

## 2. 决策（Decision）

**二段式拆分，桥文件收窄为唯一稳定面，不留 re-export shim。**

### 第一段（本轮，纯移动低风险）

1. 解析簇 → `src/parsers/`：`ysm-header.ts`、`voxel-parse.ts`、`nbt-parse.ts`、`extract.ts`、`pack-meta.ts`、`voxel-colors.ts` + `voxel-colors-data.json` + 各测试（含 `voxel-colors.parity.test.ts`）。`zipentry.parity.test.ts` 独立（只依赖 utils/resource/types）留原处。
2. `coi-sw.ts` + 测试 → `src/workers/`（与 stats worker 族同目录）。
3. `utils/dom/dialogs/` 18 文件 → `src/features/dialogs/`（业务功能归位）。
4. **6 个桥文件原地不动**：`app.ts` / `runtime.ts` / `platform.ts` / `platform-web.ts` / `browser-adapter.ts` / `types.ts` —— 123 处外部 import 零触碰。
5. 不留 re-export shim：被移文件外部消费合计有限，codemod 直接改写消费方 import，一次到位不留双路径债务。

### 第二段（立方向，不本轮执行）

web-* 20 文件族 + browser-adapter 迁 `adapters/browser/`。须等第一段落地、全量门禁绿后再立项。届时消费方只打 6 桥文件的格局不变，实际要改的只有 web-* 族内部互引 + browser-adapter 装配点，风险已被第一段隔离。

## 3. 后果（Consequences）

**正面**：`backend/` 语义收窄为「桥 + 浏览器运行时」；解析器与业务对话框不再误住基础设施层；目录名与内容自解释。

**负面 / 已知遗留**：
- `backend/` 仍含 web-* 浏览器运行时（二段处理），第一段完成后目录非最终态——**禁止任何会话因「web-* 还在 backend/」重提一次到位**，依据见下节实测。
- 解析簇内 `voxel-parse.ts` / `pack-meta.ts` 对 `web-common`（留 backend）产生单向跨簇依赖 2 处，属分类残留，随第二段 web-common 归位后消除。
- `utils/dom/dialogs/` 内部对同目标引用深度写法不统一（`../../dom/display.ts` vs `../../../utils/dom/display.ts`），迁移须脚本按绝对路径重算，禁止手改。
- **分层债务现形（dialogs 升格的结构性代价）**：`core/` 命令层（context-menu 族 ×3、handlers/android-events/instance-ops）依赖 features/dialogs 的 7 条反向边，原藏 `utils/dom/dialogs/`（core→utils 合法）随升格现形为 R3 违规。已登记 `docs/.layering-baseline.json`（2026-09-03，7 条）为已知债务。**根治方向**：core 触发对话框改走 bus 事件 / 依赖注入，专项重构，勿用移目录规避。

## 4. 数据溯源

来源 → 结果：
- `find backend -type f` → 55 文件扁平无子目录；`du -sk` 797K。
- `grep -rho 'from "…backend/…'`（全仓 .ts）→ 103 消费方文件；按文件聚合 → app 90 / platform-web 17 / browser-adapter 8 / runtime 4 / platform 3 / types 1 / web-common 3 / voxel-parse 2 / extract 2 / idb 1 / cli-allowlist 1。
- backend 内部相对引用图（`from "./x"` 聚合）→ app→{browser-adapter, platform-web, types}；platform-web→{browser-adapter, platform}；browser-adapter→web-* 全家；runtime→platform-web → 桥层链强互连成立。
- 解析簇外部消费 grep → 仅 preview-3d/adapters/litematic-adapter（voxel-parse）、views/app-preview/litematic-3d（voxel-parse + app）、preview-3d/adapters/mmd-zip-overlay(.ts/.test)（extract）。
- coi-sw 外部消费 grep → app-modules.ts、app-modules.boot.test.ts、wasm/ysm-worker-loader.ts。
- dialogs 外部消费 grep → 12 生产（core/features/views）+ 10 测试。
