# ADR-287：water 菜单 ground- 化石前缀重命名

- **状态**：✅ 已采纳（2026-09-20，已实施）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-20
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：待补（`docs/adr/` / 关联代码路径）

---

## 1. 背景（Context）

water 菜单（`water-menu.ts`）遗留大量 `ground` 前缀化石——water 曾是 ground cap 的附属功能
（ADR-196 迁移前的旧格局），独立成 cap 后标识符没跟着改：

- **i18n labelKey**：`preview.groundWaterEnabled` / `groundWaterMode(+Film/Pool)` / `groundWaterColor` /
  `groundWaterOpacity` / `groundWaterLevel` / `groundWaterSize` / `groundWaterClarity` /
  `groundWaterChoppiness` / `groundPoolHeight` / `groundPoolWallThickness` / `groundPoolWallColor` /
  `groundPoolRoundness` / `groundWaveSpeed` / `groundNormalStrength`（三语 locale 各一份）。
  分组键 `preview.waterGroupForm/Look/Pool/Wave` 与 `preview.waterFilmDensity` 已是规范形态——
  即同一文件内新旧两套并存。
- **菜单节点 id**：`ground-water-enabled` / `ground-water-*` / `ground-pool-*` /
  `ground-wetness` / `ground-normal-strength` / `ground-wave-speed`（`cap-group-water-*` 已规范）。

**关键事实核查（降低风险预估）**：
- envState 持久化键**全部是 `water*`**（`env-state-schema.ts:218-296`），无一化石——
  **存档零迁移**，「连存档双轨迁移」的担忧不成立。
- 菜单节点 id 的唯一状态消费者是 `folderCollapsedState`（`menu/render/render.ts:222`）——
  **内存 Map，dispose 即 `clearFolderCollapsedState`，不落盘**，id 改名无跨会话影响。
- labelKey 无任何持久化消费（仅渲染期 `t(labelKey)` 查表）。

## 2. 决策（Decision）

纯改名收敛，单提交完成（不设双轨兼容层——不存在需要兼容的持久化状态）：

| 旧 | 新 |
|---|---|
| `preview.groundWater*` | `preview.water*` |
| `preview.groundPool*` | `preview.waterPool*` |
| `preview.groundWaveSpeed` | `preview.waterWaveSpeed` |
| `preview.groundNormalStrength` | `preview.waterNormalStrength` |
| 节点 id `ground-water-*` / `ground-pool-*` | `water-*` / `water-pool-*` |
| 节点 id `ground-wetness` / `ground-normal-strength` / `ground-wave-speed` | `water-wetness` / `water-normal-strength` / `water-wave-speed` |

改动面（实施前 `git grep` 复核为 5 处消费文件 + 3 个 locale）：
- `frontend/src/preview-3d/caps/water-menu.ts`（labelKey + id 全部）
- `frontend/src/locales/{en,ja,zh-CN}.ts`（键改名，文案不动）
- 测试同步：`water-capability.test.ts`、`menu/panels/env.test.ts`（按 id / labelKey 寻址的断言）

实施方式：`LocaleKey` 类型派生自 locale 键域（`@/core/i18n/t.ts`），locale 先改名 →
`water-menu.ts` 引用旧键处**编译期即红**，逐个改到绿——类型系统即迁移清单，防漏改。

## 3. 后果（Consequences）

**正面**
- water 域命名统一为 `water*`，化石清零；i18n 键可按前缀 grep / 派生工具处理。
- `LocaleKey` 编译期拦截，改名不可能半途而废。

**负面**
- 三语 locale diff 较大（~14 键 × 3 文件）但为纯键名移动；与并行的 locale 生成物提交可能冲突，需一次收口。
- 若外部（如存档里的 UI 布局、截图标注等）未来引用这些 id，会断——当前核查为零消费，风险仅在「未来引入持久化时需记得 id 是内部标识」。

**已知遗留**
- `ground-menu.ts` / `ground-surface-spec.ts` 等地面自身的 `ground*` 命名**不在本 ADR 范围**（它们名实相符，非化石）。

## 4. 数据溯源

- 化石定位：`water-menu.ts`（grep `preview.ground` / `"ground-`）；locale 三语对照确认键集。
- 存档核查：`env-state-schema.ts:218-296` water 组键全部 `water*`；`render.ts:222` 折叠态为内存 Map。
- 类型入口：`@/core/i18n/t.ts` `LocaleKey`。
