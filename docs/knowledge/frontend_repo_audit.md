---
kind: frontend_repo_audit
name: 前端 TS 整包审计
tier: architecture
category: ui
affected: false            # 整包审计快照卡：source_files 只服务覆盖率统计，不随单次文件变更提示复核
source_files:
  - frontend/src/
use_when:
  - 代码审核
  - 代码审查
  - 审计
  - 前端质量
  - 技术债
  - 重构排期
  - XSS
  - innerHTML
---

# 前端 TS 整包审计

## 概览

2026-08-26 按 `.trae/skills/ts-package-review/SKILL.md` 对 `frontend/src/` 全量只读评审（七个子代理并行，排除 vendor）。前置：type-consistency 全一致、binding-check 188/188、check-redlines 仅 Warn 级、typecheck 全绿。总规模 ~66k LOC（源码），加权总分 **4.1/5**。与 Go 侧 `cli_quality_audit`（八轮沉淀）对应的前端版。

## 分目录评分

| 目录 | 分 | 规模 | 一句话结论 |
|------|----|------|-----------|
| features/preview-3d/adapters | 4.2 | 11.0k | PreviewAdapter 统一接口+端口注入；MdMmBuildCtx 已域拆 6 接口+逐 stage Pick 收窄（tier1/2 落地），tier3 Builder 化待办 |
| features/preview-3d 其余 | 4.2 | 12.8k | caps 注册表+感知层解耦优秀；model2d.ts 650 行待拆 |
| backend | 4.5 | 10.1k | ZIP bomb 三重防护、idb FIFO 双上限；web-fs 三函数可抽 idbRekeyGroup |
| core | 4.0 | 4.0k | menu-defs 声明式唯一事实源；DOM 渗透 core 层是主要问题 |
| views/app-content | 3.4 | 9.3k | 全仓最低分：perf-cli.ts God Object + dedup.ts 模块级全局竞态隐患 |
| views/app-tree | 4.0 | 3.1k | data/loader/render 分层干净 |
| views/app-preview | 4.0 | 6.1k | 三套代际守卫严谨；makeScenePort 与 mmd-3d 重复应抽公共 port |
| views 其余(nav/sidebar/sync-mgr/toast/context-menu) | 4~5 | 3.0k | app-toast 满分；共性=innerHTML 静态值 esc 口径不一 |
| utils(除 3d) | 4.0 | 6.3k | esc()/hl() 管线精良；含唯一运行时 bug（short-label.ts） |
| ui | 4.0 | 2.9k | ui-rows.ts 822 行接近红线 |
| features | 4.0 | 3.8k | import-executor/download-queue 三层防御严谨；version-updater 无 AbortController（**by-design**：CheckUpdate 是 Go 绑定非 fetch，AbortSignal 无法取消 RPC，手动超时走 Promise.race+setTimeout 即正确范式，无需补 AbortController） |
| services / wasm / test-utils | 5.0 | 1.3k | 满分区：registry 极简、WASM malloc/free 配对规范 |
| workers | 4.0 | 0.4k | stats-core 纯函数与 Go 同口径 |
| web-spike | 3.0 | 0.08k | ADR-049 Phase 0 spike，正式实现已落地，**废弃候选**；废弃评估结论（2026-08-26）：解码逻辑 `summarizeDecoded` 已收敛至 `utils/format/summarize.ts`（60b46e3b），但独立页 `web-spike/main.ts` 仍经 `web.html` → `vite.web.config` `spike` 入口编译进 `dist-web/web.html`，作轻量网页解码冒烟/演示页仍有用；**保留**，仅当网页版演示面被判定冗余时才删 |

## 真 bug / 高优先级

1. **`utils/resource/short-label.ts:21-22`**：引用 `RESOURCE_TYPES.MOD_MODEL` / `VANILLA_ASSETS`，但 types.ts 中不存在 → computed key 成字面量 `"undefined"` 死代码。修法：补常量或删行。
2. **`features/preview-3d/perception/autodance.ts:157`**：`targetRot.multiply(restQuat)` 乘序疑似反了（期望 `restQuat * offset`），可能是静默 bug，需可视化验证。
3. ~~**`features/preview-3d/adapters/vrm-bone-ui.ts:107`**：`field()` 内 k/v 未 `esc()`（骨骼名来自模型文件，理论 XSS）。~~ ✅ **已修复** 2026-08-26 `2fbfe5ce`：`field()` 改 `textContent`/`createTextNode` 注入，骨骼名/路径中 `<>&` 不再当 HTML 解析（同批 skeleton `iRow` 经 `da664cf2` 同法收口，见 app-preview.md 不变量）。

## 架构债 TOP5

1. 🔄 mmd-adapter.ts `MdMmBuildCtx` 域拆分(tier1)+stage Pick 收窄(tier2)已完成（L184-269，字段 60→55，`!` 非空断言清零）；tier3 **Builder 化仍待办**——构造点 `const c = {} as MdMmBuildCtx`（L1141）仍为单体可变上下文全闭包共享，运行时未结构化
2. app-content/perf-cli.ts 534L God Object（趋势图+single-bench+诊断面板三合一）
3. app-content/dedup.ts 596L 模块级全局 `_dedupBusy/_dedupStrategy` 竞态隐患
4. model2d.ts 650L（拆 core/render/hit 三件）、ui-rows.ts 822L（按 row 类型拆）
5. detail-3d.ts 多个 300-350L show 函数

## 共性抽象机会（横向收敛）

- Worker 桥收敛 → **Step 1+2 已完成**：pmx/fbx 逐字同码（永远 resolve ok:false 编码）已抽 `createResolveModeBridge`(`features/preview-3d/adapters/worker-bridge.ts`，`createWorkerBridge` 薄封装) 收编，各自 −53 行、59 测试全绿；**ktx2 已收编**进通用 `createWorkerBridge`（reject-mode+池 round-robin+崩溃终止整池，外层信号量/降级/`__setEncodeImplForTest` 业务层保留），22 测试全绿；三桥统一、消除重复内核，净省有限（通用工厂为新增）但架构收敛；texture-decoder 为 1:N 批量聚合，基数不匹配 1:1 签名，**明确排除**防假统一
- generation 守卫 → 审计「三套实现各异」**被高估**：共享 `LoadGuard`(`utils/async/load-guard.ts` 的 `createLoadGuard`) 已存在，recycle-bin+oldest-models 共用；app-preview/app-sidebar/app-sync-manager 实为同一 `++counter` idiom（非各异）；仅 perf-cli(`DgPcGenGuard`)/app-tree(`atBeGenGuard`) 是真异实现，迁移到 LoadGuard 待办（非从零抽 `GenerationGuard`）
- 公共 port → **已落地**：`mmd-data-port.ts` 的 `makeMmdDataPort(scope)` 已是 mmd-3d(:7/:23) 与 scene-3d(:11/:28) 共用公共 port；绑定由 Wails 生成 app.ts 全量类型化，`as unknown as Record` 绕类型已根除
- idbRekeyGroup → **已落地**：`web-fs.ts` 的 `rekeyWebModelGroup` 已是两阶段「写新→删旧」事务原语，`renameWebDir`(:473)/`moveOrCopyWebModel`(:637) 已委托；仅 `renameWebFile` 单文件粒度仍内联（不同粒度，非同构）
- sidebar 等事件+超时兜底 → 已裁决**暂不**抽 `withEventTimeout`：全仓仅 sidebar 一处消费（已局部扁平化为 asbPushOne/asbWaitBusQuiet）；触发条件=出现第二个消费方时再抽进 core/bus
- 事件清理三种模式共存（removeEventListener / cloneNode replaceWith hack / addDisposableListener）→ 收敛到显式 removeEventListener

## 治理红线复核结论（check-redlines 11 条 Warn 判定）

| 项 | 判定 |
|----|------|
| R5 perf-cli/perf-trace 硬编码颜色 | 豁免（诊断面板） |
| R7 with-cached DEFAULT_NS="ysm" | 合理（缓存命名空间≠资源类型） |
| R7 load-trace format 联合类型 / ysm-adapter format:"ysm" | 合理（trace 格式标识≠资源归类） |
| R8 conflicts.ts:401 | 安全（rowsHtml 已全 esc()） |
| R8 oldest-models.ts:296/301/304 | 安全（拼接均为 t() i18n 常量，无用户数据） |
| W1 fbx-parser.worker.ts:38 `[\\/]` | 误报（有意双分隔符正则） |

## 本仓专项合规面

- **ADR-116**：RESOURCE_TYPES 无旁路定义，前端不重算归类，全合规。
- **Wails 桥**：全部经 getApp()/bindings，零 window.go 直调；`@wailsio/runtime`（Events/Window）直依赖已全量迁移到 `backend/runtime.ts` 桥（ADR-049 Phase 1 收尾：桌面走真 runtime、网页版走 no-op 桩），零业务模块直 import（2026-08-26 收口，原 android-events 越层点已消除）。
- **core 层 DOM 渗透**（清单已收口，共 2 项）：① `context-menu-handlers` clipboard/execCommand —— DOM 直触，**保留观察**（非债、与 i18n 无关）；② `locale.ts:116` `document.documentElement.lang` —— 经核属 **i18n 核心职责**（见 i18n.md:37 同步 `<html lang>`），**by-design 非债、不下沉**；core/i18n 内仅此一处 DOM 直触，渗透清单已闭环。

## i18n 缺口（硬编码中文未走 t()）

core/handlers/sync.ts:87、utils/dom/dialogs/adv-filter-util.ts:38-53、features/recycle-bin.ts:124-127。

## 测试缺口

perception 6 控制器无独立测试；caps dispose 未测；dedup/conflicts 无单测；model2d/parse-java-model/stats-core 边界未覆盖。

## 不变量

- 凡进 innerHTML 的变量一律 esc()——含静态注册表值（app-nav gid/label、sidebar data-sync-type 当前未包，低危但口径应统一）。
- 模块级 let 可变全局需有 reset 路径或注释豁免理由。
- catch 后静默仅允许在 binding 装配层；其余层至少 warn 留痕。

## 相关

- [cli_quality_audit](cli_quality_audit.md)：Go 侧对应审计卡
- [3d-patterns](3d-patterns.md)、[backend_web](backend_web.md)
