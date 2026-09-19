# ADR-268：环境面板 cap 自报归属（getEnvPlacement），退役 env.ts 硬编码成员清单

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-19
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/menu/panels/settings.ts collectSettingsCapControls(settingsOrder 先例); frontend/src/preview-3d/menu/panels/env.ts; docs/adr/ADR-125-preview-menu-unified-state-single-renderer.md`

---

## 1. 背景（Context）

环境面板（🌍）在 ADR-268 之前的收口（本仓「单一事实源」小步）已把准入闸
`ENV_IDS` / 下钻序 `ORDERED_IDS` 从卡牌分段表 `ENV_SECTIONS` 派生，消除了两份硬编码清单
互相漂移导致的「只登记进分段表却被 `resolveCaps` 静默滤除」的隐身 cap。但 `ENV_SECTIONS`
本身仍是 `env.ts` 里的一份**集中硬编码清单**（含 `caps:[...]` 成员名）：新增环境 cap 仍要回到
`env.ts` 登记，与 ADR-073「能力注册表驱动、零手工 wiring」的初衷相悖。

对照：设置面板（`settings.ts`）早已是真·插件式——`collectSettingsCapControls()` 遍历
`sceneCapabilityRegistry.getAll()`，cap 想进设置面板只在自己节点上声明 `settingsOrder`，
`settings.ts` 零接线（ADR-125 P2 先例）。环境面板理应对齐同一范式。

## 2. 决策（Decision）

环境面板成员改由 **cap 自报归属**，`env.ts` 退役成员清单：

- `SceneCapability` 新增可选方法 `getEnvPlacement?(): { section: EnvSectionId; order: number }`，
  `EnvSectionId = "basic" | "atmosphere"`。方法落在各 env cap 自身（紧邻既有 `getMasterNodeId`
  同一孪生位置），非环境 cap（light/shadow/postproc/renderMode 等）不实现 → 天然被排除。
- `env.ts` 保留一份**极小的段外壳描述符**（每张卡的 `id` + `labelKey` + 卡间展示序）——这是
  UI 分组语义，归菜单域；但**不再持有 cap 成员名清单**。成员与成员在卡内的序，全部来自
  cap 自报的 `section` / `order`。
- `buildEnvSchema` 改为：`getAll()` → 取每个 cap 的 `getEnvPlacement()` → 按 `section` 归入对应卡、
  按 `order` 排 → 段外壳按描述符序套卡。`ctx.getCap` 兜底路径合成的 cap 由 env.ts 侧局部表补
  placement（生产注册表恒非空，兜底仅防御）。

方向：把「环境面板有哪几个 cap」的知识，从菜单域的一处集中清单，交还给能力自身，
与 `settingsOrder` 同构。ADR 只记此决策方向，实施落点以代码 + 知识卡为准。

## 3. 后果（Consequences）

- 正面：新增环境 cap = 只改该 cap 一个文件，`env.ts` 零改动；彻底兑现 ADR-073 注册表驱动。
- 正面：与设置面板 `settingsOrder` 范式统一，减少「同类面板两套接线方式」的认知负担。
- 负面 / 权衡：成员从「`env.ts` 一屏可见」变成散布 6 个 cap 文件——可发现性下降，由
  `env.test.ts` 守护用例（断言 6 个环境 cap 类 prototype 必声明 `getEnvPlacement`）+ 段外壳
  描述符兜底；`section` 字符串联合类型集中在 `scene-capability.ts`，与 env.ts 描述符共享同一
  `EnvSectionId`，编译期防漂移。
- 已知遗留：段（card）的增删仍改 `env.ts` 描述符（语义外壳，本就属菜单域，不强行下放给 cap）。

## 4. 数据溯源

- 来源：各 env cap `getEnvPlacement()` → `{section, order}`。
- 中间：`env.ts` 段外壳描述符（`section → cardId + labelKey + 卡序`）。
- 结果：环境面板一级 `PreviewMenuNode[]`（预设 select + 按段套壳的 cap 导航行）。

<!-- 文件名: env-cap-self-placement.md → 实际文件 ADR-268-env-cap-self-placement.md -->
