# ADR-085：3D 预览菜单单一事实来源：注册表驱动 + 状态单向流

- **状态**：✅ 已采纳
- **日期**：2026-08-16
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/utils/3d/adapters/preview-menu.ts, preview-menu-defs.ts, mount-preview-core.ts, *-adapter.ts, caps/*, ADR-076, ADR-077, ADR-081`

---

## 1. 背景（Context）

并发子代理审计（2026-08-16）发现 3D 预览菜单体系「今天反复修」的根源是**没有单一事实来源**：菜单项定义、状态读写、渲染时机三处各自为政，改动一处另一处不同步。

### 1.1 菜单项定义分散 5 处（无单一事实来源）

| 来源 | 位置 | 内容 |
|------|------|------|
| 静态 core 表 | `preview-menu-defs.ts:48-99` | `PREVIEW_MENU_GROUPS` + `CORE_MENU_ITEMS`（switch/environment/camera/lighting） |
| 适配器动态注册 | `ysm/vrm/mmd-adapter.ts` 各 `menuItems()` | model/shot/material/bones 等，经 `setAdapterItems` **整体替换**注入 |
| core 行为映射 | `preview-menu.ts:108-116` | `fillers`/`runners`（表只描述结构，行为在这第二份定义） |
| 能力过滤 | `preview-menu.ts:166-171` | sharedOnly/selfMode、needsSiblings、requiresEnviron |
| 遗留 topBar | litematic `extraControls` | 唯一常驻顶栏控件（分层控制器） |

### 1.2 状态双源（cap 内部 vs 菜单显示值）

- 地面/IBL toggle **硬编码 `value: true`**（`preview-menu.ts:235/:309`），不读 `groundCap.getVisible()`/`skyCap.isEnvironmentEnabled()`——关过地面后重开面板 UI 显示"开"实际隐藏
- 云量滑块**硬编码 `"0%"`**（`:281`），`SkyCapability` 不暴露 cloudCoverage
- 灯光预设 select 用**启发式派生**（`spotlight.enabled ? "resourcepack" : "default"`），与 mount 时 `setPreset(adapter.id)` 写入的真实 preset 无对应
- `lightCap.getParams()` 返回深拷贝快照，`volToggle` 读 open 时快照而非 live 值
- 相机持久化：`buildCameraControls` 写 `td-rot-mode`/`td-cam-speed` 到 localStorage，但预览路径**从不读回**（`loadTdCamSpeed` 只在设置页用）→ 预览与设置页隐性双源

### 1.3 渲染时机竞态（litematic/pack 的 environment 菜单项永不出现）

`renderDock()` 只在两处调用：菜单挂载时 + `setAdapterItems` 内。而 `mount3D` 中**菜单先于 caps 创建**（menu 挂载 :308-324，caps :362-370），挂载时 `getSkyCap() → null`，`environment`（requiresEnvironment）被过滤。ysm/vrm/mmd 靠 build 内调 `setAdapterItems` 触发重渲染补上；**litematic/pack 从不调** → environment 项永远不可达。测试用 `mountWith` 恒调 `setAdapterItems`，掩盖了该时序问题。

### 1.4 其他不对称

- **mmd bones 无 `dockGroup`**（`:478` 附近），而 ysm/vrm bones 都有 → mmd 骨骼面板在 dock 不可达（测试 `preview-menu-items.test.ts:254` 明确断言 null）
- `setAdapterItems` **无运行期 id 冲突守卫**——未来某 adapter 注册 core 的 id 会渲染重复行（仅测试静态断言）

## 2. 决策（Decision）

**菜单体系收敛为「注册表驱动 + 状态单向流」**，与 ADR-066/067/082 同一治理语言（新增项只改注册表，不散改代码）：

### S1 — 定义收敛为单一事实来源

- `CORE_MENU_ITEMS` + 各 adapter `menuItems()` 统一为**一份菜单注册表**（`preview-menu-defs.ts` 派生 core，adapter 声明合并），行为仍走 `fillers`/`runners` 映射（表只描述结构，行为集中定义）
- `setAdapterItems` 加**运行期 id 冲突守卫**：检测与 CORE_MENU_ITEMS 及当前 adapterItems 的 id 重复 → 报错而非静默双行
- **mmd bones 补 `dockGroup:"model"`**（与 ysm/vrm 对齐），消除不可达项

### S2 — 状态单向流（cap 是唯一状态源）

- **cap 提供统一只读 getter，菜单初始化一律惰性读**：`SkyCapability` 增加 `getCloudCoverage()`；地面/IBL/云量控件用 `ctx.getXxxCap()?.getXxx()` 初始化，**删除硬编码 `value:true`/`"0%"`**
- **菜单打开期间 cap 变化回写 UI**：经菜单 refresh 重建式渲染承担（每次重渲染重建 toggle、初始 value 即最新态）；初版「toggle 全部传 `bind` + control-registry 自更新」链路已随 2026-09 control-registry 拔除（生产无人触发 update、零接入，属死链路）
- **消灭启发式派生**：灯光预设 select 改 `lightCap.getPresetName()` 只读 + `setPreset` 写入单一来源；`volToggle` 回调内读 live `getParams()`
- **相机持久化闭环**：mount3D 初始化读 `loadTdCamSpeed()/loadTdRotMode()`（keymap.ts 已有），预览与设置页共用同一持久层

### S3 — 渲染时机以能力创建为触发点

- caps 创建后调用一次 `menuHandle.setAdapterItems(currentItems)` 或暴露 `refreshDock()`，修复 litematic/pack 的 environment 项时序缺失
- 补「不调 setAdapterItems 也刷新」的测试用例（现 `mountWith` 恒调掩盖了时序）

## 3. 后果（Consequences）

**正面**：
- 菜单定义、状态、渲染三处统一，改动一处不再漂移（与 ADR-076/077 的收敛方向一致，从「壳收敛」深化为「定义收敛」）
- 新增菜单项 = 注册表加一行 + 行为映射加一行，零散改
- 状态单向流杜绝「面板开着状态不同步」「重开面板值不对」两类反复修的 bug

**负面 / 风险**：
- 🔴 迁移工作量：S2 涉及 preview-menu.ts 全部 toggle/滑块的取值改造 + caps getter 补齐，需跑预览菜单全套测试（`preview-menu-items.test.ts` 等）
- 🟡 `setAdapterItems` 冲突守卫可能误伤现有合法注册（core∩adapter 目前无交集，风险低）
- 🟢 云量 getter 需 SkyCapability 新增内部字段透出，属能力层小改

**已知遗留**：
- litematic `extraControls` 顶栏常驻分层控件（注释明确唯一例外），本 ADR 不强制收编（属 vrm/litematic extraControls 收编的 ADR-076 Phase 3 范围）
- 「设置聚合视图」（无 dockGroup 项的统一视图）尚未实现——mmd bones 补 dockGroup 后暂不需要，留作未来扩展

## 4. 数据溯源

来源：用户反馈「今天提交潮反复修菜单不同步」→ 派 3 个并发 explore 子代理审计（3D 预览根菜单 / 全局导航 / 适配器能力联动）→ 定位四类根源（定义分散 5 处、状态双源、渲染时序竞态、mmd bones 不可达），抽查实锤 `preview-menu.ts:235/:309` 硬编码 `value:true`、`:281` 硬编码 `"0%"`、mmd-adapter bones 无 dockGroup、`renderDock` 仅两处触发 → 方案：S1 注册表驱动 + S2 状态单向流 + S3 时序触发点 → ADR-085 立项。

<!-- 文件名: menu-single-source.md → 实际文件 ADR-085-menu-single-source.md -->
