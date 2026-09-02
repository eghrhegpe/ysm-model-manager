# ADR-159：sceneRegistry 容器语义：displayName + components（资源包=实体、包内模型=组件）

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-02
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/adapters/scene-registry.ts`、`frontend/src/preview-3d/menu/roles.ts`、`frontend/src/views/app-preview/pack-3d.ts`、`frontend/src/preview-3d/menu/stats.ts`、ADR-093、ADR-131、ADR-132

---

## 1. 背景（Context）

资源包 3D 预览长期以「单个模型」为视角：`sceneRegistry` 只注册 zip 内首个模型
（角色面板显示 `blunderbuss`），其余 14 个模型埋在「切换角色 ›」二级钻取里。
根因是**注册表的计量单位 = 单个文件路径**，没有「容器（zip）→ 组件（包内模型）」概念：

- YSM zip 有 `ysm.json` 作模型入口 → 1 zip = 1 entry 且 entry 即模型，单位自洽，
  享受历次大统一（ADR-093 菜单 Schema / ADR-101 逻辑收敛 / ADR-131 统计面板）。
- 资源包 zip 无 `ysm.json` → 落入最低保障层（pack 适配器，ADR-080 薄包装立项），
  从未纳入「格式适配器」为单位的大统一覆盖。
- ADR-131/132 时代为救急打过单点补丁 `packModelsByType`（把包内 15 模型塞进
  resourcepack 类型 tab 的候选源），数据模型没变，语义混淆（包内模型与仓库其他 zip 同列）。

## 2. 决策（Decision）

给 `sceneRegistry` 引入**容器语义**，通用字段而非资源包特化：

1. `ModelEntry` / `RegisterInput` 增两个可选字段：
   - `displayName?: string`——实体展示名（资源包 = zip 名，剥扩展名）。
     `roleBaseName` 优先取 `displayName`，角色面板/详情标题显示包名。
   - `components?: string[]`——同容器内全部组件路径（包内 15 个模型 entry）。
     角色面板在已加载角色列表下方**平铺**组件区（点名 = switchTo 切换、➕ = keepInScene 追加）。
2. `Mount3DOptions` 增同名透传字段；`mount3D` 首注册与会话内 `switchTo`
   （`switch-preview.ts registerSwitchScene`）均携带（switchTo 经前一活跃 entry 继承容器元数据）。
3. 统计面板扩展：`dockGroup` 联合类型增 `"stats"`——适配器可贡献统计附加行
   （`kind:"field"` + `dockGroup:"stats"`），`mergeStatsMenuItems` 把它们并入统计面板
   children。资源包适配器据此暴露 `elementCount`（立方体 Cubes 数），vanilla 资源包
   无「声明/加载纹理尺寸」概念，详情以「立方体数 + 渲染实测统计」为准。
4. **退役 `packModelsByType` 补丁**：resourcepack 类型 tab 回归 base 扫描
   （仓库根其他 .zip），包内切换由组件区承担，候选源语义还原。
5. 定位为**通用容器协议**而非资源包特化：未来 YSM/MMD 一 zip 多模型、
   或「统计 zip 内 pmx/蓝图数量」等容器类需求零新增机制直接继承。

## 3. 后果（Consequences）

**正面**
- 资源包预览升级为「包 = 实体 + 15 模型 = 永久组件」，与 YSM 模型/组件范式对齐。
- 候选源 hack 退役，类型 tab 语义还原（跨包切换 / 包内切换职责分离）。
- 统计面板获得可扩展的附加行通道，所有适配器受益。

**负面 / 已知遗留**
- `components` 是路径快照（build 时注入），zip 内容变更后需重开会话刷新——可接受
  （3D 会话本就是瞬时视图）。
- `resolveTypeSafe` 对包内 entry 路径返回 null → 组件区不走类型 tab 判定，
  直接 `switchTo`（同容器同适配器，语义正确）。

## 4. 数据溯源

- 源码实证：`scene-registry.ts:49-57`（register 按 path 去重、无容器概念）、
  `pack-3d.ts:70-80`（packModelsByType 补丁）、`roles.ts:283-311`（fillRoles 无组件区）、
  `parse-java-model.ts:309`（elementCount 已存在）。
- 用户质询：zip 统一分支功能掉队、无 ysm.json 即回归，理论前端与实际前端偏离。
