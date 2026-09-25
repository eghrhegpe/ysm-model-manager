# ADR-313：应用配置写唯一实参点：SaveAppConfig 六位置实参统一上移 views/config-write.ts

- **状态**：✅ 已采纳（Adopted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-25
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：[ADR-307](ADR-307-settings-page-p2-hardening.md)（设置域收口，本 ADR 是其遗留项闭环）、[ADR-190](ADR-190-features-deps-convergence.md)（features 层与 `*-deps.ts` seam）、[ADR-208](ADR-208-features-governance.md)（R5 白名单口径）、[ADR-146](ADR-146-path-alias-anti-barrel.md)（import 路径）、[ADR-312](ADR-312-dead-css-reverse-gate.md)（同批次治理：反向闸思路）

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

`SaveAppConfig` 是 Go 端 `internal/app/app_config.go:148` 的绑定：

```go
func (a *App) SaveAppConfig(filesRoot, rpRoot, mcRoot, linkMode, theme, themeAuto string) error
```

**六个参数全是同型 `string`**，位置错了类型系统看不见 —— 传成 `(a, b, c, d, e, f)` 与 `(a, b, c, d, f, e)` 编译同样通过。前端每手抄一份调用，就多一份「参数错位 / 字面量漂移」的风险面。

历史病例（设置页第八轮 ADR-307 D3 记录）：

- **P1**：调用方先 `LoadAppConfig()` 拿快照，再拿快照回写未改字段 → 用户在别处改过的字段被静默覆盖回旧值。
- **P3**：闭包捕获旧 `linkMode`，二次保存把它覆盖回去。
- **P4**：`themeAuto` 漏落盘。

第八轮把**设置页**收敛到 `views/app-content/settings/path-cards.ts|saveCfg` 单点，但 `views` 层仍留三处实参点：

| 位置 | 形态 |
|---|---|
| `views/app-content/settings/path-cards.ts`（`saveCfg`） | 唯一「正规军」：patch 语义 + 重读最新值 |
| `views/app-sidebar/launcher-detect.ts:57`（`saveMcRoot`） | 手抄六位置实参 |
| `views/app-sidebar/events.ts:295`（空态自动检测分支） | 手抄六位置实参 |

**两处 sidebar 侧还各自硬编码了 `"dark"` 主题字面量**。而 `frontend/src/theme-core.ts:30` 的

```ts
export const THEME_VALID = ["cyber","warm","pro","sakura","ocean","mint","system"] as const;
```

**根本没有 `"dark"`** —— 合法缺省是 `THEME_DARK = "cyber"`。落盘 `theme: "dark"` 后，`initTheme` 走 `normalizeTheme` 会把它静默归一成 `"system"`：**用户只点了一次「搜索游戏目录」，主题却被改成「跟随系统」**。`theme-core.ts:11-12` 的注释恰好记着「settings 侧曾有 3 处 `|| "dark"` 字面量，已统一为 `THEME_DARK`」—— sidebar 这两处正是那类 bug 的**未修净残余**。

为何当时没顺手修：`saveCfg` 住在 `views/app-content/settings/` 下，从 `app-sidebar` import 它会把**整个 settings 页面模块拖进 sidebar chunk**（体积 + 循环依赖风险）。缺的是「既不跨视图、又不重复配方」的层位。

## 2. 决策（Decision）

**D1 —— 出口层位放 `views/` 根，不放 `features/`。**
新建 `frontend/src/views/config-write.ts`，与既有的 `views/backend-deps.ts` 同列（views 层**组合根**）。
- 选 views 根而非 features：出口需要「配置字段值域」这组零依赖纯数据叶（`settings-schema.ts` 的 `LINK_MODE_DEFAULT`）；`features/` 不得反向 import `views/`，若下沉 features 就得**再抄一份值域**——正是本 ADR 要消灭的漂移源。
- 跨视图 import 的顾虑由此消解：两侧都只 import 一个无页面依赖的叶子模块，sidebar chunk 不再拉进 settings 页面。

**D2 —— 出口不得直连 `backend/app.ts`，只经 `backend-deps.ts` 转发。**
check-layering **R5** 的白名单只认 `*-deps.ts` 后缀；`config-write.ts` 不在白名单，直连即违规。故它 `import { backendGetApp } from "@/views/backend-deps.ts"`。R5 语义不变（views 层唯一合法出口仍是 `backend-deps.ts`）。

**D3 —— 出口保持无状态，不做内存快照同步。**
`writeAppConfig(patch)` 只负责「读最新 → 合并 patch → 落盘 → 返回实际写入的六元组」，**不**改任何模块级内存。
- 重读失败时退化为 `Partial<>` 空对象的空串兜底（Go 端 `orDefault` 会保留旧值），**绝不带着半份配置去写盘**。
- `settings` 域的内存一致性归 `saveCfg` 薄包装负责（它 `getCfg().x = resolved.x` 只回写**被 patch 的字段**）。这样出口可被任意 view 复用，不背负 settings 的 store 生命周期。

**D4 —— `theme` / `themeAuto` 缺省自 localStorage，回退引常量而非字面量。**
`patch.theme ?? (safeGet("theme") || THEME_DARK)`。各调用方均先 `safeSet("theme", …)` 再保存，故 `undefined` 与显式传入等价；`THEME_DARK` 从 `@/theme-core` 引（单一来源，禁止 `"dark"` 字面量复现）。`linkMode` 缺省引 `settings-schema.LINK_MODE_DEFAULT`，不手抄 `"copy"`。

**D5 —— 「唯一实参点」由契约测试机器执法，不靠人自觉。**
新增 `tests/test_config_write_single_exit.ts`，三条 fail-closed 断言：
1. `frontend/src/**` 生产文件里 `SaveAppConfig(` 调点**恰好一处**，且必须落在 `views/config-write.ts`；
2. 出口以外不得 import `SaveAppConfig` 绑定（堵「绕开出口再抄一份」）；
3. 出口文件不得出现裸 `"dark"` 字面量，且必须 import `THEME_DARK`。

扫描须**剥离注释**（块注释 + 行注释）：文档注释里叙述「手抄六位置实参」属说明文字，不该被当成调点。

**D6 —— 消费方只传 patch，不再拿 `LoadAppConfig` 快照回写。**
`launcher-detect.ts` 的 `saveMcRoot(mcRoot, app?)` 第二参数（为省一次动态 import 而存在）**随之删除** —— 出口自己会取绑定；调用方无须先读配置，P1「旧快照覆盖」从接口形态上不可再犯。

## 3. 后果（Consequences）

**正面**
- 六个同型 string 的位置实参在全仓只剩一处，位置错位风险面从「N 份」压到「1 份」。
- 修掉真实缺陷：sidebar 两处 `"dark"` 不再是「用户改目录 → 主题被静默改成跟随系统」的触发点。回归锁 `expect(...mock.calls[0][4]).not.toBe("dark")` 钉在 `launcher-detect.test.ts`。
- 层位不动 R5/R6 任何白名单；sidebar chunk 不因本次收敛而增大。
- D5 让「新增第四处手抄」从 code review 事项变成**提交即红**。

**负面 / 代价**
- `writeAppConfig` 比 `saveCfg` 多一层调用（`saveCfg` → `writeAppConfig`），栈深 +1；换来的是跨视图可复用。
- 出口重读失败时不再回落到「调用方已加载的配置对象」（旧实现 `saveCfg` 会回落 `getCfg()`），而是空串兜底。语义上更保守（Go 端保留旧值），但若 Go 端 `orDefault` 行为变化，此退化路径需重新评估。

**已知遗留**
- `defaults` 值域（`LINK_MODE_DEFAULT` / `THEME_DARK`）分散在 `settings-schema.ts` 与 `theme-core.ts` 两处；出口同时引两者，恰好是「值域唯一来源」的**消费侧**证据，但值域本身尚未合并（不在本 ADR 范围）。
- Go 端 `SaveAppConfig` 的六参数签名仍是「位置实参」形态；本 ADR 只治前端调用侧，不主张改 Go 绑定（改签名会牵动 Wails 绑定生成 + CLI）。

## 4. 数据溯源

| 来源 → 结果 |
|---|
| `frontend/src/views/app-sidebar/launcher-detect.test.ts:175/202/252` 断言 `"dark"` → 迁移后实际收到 `"cyber"`（3 处 FAIL 输出即缺陷实证） |
| `frontend/src/theme-core.ts:30` `THEME_VALID` 无 `"dark"` + `:11-12` 注释「曾有 3 处 `\|\| "dark"` 已统一」 → sidebar 两处是未修净残余 |
| 负对照实证：临时投毒 `frontend/src/views/__negctl.ts`（一行手抄六位置实参）→ 契约锁报 `实际命中：views/config-write.ts:85, views/__negctl.ts:1`；删除后转绿 → 闸门非空转 |
| 契约表登记后 `tests/test_contract_tables_consistency.ts`：DOMAINS 105 / TARGETS 79（`tests` 域 78）→ 双表一致，无未登记 tests 域测试 |
| `frontend/src/views/config-write.test.ts` 6 例全绿 → 重读语义 / 缺省回退 / 重读失败兜底 / 返回值契约四条被锁 |

<!-- 文件名: saveappconfig-views-config-write-ts.md → 实际文件 ADR-313-saveappconfig-views-config-write-ts.md -->
