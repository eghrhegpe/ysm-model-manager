# ADR-327：自定义 HDR 路径持久化与重启恢复

- **状态**：📝 提议中（Proposed）
- **实施状态**：📝 未实施（仅立 ADR 收口决策方向，待人类拍板「决策节·待拍板项」后方可进入实施；落地进度不在此记）
- **日期**：2026-10-11
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **准入理由**：自定义 HDR 跨前端/Go绑定/存储三域，重新设计难逆转
- **相关**：`frontend/src/preview-3d/caps/env-hdr-cache.ts; internal/app/resource_bindings.go (ReadFileBytes); docs/knowledge/preview-env-state.md`

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

自定义 HDR 是当前环境通道的一个**半残能力**：用户能在会话内选 `.hdr` 文件并实时看到 IBL 效果，但重启应用后这一选择无法恢复，每次都要重新选文件。根因在三个层面各自缺一块拼图，且三者之间的接缝从未被设计过：

- **前端环境通道只搬运"预设类"字段**。`env-state-schema.ts` 的 `ENV_KEYS` / `RESTORE_DERIVED` / `ARCHIVE_ALIAS` 只覆盖 `envEnabled / envPreset / envIntensity / envSource / envUseAsBackground` 五个 schema key（sharp-review 2026-10-11 P1-② 又把死键 `envResolution` 删了，归档方言从 4 降为 3），**不含任何"自定义 HDR 文件路径"字段**。所以 `envPreset:"custom"` 这个枚举值会被归档带回来，但它所指代的"那个文件"从未离开过内存。
- **HDR 缓存容器不持有文件路径**。`env-hdr-cache.ts` 的 `EnvHdrCache` 在 `loadFromFile(file)` 解码后只持有 `customHdrTex`（`THREE.DataTexture`，内存态），字段表里没有 `customHdrPath` 之类的持久化句柄；`dispose()` 直接把纹理置空，路径无从谈起。
- **重启恢复因此只能兜底**。`loadState` 读到 `envPreset:"custom"` 但 `hdr.tex` 为空时，走 `customWithoutCache` 分支回退到 `studio` 预设（P2-c 已把这里的"只告警一次"收敛进容器的 `warnMissingOnce`）。效果是：用户在 UI 上明明看到过"自定义 HDR"，重启后它却悄悄变成了影棚——一个静默的持久化断点。

这件事跨三个域、且一旦把路径写进归档就**难逆转**（旧归档会永远携带该字段、跨设备/云同步都会撞上路径有效性问题），符合 ADR-320 架构级准入判据，故立此 ADR 而非直接动手。

## 2. 决策（Decision）

> 状态：📝 提议中（待拍板）。以下为 AI 建议方向 + 待定项，落地前需人类拍板「待拍板项」。

**建议方向（推荐）**：把"自定义 HDR 文件路径"作为环境通道的第一类持久化实体，重启时经 Go 绑定 `ReadFileBytes` 重新解码、复用与用户手动选文件**同一条**解码入口填入 `EnvHdrCache`，而不是在归档里内嵌整张 HDR blob。

**待拍板项（须人类决策，不在此代答）**：
1. **路径存哪**：（A）新增 `envState` schema key `envCustomHdrPath`（与环境通道其余字段同源轮转）；（B）走独立的"外部资源引用表"（多 HDR 槽 / 未来贴图复用可共用）；（C）归档内嵌 blob（最简单但体积与跨设备最差）。当前倾向（A），理由：与现有 ENV_KEYS 归档方言机制零成本对接，且本需求单槽即可。
2. **路径失效语义**：重启时 `ReadFileBytes` 失败（文件被删 / 跨设备路径失效 / 权限被拒）→ 复用现有 `warnMissingOnce` 回退 `studio`，不报错、不卡启动。这与当前 `customWithoutCache` 兜底行为一致，属无回归。
3. **Go 侧安全边界**：归档是用户可控文本，绝不能让其中任意路径触发 `ReadFileBytes` 任意读。须在 Go 绑定层做 allowed-roots / 沙箱校验（与现有资源读取权限体系对齐），这是本 ADR 落地的硬前置，不是前端就能闭环的事。

## 3. 后果（Consequences）

- **正面**：自定义 HDR 跨重启一致，消除"明明设过却变影棚"的静默断点；用户手动选文件与自动恢复走同一解码路径，行为可证明等价。
- **负面 / 成本**：新增 Go 侧路径校验面（allowed-roots 必须随本 ADR 一起落地，否则是安全债）；归档体积与跨设备迁移复杂度视「待拍板项 1」选择而定（倾向 A 则增量极小）。
- **已知遗留**：多 HDR 槽、云同步时路径的"相对化/重映射"策略不在本期范围，按（B）路线预留扩展点即可；不阻塞单槽落地。

## 4. 数据溯源

- 现状实证（当前源码树）：
  - 环境通道 key 集与归档方言：`frontend/src/preview-3d/state/env-state-schema.ts`（`ENV_KEYS` / `ARCHIVE_ALIAS`，P1-② 后剩 3 方言）。
  - HDR 缓存容器只持纹理、无路径：`frontend/src/preview-3d/caps/env-hdr-cache.ts`（`loadFromFile` L108、字段 `customHdrTex` L17，无 `customHdrPath`）。
  - 重启兜底回退：`frontend/src/preview-3d/caps/environment-capability.ts`（`loadState` 的 `customWithoutCache` 分支，P2-c 收敛为 `warnMissingOnce`）。
  - Go 侧重解码入口（候选恢复路径）：`internal/app/resource_bindings.go`（`ReadFileBytes`）。
- 关联知识卡：实施进度与边界细则见 `docs/knowledge/preview-env-state.md`（P1-③ 指针）。

<!-- 文件名: hdr.md → 实际文件 architecture/ADR-327-hdr.md（ADR-320 architecture 全量模板） -->
