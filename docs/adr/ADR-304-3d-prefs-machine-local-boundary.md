# ADR-304：3D 预览设置持久化边界：机器本地 localStorage，不入 Go config 重置/迁移范围

- **状态**：✅ 已采纳（Adopted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-24
- **决策人**：Jieling（人类首席架构师）、AI 代理（用户「继续」批复设置页菜单收口 P3 处方时采纳）
- **相关**：`frontend/src/preview-3d/infra/settings-schema.ts, frontend/src/preview-3d/state/preview-state.ts, frontend/src/preview-3d/state/perf-presets.ts, frontend/src/views/app-content/settings/`

---

## 1. 背景（Context）

设置域实际并存**两条持久化轨道**，此前无明文边界（2026-09 设置页菜单锐评 P3 处方立项）：

| 轨道 | 载体 | 现状持有者 | 语义 |
|---|---|---|---|
| Go config（`LoadAppConfig`/`SaveAppConfig` → `ysm_config.json`） | 内容级 | 下载镜像源、链接模式、更新检查间隔、存储路径等 | 可跨机/可重置/可迁移的「应用级设置」 |
| localStorage（一律 `safeGet`/`safeSet`，ADR-044 隐私模式静默降级） | 机器本地 | 语言 `uiLang`、主题、UI 偏好（字号/字体/密度/动画/启动默认页 `ui-*`）、**3D 域全部偏好**：相机速度/旋转模式/键位 `td-*`、帧率/分辨率/性能档位/视锥裁剪 `ysm_3d_*`、cap 场景态 `ysm-scene-cap-*`/env state | 「这台机器/这位用户在此设备上的调校」 |

病灶：设置菜单（主设置页 + 3D ⚙ 面板）向用户呈现「统一设置入口」，但地面是两层——
3D 偏好对 Go config 系统的「重置/同步/迁移」语义**完全不可见**。无边界明文时，后续
维护者既可能误把 3D 偏好上浮 Go config（白付 AppConfig 字段 + 绑定 + 重置链的成本），
也可能在 Go config 的「恢复默认」类入口里漏掉/误吞 3D 偏好。值域规格已有单一事实源
（`settings-schema.ts`，ADR-303：相机速度/旋转模式/分辨率上限的键 + 值域 + 默认值，
主设置页与 3D ⚙ 面板两面共用）——但**持久化轨道归属**从未立法。

## 2. 决策（Decision）

**3D 预览设置 = 机器本地偏好，持久化一律走 localStorage（`safeGet`/`safeSet`），
明确不迁入 Go config，不进入 Go config 的重置/同步/迁移范围。** 判据按语义三问：

1. **设备相关吗？** 帧率/分辨率上限/性能档位/键位/相机速度都与具体硬件与肌肉记忆绑定
   ——跨机同步不仅无益（源机 120fps 档在弱机上就是掉帧），还制造漂移。
2. **会话语义对吗？** cap 场景态（天空/灯光/阴影/后处理开关）本就是「场景会话」语义，
   localStorage 的「本机 + 跨会话恢复」恰好即目标语义，而非缺陷。
3. **成本收益？** 上浮 Go config = AppConfig 新字段 + 绑定 + `SaveAppConfig` 写链 +
   重置/迁移语义扩张，收益为零（无人需要把「这台机器该跑 30fps」拷到另一台机器）。

**轨道归属口诀（新增设置项时先过此门）**：

> 跟**这台设备**的性能/显示/输入习惯绑定 → localStorage（`td-*`/`ysm_3d_*`/cap 私有键）；
> 跟**这份内容/这个仓库**的获取与行为绑定 → Go config。3D 域新增偏好一律前者的键空间，
> 规格（键名/值域/默认值）登记进 `settings-schema.ts` 后两面共用，**持久化轨道与规格
> 共用是正交的两件事**——规格同源（ADR-303）不代表轨道同源。

**界面契约**：任何宣称「恢复全部默认/一键重置」的入口，文案必须明示 3D 偏好（及
UI 偏好）不在其范围；当前无此类全局重置入口，风险不存在，但入口一旦诞生即受本条约束。

## 3. 后果（Consequences）

正面：
- 3D 偏好「对 Go 配置系统不可见」从**默然事实**升格为**明文契约**——后续评审「要不要
  把 X 上浮 Go config」时，三问先于代码；
- 隐私模式（ADR-044）语义自洽：3D 偏好隐私模式下静默降级为「纯会话」，与机器本地
  定位一致，无需额外处理；
- 性能档位切档 / 相机参数改写的热路径继续走 localStorage 直写（`safeSet` 同步落盘、
  无 Go RPC 往返），不引入跨桥延迟。

负面 / 代价：
- 双轨事实本身保留（Go config 与 localStorage 各持一半设置域）——本 ADR 是**画线**不是
  **并轨**；两轨的「统一设置门面」仍需 UI 层自觉（见 `settings-schema.ts` 头注的两面
  共享规格机制）；
- 若未来出现「跨机配置同步」需求（如移动端云同步），本边界需重新评审——届时 3D 偏好
  的同步默认语义应是「不同步」而非「跟随」。

已知遗留（不属本决策范围）：
- 「恢复默认」类入口（3D 偏好 `td-*` 键目前只在设置页各节内单独可重置，如键位
  「恢复默认」按钮）没有统一收口；本 ADR 只立法不建入口；
- UI 偏好（`ui-*`）同样机器本地但本 ADR 以 3D 域为立法对象——UI 偏好的轨道归属按
  同一口诀执行，无需单独立法。

## 4. 数据溯源

| 来源 | 结论 |
|---|---|
| `views/app-content/settings/keymap.ts`（`td-cam-speed`/`td-rot-mode`/`td-keymap` 全走 `safeSet`）+ `preview-3d/infra/settings-schema.ts`（ADR-303 规格单源，头注自述「存储读取层」） | 3D 偏好现轨 = localStorage，非 Go config |
| `preview-3d/state/preview-state.ts`（`ysm_3d_frustumCull` 等横切路径落盘）+ `perf-presets.ts`（`ysm_3d_perfPreset`）+ `caps/`（cap `saveState`/`loadState` 走 localStorage） | 3D 域全部键均属 localStorage 轨道 |
| `views/app-content/settings/init.ts`（`LoadAppConfig`/`SaveAppConfig` 解构）+ `features/maintenance/version-updater.ts`（`updateCheckIntervalMs` 经 Go config） | Go config 现持内容 = 下载/链接/更新/路径类内容级设置 |
| `ui-prefs.ts`/`locale.ts`/`theme-core.ts`（`ui-*`/`uiLang`/主题键全走 `safeGet`/`safeSet`） | 「机器本地」轨道不止 3D 域——UI/语言/主题同轨，本 ADR 口诀按语义适用 |

<!-- 文件名: 3d-prefs-machine-local-boundary.md → 实际文件 ADR-304-3d-prefs-machine-local-boundary.md -->
