# ADR-303：3D 预览持久化偏好规格单一源

- **状态**：✅ 已采纳
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-24
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/infra/settings-schema.ts, frontend/src/preview-3d/infra/keymap.ts, frontend/src/preview-3d/menu/panels/settings.ts, frontend/src/views/app-content/settings/tpl-settings.ts, ADR-036, ADR-085, ADR-125`

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

ADR-036 给 3D 预览引入了「相机速度 / 旋转模式」两个可持久化偏好，键落 `localStorage`（`td-cam-speed` / `td-rot-mode`）。此后同一份偏好长出了**两个写入面**：

- **主设置页**（`views/app-content/settings/`）——`tpl-settings.ts` 手写 `<input type="range" min="2" max="200" value="20">` 与 `<select>` 两个 `<option>`，`keymap.ts` 绑定读写；
- **3D ⚙️ 设置面板**（`preview-3d/menu/panels/settings.ts`）——同两项以 `PreviewMenuNode` 声明（`min: 2, max: 200, step: 1` / orbit·free 选项）。

两面的**键**已收口到 `preview-3d/infra/keymap.ts` 的常量（`TD_CAMSPEED_KEY` / `TD_ROTMODE_KEY`，两侧同引用），但**值域与默认值仍是各写一份的裸字面量**：

| 规格 | 主设置页 | 3D ⚙ 面板 | 存储读取层 |
|------|----------|-----------|------------|
| 相机速度值域 | `min="2" max="200"`（tpl） | `min: 2, max: 200, step: 1`（panels） | `v >= 2 && v <= 200`（infra/keymap） |
| 相机速度默认 | `value="20"` + `DEFAULT_CAM_SPEED="20"` | 无（读回即显） | 回退 `20` |
| 旋转模式枚举 | 两个手写 `<option value="orbit"/"free">` | 两个手写 option 对象 | `!== "free"` |
| 像素比上限 | —（仅 ⚙ 面板） | `min: 0.5, max: 2, step: 0.25` | clamp `[0.5, 2]` + 缺省 `1.5`（render-budget） |

同规格 N 份副本的后果是**静默错位**：改一处值域（如把速度上限提到 300），另两处不动 → 滑块可拖到 300，但读取层 clamp 回退到默认 20，表现为「拖了没反应且无报错」；默认值同理（`value="20"` 与 clamp 回退的 `20` 分居两文件，改一漏一即用户设置被静默重置）。这是 ADR-085「没有单一事实来源」在**持久化规格维度**的同类病症——ADR-085 治的是菜单定义/状态读写/渲染时机，未覆盖「同一偏好的键 + 值域 + 默认」跨面复用。

ADR-125 P1/P2 已把 3D ⚙ 面板的横切项收成纯数据节点、`state/` 层单一路径读写；主设置页与 3D 面板仍是**两个渲染面**（HTML 模板 vs `PreviewMenuNode`），这是既成事实、本 ADR 不合并。要收口的只是被两个面共同消费的**规格数据**。

## 2. 决策（Decision）

**新增纯数据叶 `frontend/src/preview-3d/infra/settings-schema.ts`，作为「3D 持久化偏好的键 + 值域 + 步进 + 默认 + 枚举」的唯一声明处；所有读写/渲染面只消费它，不再写裸字面量。**

- Schema 是 **零依赖纯数据模块**（不 import three / DOM / 上层），任何面都可安全引用：`views`（主设置页）、`preview-3d/menu`（⚙ 面板）、`preview-3d/infra`（存储读写）。
- 键常量**归 schema 所有**（`TD_CAM_SPEED.key` 等），`infra/keymap.ts` 改为从 schema 取值并保留原导出名 —— 既有消费者（`infra`、`menu/panels`、`views`）不必改 import 路径即完成收口。
- 数值规格形状统一为 `{ key, min, max, step, default }`；枚举规格为 `{ key, values, default }`。**默认值恒在被 clamp 的值域内**（由测试断言，不是靠注释约定）。
- 消费面的分工不变：**主设置页渲染 HTML 控件、⚙ 面板渲染 MenuNode、`infra` 负责读写与回退**——schema 只供数据，不产出 UI，不引入第三套渲染器（守 ADR-259 的「结构单点产出」精神，但不越界到标记层）。

**明确不做的事**（避免过度设计）：

1. **不做「主设置页 → MenuNode」的投影**。两个渲染面各司其职已稳定；为统一而生造投影层会把 HTML 控件的表达力（`option` 文案、`<datalist>`、布局）塞进 schema，成本远大于收益。
2. **不把自适应降采样下限 `MIN_PIXEL_RATIO`（`render-budget.ts`）并入 schema**。它是运行时自动降级的地板，与「用户可设上限」语义不同，合并会让两个独立旋钮互相误导。
3. **不迁 `td-keymap` 的默认键位表**。`DEFAULT_TD_KEYMAP` 是键位语义数据（`KeyboardEvent.code` 六向映射），不是「值域/默认」规格，留在 `infra/keymap.ts`。

## 3. 后果（Consequences）

**正面**：

- 改值域/默认只需动 schema 一处，两面 + 读取层自动同源；「拖了没反应」类静默错位从机制上消失。
- 两面规格一致性可被单测断言（同一 spec 的 min/max/default 被面 A 与面 B 读取），不再依赖人工核对。
- 后续新增持久化偏好（如灵敏度、惯量）有了既定落位，不必再决定「键写哪、默认写哪」。

**负面 / 代价**：

- 多一层间接：读代码时「20」这个值的定义点从消费处移到 schema（可接受，值域集中本就是目的）。
- `views` 层新增一条 `@/preview-3d/infra/settings-schema.ts` 依赖（views → preview-3d/infra 已有先例：同目录 `keymap.ts` 早已引用 `preview-3d` 的键常量与读取函数）。

**已知遗留**：

- 主设置页的**字体三栏**等其他裸样式债务不属本 ADR 范围（归设置页样式范式契约）。
- 两面**不实时同步**（主设置页写入后，已挂载的 3D 会话仍用旧值到下次会话）——这是既成的会话级读取语义，本 ADR 不改变；如需要，另立 ADR 讨论运行时热更新。

## 4. 数据溯源

- 双源病灶：`views/app-content/settings/tpl-settings.ts`（`min="2" max="200" value="20"` + 手写 option）、`preview-3d/menu/panels/settings.ts`（`min: 2, max: 200, step: 1` + option 对象）、`preview-3d/infra/keymap.ts`（clamp `2..200`、回退 `20`）、`preview-3d/infra/render-budget.ts`（clamp `[0.5, 2]`、缺省 `1.5`、`MAX_PIXEL_RATIO_KEY`）。
- 键常量已收口（本 ADR 的前置半步）：`preview-3d/infra/keymap.ts` 导出 `TD_CAMSPEED_KEY` / `TD_ROTMODE_KEY` / `TD_KEYMAP_KEY`，由 `menu/panels/settings.ts` 与 `views/.../keymap.ts` 同引用。
- 决策依据：ADR-036（这两项偏好的引入）、ADR-085（无单一事实来源的病理范式）、ADR-125（⚙ 面板纯数据化 + `state/` 单一路径）。

<!-- 文件名: preview-persist-spec-single-source.md → 实际文件 ADR-303-preview-persist-spec-single-source.md -->
