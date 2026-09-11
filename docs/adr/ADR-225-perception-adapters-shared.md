# ADR-225：perception 模块下沉至 adapters/shared

- **状态**：✅ 已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-11
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/perception/`、`frontend/src/preview-3d/adapters/`

---

## 1. 背景（Context）

`preview-3d/` 下 `perception/`（程序化生命力/呼吸/眨眼/口型/自动跳舞/注视/节拍检测）与 `adapters/`（各格式挂载器）是**同层平级目录**，但 perception 的 7 个 controller 本质是**跨格式共享能力**，仅被 `adapters/` 内少量文件消费。平级切分制造人为距离，属 ADR-167 按行数切片的遗留疤痕（与 `mdXx` 前缀同源）。

实证（2026-09-11 grep）：
- `perception/` 共 14 文件（breath/blink/lipsync/autodance/gaze/core/beat-detector × 实现+测试）。
- 引用 `@/preview-3d/perception` 的文件**仅 6 个**：`mmd-build-menu.ts`、`mount-session.ts`、`vrm-adapter.ts[+test]`、`ysm-adapter.ts[+test]`。
- 目标 `adapters/shared/` **不存在**，须新建。

## 2. 决策（Decision）

1. 将 `perception/` 整体下沉至 **`preview-3d/adapters/shared/perception/`**（新建 `shared` 跨格式能力子层）。
2. 6 个消费方 import 路径由 `@/preview-3d/perception/...` → `@/preview-3d/adapters/shared/perception/...`（ADR-146：`@/` 别名，非相对）。
3. 测试文件同迁，import 同步；不改动任何 controller 内部逻辑（纯路径重指）。
4. 新建 `shared/` 后跑 `check-layering`（R0）确认不触发 core 红线（`perception` 含 three 对象操作，属预览层，不应被 `src/core` 引用，方向正确）。

## 3. 后果（Consequences）

- **正面**：跨格式能力集中，消除平级割裂；`shared/` 语义清晰，为后续（如 fbx/mmd 复用感知）铺路。
- **负面**：一次性 6 文件 import 改动 + 新建目录；review 面中等。
- **已知遗留**：`mount-session.ts` 仍保留 `setPerceptionPaused(false)` 防御性清除（P1 已落地，向后兼容），迁移后保持不变。
- **风险/门禁**：`check-path-hygiene`（R5/R6 神桶/裸目录入口）、`check-layering`（R0）须复验；类型/单测行为不受影响（纯路径）。

## 4. 数据溯源

- 来源：`grep -rln "@/preview-3d/perception" frontend/src` → 6 命中。
- 来源：`ls frontend/src/preview-3d/perception/` → 14 文件。
- 来源：`ls frontend/src/preview-3d/adapters/shared` → 不存在（需新建）。
- 结果：影响面可控（6 importer），建议单 PR + 全量 `npm run typecheck` + `vitest run` 复验。
