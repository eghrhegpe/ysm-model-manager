# ADR-293-d1：灯光首启默认分治：辅助线框关、浏览最小光照、环境光降档

- **状态**：✅ 已采纳（Implemented）
- **日期**：2026-10-04
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **关联主 ADR**：ADR-293（部分取代其 D2 的默认值取法）；相关：ADR-282（灯光与模型类别解耦）、ADR-084（个人灯光系统）、`frontend/src/preview-3d/state/env-state-schema.ts`（默认值唯一事实源）、`caps/light-controls.ts`、`caps/light-persist.ts`

---

## 背景（一句）

ADR-293 D2 给 helper 补开关时把默认值取成 `true`，理由是「保持现状观感」——把 schema default 当成**历史观感的快照**；叠加灯光组其余默认仍是 ADR-084 时代的「全开影棚」（三灯全开 + ambient 0.5 + sky IBL + 阴影默认开），首启预览是六路光照 + 三副调试线框（橙/蓝/粉）糊在模型上：**服务的是调参者，却让所有浏览者第一眼看到满配摄影棚**。

## 决策（三行）

1. **`lightHelperVisible` 默认 `true` → `false`**：三副彩线是 three.js 调参 gizmo，i18n hint 自陈「仅编辑辅助，不随截图输出」——不该默认出现在首屏；开关的存在本身已给足撤销权，与默认值无关。
2. **三灯默认分治**：`lightKeyEnabled` 保持 `true`，`lightFillEnabled` / `lightRimEnabled` 由 `true` → **`false`**——首启 = IBL + 主灯的「浏览最小光照」；三点布光是创作者用具，要时逐盏开（**浏览者与创作者的默认本就不该一样**，这是 ADR-282「灯光是场景属性」论证的延伸）。
3. **`lightAmbientIntensity` 默认 `0.5` → `0.15`**：环境光是「别全黑」的底光而非主光；0.5 白环境光把三灯的方向性整个填平（暗部消失、阴影白开），且 sky 环境开时还要 ×0.5 让位。0.15 是「有 IBL 兜底只补底、无 IBL 也不压死」的一档。

## 后果（一句）

**老用户走祖父条款**：`mount-session.ts` 的 `saveAll()` 在每次会话收尾无条件落盘，故存量存档恒携带 `helperVisible:true` / `fill.enabled:true` / `rim.enabled:true` / `ambient.intensity:0.5`——新默认只对「无存档首启」生效（本轮范围即此），老用户回到新规范态的出口是**「重置全部灯光」**（锚点 = `DEFAULT_LIGHT_PARAMS`，已同步派生新默认）或手动关；回退 = 三个 schema default 改回原值，无迁移、无数据副作用。
>
> **[2026-10-04 锐评收口补记]** 上面这个「出口」原先只对 fill/rim/ambient 三维成立：`DEFAULT_LIGHT_PARAMS` 由 `FLATTEN_MAP` 派生，**结构上不含 `lightHelperVisible`**（线框不在参数面），故老档点重置后线框仍照画——同一份 ADR 里「出口 = 重置」与「锚点 = DEFAULT_LIGHT_PARAMS」自相矛盾。现出口改为 `caps/light-presets.ts|lightResetPatch`（参数面 + `lightHelperVisible`），承诺与实现对齐；`lightEnabled`（会话总闸）刻意仍在重置作用域外——重置参数不替用户开灯。

<!-- 文件名: light-first-run-defaults.md → 实际文件 decisions/ADR-293-d1-light-first-run-defaults.md（ADR-320 decisions 轻量模板） -->
