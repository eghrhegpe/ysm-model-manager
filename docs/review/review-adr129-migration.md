# 评审意见：ADR-129 第三刀迁移（utils/3d → preview-3d）

> 审核人：主模型（鲸鱼架构师） · 审核方式：源码实证 + 全量验证，非纸面推断
> 对象：兄弟会话正在进行的 `frontend/src/utils/3d/*` → `frontend/src/preview-3d/*` 迁移
> 结论：**基本妥当 ✅，可提交；含 1 处编号澄清 + 1 处结构建议（不阻断）**

---

## 1. 先澄清编号：本次迁移对应 ADR-129，不是 ADR-128

- 工作区迁移 = `utils/3d/*` → `preview-3d/*`（227 个 rename + 327 文件改引用），
  这正是 **ADR-129「3D 预览领域根升格」的第三刀**。
- **ADR-128** 是「菜单导航图生成器 + e2e 选择器派生」，不是目录迁移方案；其落地产物
  （`menu-graph.ts` / `schema-registry.ts` / `node-types.ts`）只是随迁对象。
- 关系：ADR-129 §2.4 说明其第一刀为 ADR-128 正地基（`PreviewSnapshot` 归 `state/`）。
- ⚠️ 若兄弟会话对外表述「方案是 ADR-128」，属编号口误，实际依据应为 **ADR-129**。

## 2. 迁移验证结果（实测全绿）

| 验证项 | 结果 |
|---|---|
| `npm run typecheck`（tsc --noEmit） | ✅ exit 0 |
| `npx vite build` | ✅ exit 0 |
| ADR-128 产物单测（menu-graph / schema-registry / node-types） | ✅ 21/21 通过 |
| `utils/3d` 目录残留（双轨） | ✅ 已删，无双轨 |
| `frontend/src` 源码 `utils/3d` 引用 | ✅ 0 处 |
| `tests/` 契约脚本 `utils/3d` 引用 | ✅ 0 处 |
| 门禁脚本锚点（check-adr-drift / check-menu-health / port-align / vitest-env-switch） | ✅ 全换新路径 |
| 依赖倒置修复（ADR-129 第一刀） | ✅ `state/preview-state.ts` 自持 `PreviewStatePath`/`PreviewSnapshot` |
| 知识卡 source_files 锚点（30+ 卡） | ✅ 已批量更新 |

生成物说明（**不是漏网**）：
- `docs/funcmap.md`、`docs/knowledge/index.md` 中的旧 `utils/3d` 由 pre-commit `GEN_CMDS`
  （`funcmap.mjs` / `gen-knowledge-index.mjs`）提交时自动重生成。
- ADR 文档内 134 处旧路径为**历史记录**，应保留不动（ADR 只记决策方向，不改历史）。

## 3. 结构建议（不阻断，二选一）

### 现状 vs ADR-129 目标结构

- **ADR-129 §2.1 目标图**：顶层 `menu/`（preview-menu 家族与 `adapters/` 平级）。
- **实际落地**：`preview-3d/adapters/preview-menu/`（家族仍嵌在 adapters 下，
  adapters 依旧 67 文件平铺）。
- **ADR 自身含糊**：§2.1 画顶层 `menu/`，§2.2 第二刀却写「收进 `adapters/preview-menu/` 子目录」。
  兄弟会话执行的是 §2.2 的写法，故与 §2.1 图不一致——**非执行错误，是文档内部矛盾**。

### 推荐方向：提为顶层 `menu/`（符合依赖直觉）

preview-menu 是被 30+ 文件共享的骨架系统（实测 40 处 import：adapters 平铺 30 +
views/app-preview 5 + state 测试 3），却埋在「品牌商铺」`adapters/` 下，语义与依赖方向拧着。
建议：

```
preview-3d/
├── state/         地基（已归位 ✅）
├── menu/          preview-menu 家族整体上提（域根内去前缀）
├── caps/          能力控件系统
├── adapters/      ysm/mmd/vrm/fbx/litematic 适配器
└── perception/    感知子系统
```

依赖链：`state → menu → caps → adapters`，自上而下谁依赖谁。

### 成本（兄弟会话已把 90% 做完）

第二刀已把 `preview-menu/` **内部去前缀**完成，只差物理上提：
- adapters 平铺：`./preview-menu/xxx` → `../menu/xxx`（约 30 处，机械）
- views/state 测试：`.../adapters/preview-menu/` → `.../menu/`（约 8 处）
- `scripts/check-menu-health.mjs` 的 `MENU_FILES`/`coreFile` 锚点（2 处）
- menu 内部指向 caps/state 的 import：`../../` → `../`（同层关系）
- 知识卡 source_files 锚点扫一遍（ADR-128/129 相关卡）
- 收尾 `typecheck` + `vite build` + menu 系测试

### 若接受现状

只需把 ADR-129 §2.2 描述与 §2.1 结构图对齐写成 `adapters/preview-menu/`，
消除文档内部矛盾即可，代码不动。

## 4. 提交前提醒

- 第三刀验收标准含「发版前全量 `doctor` 兜底」。typecheck/build 已绿，但 pre-push 全量门禁
  （契约测试 / knowledge-drift / jscpd）尚未跑——**提交前请跑 `node scripts/doctor.mjs`**，
  别只靠局部验证。
- 并行会话活跃，按归属原则**路径限定提交**（只交本次迁移触及的文件），提交前先 `git fetch`
  主分支最新成果 rebase，避免与其它工作树撞车。

---

## 附：本次审核已执行的动作

- 读取 ADR-128 / ADR-129 全文，确认迁移与方案对应关系
- grep 全仓 `utils/3d` 残留（源码/脚本/tests 清零，生成物与 ADR 历史豁免）
- diff 核查门禁脚本锚点同步（check-adr-drift / check-menu-health / port-align / vitest-env-switch）
- 抽查 RM（rename+modify）文件确认仅路径变化
- 实测 typecheck / vite build / ADR-128 产物单测，全部通过
