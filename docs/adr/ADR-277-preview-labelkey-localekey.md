# ADR-277：preview 菜单 labelKey 全链钉死为 LocaleKey

- **状态**：✅ 已采纳（Accepted）
- **实施状态**：查知识卡 `docs/knowledge/preview-menu.md`（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-19
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：ADR-193（renderCustom 豁免）、ADR-195（菜单即数据 / 类型叶下沉）、ADR-207 D3（i18n 双入口）、ADR-210 D3（tr 退役）、ADR-276（豁免判据与 subscribe 抽象）
- **关联代码**：`preview-3d/menu/schema/menu-node-types.ts`、`preview-3d/menu/render/cap-controls.ts`、`preview-3d/caps/scene-capability.ts`、`preview-3d/menu/engine/defs.ts`、`preview-3d/caps/*-menu.ts`、`preview-3d/menu/panels/*.ts`

---

## 1. 背景（Context）

`PreviewMenuNode` / `PreviewControlDef` / `CapControlView` / cap 能力描述上的 `labelKey` 字段声明为 `string`，语义是「i18n 键」，但类型上等同于「任意字符串」。由此产生两类事故：

1. **动态文本借 `labelKey` 搭车**（2026-09 表情整列空白）：适配器把运行期数据名（表情名/材质名/纹理短名/`id`）塞进 `labelKey`，靠 `tOf` 缺键时「原样返回裸 key」侥幸显示。同一份 `label` 契约在两套渲染栈被读成两种行为，最终 `tOf("")` 全 miss 导致整列有控件无文字。
2. **写入侧滥用难静态发现**：六处写入点（`core.ts` 入口行 / `material-controls.ts` / `roles-views.ts` / `skeleton-fill-panel.ts` / `pack-model-adapter.ts`）把 id 或动态名写进 `labelKey`，编译期零告警，只留下 `warnMissingKey` 噪音与撞键隐患。

P1（写入侧归一，走 `label` 明文通道 + `resolveLabel` 唯一出口）已清除现存的六处滥用，但**类型仍放行**——任何新代码仍可把 `string` 写进 `labelKey`，滥用会复发。需要一个**编译期、无洞**的守卫。

实测（写侧归一后）：把 `PreviewMenuNode.labelKey` 收窄为 `LocaleKey`，全仓仅 1 处语义报错（env 预设数组 `labelKey` 被推断为 `string`）；但 cap 构建器普遍以松类型 / `as` 强转构造节点，**只钉 node 层会留洞**——`labelKey: cap.labelKey` 一类透传不会报错。故单点收窄不足以形成守卫。

## 2. 决策（Decision）

**preview 菜单的 `labelKey` 全链收窄为 `LocaleKey`（`keyof typeof zhCN`，单一类型源 `@/core/i18n/t.ts`），作为编译期唯一守卫。** 覆盖：

- 节点/控件类型：`PreviewMenuNode.labelKey?`、`PreviewControlDef.labelKey`、`PreviewControlSpec` 的 `options[]` / `thumb.options[]`、`CapControlView.labelKey` 与 `select[]`。
- 能力声明：`SceneCapability.labelKey`、`PreviewMenuGroupDef.labelKey`、`PerceptionCapability.labelKey`、`MultiModelSelectOpts.labelKey`、各 cap 作者向 helper 的 `labelKey` 形参。
- cap 分组常量（`WATER_GROUP_*` / `FOG_PARAMS_GROUP` / `SKY_GROUP_ADVANCED` / `SHADOW_PARAMS_GROUP` / `MAT_GROUP` / `OVERLAY_GROUP` / `REFLECTOR_PARAMS_GROUP` / `ENV_GROUP_*` / `LIGHT_PARAMS_GROUP`）与预设映射表（`ENV_PRESET_LABEL_KEY: Record<string, LocaleKey>`）显式标注 `LocaleKey`。

细则：

- **空值通道保留**：`CapControlView.labelKey` 为 `LocaleKey | ""`——`nodeControlToView` 对无键节点写空串（`node.labelKey ?? ""`），空串经 `resolveLabel` 真值判断短路，**不得送进 `tOf`**（沿袭 ADR-276 / P1 事故判据）。节点侧 `labelKey?` 仍为可选，表示「无 i18n 键」。
- **动态文本仍走 `label`**：`label` 为明文通道，不参与 i18n；`labelKey` 只装真键。以「数据动态」为由写 `labelKey` 即为违规。
- **测试夹具**：`*.test.ts` 内的桩键（`"x"` / `"a"` / `` `cap.${id}` `` 等）以 `as LocaleKey` 显式断言，属测试允许的窄化逃生，不构成生产放行。
- **类型叶约束**：`menu-node-types.ts` 经 `import type` 引入 `LocaleKey`（type-only 不构成运行时耦合，check-layering 豁免），不破坏「零运行时依赖叶子」。
- **不做**「`LocaleKey | (string & {})` 洗白」（ADR-186/207 已退役该路径）——那等于放弃守卫。

## 3. 后果（Consequences）

**正面**

- 生产代码把非键字符串写进 `labelKey` → `tsc` 编译期报错，滥用无法复发（含 cap 层透传，无洞）。
- `labelKey` 语义从「约定」升为「类型」，与 ADR-207 D3「键必须存在于基准包」一致；`LocaleKey` 联合类型让「键名拼错」也在编译期暴露。
- 移除对「`tOf` 缺键回退裸 key」这一侥幸行为的隐式依赖。

**负面 / 代价**

- 收窄波及 cap 层与测试夹具（本次约 30 个生产文件 + 17 个测试文件），测试桩键需逐个 `as LocaleKey`；机械但一次性。
- 测试夹具的类型断言在噪声上略有增加。

**已知遗留**

- 测试夹具用 `as LocaleKey` 绕过检查，理论上测试仍可写入假键——但测试非生产路径，且假键本就是桩语义，可接受。
- ADR-276 §2.3 的 `subscribe` 订阅通道 + 树形 row 抽象仍待触发（第二个程序化面板出现时），与本 ADR 无关。

## 4. 数据溯源

| 来源 | 结论 |
|------|------|
| 2026-09 表情整列空白事故（P1 复盘） | 根因 = 动态名借 `labelKey` + 双栈读法不一；P1 归一写入侧，P2 补类型闸 |
| `LocaleKey = keyof typeof zhCN`（`core/i18n/t.ts:14`） | 类型源单一，键缺失即编译期报错（ADR-207 D3 / i18n.md） |
| 探针实测：node 层收窄 → 全仓仅 1 处语义报错 | 松类型 cap 构建器使 node-only 收窄留洞，须全链 |
| 全链收窄后 `npm run typecheck` = 0 错误、`vite build` 通过、preview-3d 2610 用例全绿 | 收窄无行为回归 |
| `check-layering` R0/R6 对 `import type` 一律豁免 | 类型叶引 `LocaleKey` 不违反分层 |
