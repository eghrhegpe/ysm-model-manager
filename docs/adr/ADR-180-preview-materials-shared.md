# ADR-180：preview-3d 材质工具层通用化收编（mmd/vrm materials 骨架合并）

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-05
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/mmd-materials.ts`、`frontend/src/preview-3d/vrm-materials.ts`

---

## 1. 背景（Context）

`mmd-materials.ts`（94 行）与 `vrm-materials.ts`（88 行）是 3D 预览两大格式（MMD/PMX 与 VRM）的材质工具层，提供同一组能力：材质列表 / 显隐（`Material.visible`）/ 透明（`opacity` + `transparent` 联动）/ 详情。两者注释互相指认「对齐 mmd-materials.ts 适配层模式」，是显式的复制关系。

jscpd 实测重复：`setMmdMaterialVisible` 与 `setVrmMaterialVisible` **逐字一致**（仅函数名前缀不同）；`setMmdMaterialOpacity` 除 VRM 侧多一行 `needsUpdate = true`（MToon 着色器重编译）外逐字一致；`list/getDetail` 同构（列表 map 骨架、detail 字段提取骨架相同）。

原 `mmd-materials.ts:7` 注释声明「材质各格式结构差异大，不做通用层」——该 YAGNI 决策被代码重复率证伪：**共性骨架 ~70%，领域差异（MMD 的 pmx 索引配对 + specular/shininess、VRM 的 type 推断 + needsUpdate）~30%**，共享收益 > 抽象成本。

## 2. 决策（Decision）

抽共享材质工具层（落点：`preview-3d/materials/materials-shared.ts` 或并入既有适配层共享模块），骨架函数通用化，领域差异走参数化：

- **共享骨架**（逐字重复部分）：`setMaterialVisible` / `setMaterialOpacity`（clamp + transparent 联动 + 可选 needsUpdate 回调）
- **参数化差异**：MMD 侧经 pmx 索引配对 + specular/shininess 提取；VRM 侧经 type 推断 + needsUpdate——差异以回调/选项参数注入共享函数，不复制骨架
- **保留格式专属薄壳**：`mmd-materials.ts` / `vrm-materials.ts` 保留原导出名（`listMmdMaterials` 等），内部转发共享实现——消费方（`mmd-build-menu.ts`、`vrm-adapter.ts`）零改动
- 撤销「不做通用层」YAGNI 注释，改注「骨架收编 materials-shared，格式差异参数化」

## 3. 后果（Consequences）

**正面**：
- 消除 jscpd 跨文件重复对（`mmd-materials#vrm-materials`）
- setVisible/setOpacity 单一实现，未来第三格式（如 YSM 材质）直接复用共享层
- 行为零变化（纯重构，测试锁定现状语义）

**负面**：
- 新增一层抽象（参数化回调需读共享层注释理解差异注入点）
- 8 个消费/测试文件 import 适配（重命名指向共享实现或薄壳）

**已知遗留**：
- 3D 适配器族（vrm/ysm/fbx/litematic adapter 同构 build 管线）与 caps/ 簇残余重复**不在本 ADR 范围**——capability 簇基座（scene-capability.ts）已在收敛（restoreFields/createListenerSet），adapter build 管线合并需另立 ADR 评估

## 4. 数据溯源

来源（2026-09-05 勘察）→ 结果：
- `scripts/baseline/deadcode-baseline.json` jscpd 段（`mmd-materials.ts#vrm-materials.ts` 重复对）→ 确认真实跨文件重复
- 逐行对比两实现 → setVisible/setOpacity 逐字一致、list/getDetail 同构，共性 ~70%
- grep 消费点 → 生产侧 mmd-build-menu.ts + vrm-adapter.ts，测试侧 4 文件，共 8 文件影响面
- scene-capability.ts 基座（restoreFields/createListenerSet 收敛先例）→ 证明「cap 样板收编基座」是本仓既有成功模式，materials 同法可循

<!-- 文件名: preview-materials-shared.md → 实际文件 ADR-180-preview-materials-shared.md -->
