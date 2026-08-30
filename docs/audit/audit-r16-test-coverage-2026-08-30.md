# R16 补测轮：测试覆盖清欠

**执行日期**：2026-08-30
**范围**：前端欠测清单清零（caps 能力层 / adapters 适配器层 / 散件三组，共 30 个源文件）
**方法**：主模型跑 `test:coverage` 生成欠测清单 → 按模块划三组并行子代理补测 → 主模型 diff 抽查 + 统一验证（全量 vitest / typecheck / vite build）
**前置报告**：R5（前端数据层）/ R8（测试覆盖缺口）/ R14（覆盖率）/ R15（scripts 工具链）
**额度消耗**：三组子代理合计约 1.1 亿 token（A 组 ~1500 万 / B 组 ~5900 万 / C 组 ~3900 万）

---

## 覆盖率成果

| 组 | 文件数 | 用例增量 | 补测前语句覆盖 | 补测后语句覆盖 |
|---|---|---|---|---|
| A 组：utils/3d/caps/ 能力层 | 8 | +185（292→479 全绿） | 10.6%~75.1%（均值约 51%） | 91.5%~100%（合计 95.25%） |
| B 组：utils/3d/adapters/ 适配器层 | 7 | +93（adapters 目录 675 全绿） | 52.6%~75.6%（合计 72.9%） | 合计 96.0% |
| C 组：散件（app-modules/web-fs/settings 等） | 15 | ~180（15 文件 326 全绿） | 0%~76.2% | 92.6%~100% |

**全仓口径验证**（补测后重跑 `test:coverage` + 排名脚本，与补测前同口径对比）：30 个目标文件全部从「最差 30」榜单出榜；全仓语句覆盖率最差文件从 app-modules.ts **0%** / render-mode-capability.ts **10.6%** 提升至 75.0%（schema.ts，仅剩 1 条未覆盖语句，有意放弃）。典型提升：app-modules.ts 0%→98.1%、render-mode 10.6%→100%、shadow 28.2%→96.5%、environment 39.4%→92.0%、mmd-adapter 59.7%→98.7%、web-fs 76.2%→95.7%。

- **新建测试文件 8 个**：render-mode-capability.test.ts（10.57%→100%）、mount-preview-core.test.ts（13 用例）、app-modules.boot.test.ts（0%→98.1%，此前 app-modules.ts 本体从未被任何测试 import）、web-fs.bindings.test.ts、toolbar-search.test.ts、index.branches.test.ts、debug.ring.test.ts、virtual-scroll.test.ts
- **扩展既有测试 21 个**（caps 7 + adapters 6 + 散件 8）
- 剩余未覆盖均为：防御性 null 分支、v8→istanbul 重映射伪影、需真实 WebGL/WASM/blob IO 的集成路径（入口已用 spy 锁定，实体解码留给集成测试）

---

## 发现并修复的 bug

### 已修复（本轮内）

1. **worker-bridge.ts 工厂接线丢失（P1，已 TDD 修复）**：`createResolveModeBridge` 创建 worker 后未把 `worker.onmessage/onerror` 委托回 `bridge.handleMessage/handleWorkerError`——`0b6cc1f9`（Step 1）与 `409b060e`（Step 2）重构时接线丢失。后果：`mmd-pmx-worker=1` / `fbx-worker=1` 时 worker 解析响应永不结算，恒 30s 超时 → ok:false → 静默回退主线程（功能可用但每次白等 30 秒 + worker 白跑）。掩盖原因：既有测试注释写明「测试手动桥接 onmessage」——测试替工厂把活干了。修复：工厂内 3 行接线 + `worker-bridge.test.ts`「工厂内部接线」回归锁 2 例；知识卡 `worker-bridge-settleerror-fallback.md` 不变量区补「消息接线由工厂完成」。

2. **environment-capability.ts:703 `halfToFloat` API 不存在（P1，已 TDD 修复）**：custom HDR 直方图分支调 `THREE.DataUtils.halfToFloat`，three r185 只有 `fromHalfFloat`（实证：`three@0.185.1` 的 `DataUtils.js:205` 仅导出 `fromHalfFloat`；`@types/three@0.185.4` 亦仅有 `static fromHalfFloat`）。影响：加载自定义 HDR 后打开 3D 菜单，`env-histogram` 控件 `getValue` 必抛 TypeError。修复：改用 `THREE.DataUtils.fromHalfFloat` 并删掉骗过编译的 `as unknown as {...}` 断言（官方类型已覆盖）；测试内 monkey-patch 桥同步撤除，改走真实路径锁定。验证：撤桥后先红灯（`TypeError: hf is not a function` @ :705）→ 修复后 67/67 绿、typecheck 零错，全仓再无 `halfToFloat` 残留。

3. **light-capability.ts loadState 开关丢失（已 TDD 修复）**：先恢复 `keyEnabled/spotlightEnabled/volumetricEnabled`，随后 `setPreset()` 全量合并预设把这些开关覆盖回预设值——用户保存的灯开关跨会话丢失。修复：改为「先套预设、再用保存值覆盖」；新增 `syncConeMount()`（从 setPreset 原样抽取，零行为变更）在开关覆盖后同步锥组挂载态，避免「开关关了但光锥还在场景里」；引擎恢复挪到最后走 `setVolumetricEngine()`，保住「postprocess ⇒ volumetric 关闭」一致性。**测试陷阱**：原用例搭建顺序错误（先设 `key.enabled=false` 再 `setPreset`，预设当场覆盖，`saveState` 存下的本就是预设值），测不出该 bug——已改为真实用户路径「先选预设再调开关」。验证：搭建修正后临时还原旧顺序 → 红灯（`expected true to be false`），修复后 45/45 绿。
**⚠️ 本项首版修复有缺陷，已由并发的 CodeReview 会话纠正（5809800c）**：我原实现把引擎恢复写成 `setVolumetricEngine(state.volumetricEngine)`（cone/postprocess 都走方法），但该方法对 `"cone"` 带副作用——`spotlight.enabled` 时会**强制 `volumetric.enabled = true` 并重建锥组**（:712-721，运行期切回锥引擎的语义）。由于保存的引擎绝大多数是 `"cone"`，这等于在另一处又把用户保存的 `volumetricEnabled=false` 翻回 true，**方向与所修 bug 恰好相反**。现修正为：`"postprocess"` 走方法调用（其「⇒ volumetric 关闭」约束是有意的），`"cone"` 走无副作用的字段赋值。**教训**：给"恢复状态"类的 setter 排序时，必须确认该 setter 是否带跨属性的副作用——只按字段语义推演会漏。
4. **mount-preview-core.ts fullCleanup 不完整（已 TDD 修复）**：post-build 路径（ESC/关闭按钮）不从 `_handles` 移除会话、不调 `adapter.onClose`——`hasActivePreview()` 残留 true、调用方状态复位缺失；且 abort 路径刚 build 完的内容层不被 dispose。修复：① 新增单一收尾出口 `finishSession()`（幂等，closeOverlay 早期路径与 fullCleanup 共用）——摘句柄 + `onClose` + 焦点归还只发一次；② abort 分支在 `fullCleanup()` 前把 `session.built` 补登记进 `allBuilt`，使内容层得以 dispose；③ `cleanupPreview()` 改快照遍历（callee 会从 `_handles` 摘自身，边遍历边删会跳元素，cooperate 多会话只清一半）。验证：ESC 用例 `onClose` 由 0 次 → 1 次、新增 abort 用例 `dispose` 由 0 次 → 1 次，14/14 + 24/24 绿。连带修复：`skeleton.ts` 的 android-back 注销此前永不发生（返回键栈反复 push handler 不注销）。

6. **light-capability.ts setTargetHeight 丢锥（已 TDD 修复）**：`rebuildCone()` 会 `disposeCone()` 移除旧锥组再换新实例，**新实例默认脱离场景**，而原实现只在「`coneGroup` 已在场景中」时同步位置 → 挂载态下改高度会让体积光锥凭空消失。修复：重建前记录挂载态，重建后经新增的 `attachCone()` 按原状态回挂 + 重新定位（只恢复「重建前已挂载」，不凭空新增挂载）。**范围厘清**：一度怀疑 `setPreset` 同病，查证后排除——全部 `LIGHT_PRESETS` 的 `volumetric.enabled` 均为 `false`，setPreset 走的必然是卸载路径，不存在「该保住却丢」。
**归属说明**：本项源码改动（light-capability.ts / .test.ts）在提交时被并发会话 `5809800c`（CodeReview 批次1）的路径限定提交一并卷入——`git commit -- <path>` 提交的是**工作区内容**，并行会话活跃时会互相收编未提交改动。故 `df6a9659`（标题写「caps 三处 #6/#7/#11」）实际只含 #7；#6 见 `5809800c`，#11 见 `cf1dd19e`。
7. **ground-capability.ts setEnabled 门控陈旧（已 TDD 修复）**：`surface.visible` 是三条件门控（`enabled && params.visible && matSource !== "none"`），但 `setEnabled` 改了 `enabled` 却从不重算，而 `setVisible` 会——两侧不对称。可观测后果：禁用期间改材质（`refreshSurface` 按 `enabled=false` 重算成 false）→ 再启用时 `apply()` 只挂回场景不恢复门控 → **表面层挂在场景里却不可见**（地面材质凭空消失）。修复：`setEnabled` 末尾补 `updateSurfaceVisible()`。
8. **web-fs moveOrCopyWebModel 检查顺序（已 TDD 修复）**：「目标已存在」先于「自嵌套」，二者同时命中时报错语义偏移。**先查 Go 定序**：`go/fileops/fileops.go:313-320`（自嵌套）先于 `:326`（目标已存在）。但**不能整体对调**——`newName === name`（目标 == 源自身）在 Go 是「目标已存在」（此时 dstDir 是 src 父目录，`relToSrc` 为 `".."` 不算嵌套，`dst==src` 命中 stat），靠的正是「存在性在前」才碰巧对齐。修复：只把**严格位于源内**那一支（`startsWith(name + "/")`）上移到存在性检查之前，等值分支留在后面。
9. **web-fs 不可达 try/catch（已清理）**：`batchStatsWebModels` 全链路吞错（`getWorkerPool` 自 catch 返回 null、`statsOneChunk` 只 resolve 不 reject），外层 catch 永不触发。查证「不向上抛」已有契约测试锁定（`web-stats.test.ts:45`「runner 抛错 → 降级（不向上抛）」），据此移除死 catch 改 `const stats = await ...`。**注意**：`if (!stats)` 的降级块是**可达且必要**的（null 是合法返回值），不可一并删除。
10. **shadow-capability.ts collectLights（已文档化 + 测试显式锁定）**：只认 `lightCap` / `legacyLights` 两个来源、有意不遍历场景——避免误伤适配器自带的补光/特效灯。已补源码契约注释（调用方须知：适配器自行加灯须经 `setLightCap` 或 `syncLights()` 接线，否则不纳入阴影配置）并新增 2 条用例把语义落成断言，不再依赖注释口述。
11. **render-mode-capability.ts 单属性 override（已按声明语义修复，⚠️ 语义决策待确认）**：`applyOverrides` 只写非 null 项 → 清除单个 override 后该属性一直停在覆盖值上，直到全部清空走 `restoreSnapshot` 才恢复，与文件头「每个属性独立 override（null = 保持原始值）」矛盾。修复：逐属性回落——非 null 用 override，null 回落快照原值（无快照才保持现值）。**两处行为变更**：① 单属性清除即时还原；② 覆盖期间被外部改写的材质，清除 override 后回到**首拍快照原值**而非保留外部现值（「原始值」按快照口径解释）。若产品期望的是「保留外部现值」，回滚此条即可。

### 待修清单（按置信度排序，未在本轮修——本轮只动测试）

> 原 #3 / #4 / #6~#11 已修复，见上方条目；编号保留以便追溯。

5. **mount-preview-core.ts 死代码**：`cleanupCtx`（591-630，约 40 行）无消费点，`runFullCleanup` 导入后从未调用。**已核实更深含义**：`runFullCleanup`（cleanup-3d.ts:82）才是完整清理实现，含 `nullHandle()` 摘句柄、`adapter.onClose?.()`、焦点释放（:140-145）——正是本地 `fullCleanup()` 缺的部分。即**抽取重构半途而废**：调用方仍走旧内联闭包，新实现连同 ctx 一起变死代码。两份实现**不等价**（本地版多做外壳拆除/单例清零/场景差量移除/rAF 注销，缺 pointer·resize·click 解绑），**统一需单独立项评估，不可直接替换**——本次按最小风险补本地版缺口。

---

## 顺手修复的脚本问题

**test-coverage-report.mjs 清单被满覆盖文件堵塞**：默认输出按「小文件优先」排序，零语句的类型/纯声明文件（100% 覆盖）堵住清单前排，真正欠测的大文件沉底——本轮实测 365 个文件全部显示 [100%] 且「未覆盖行: (无)」。修复：满覆盖且无未覆盖行/函数的文件不占名额（`visibleRows` 过滤），头部注释同步更正（原注释「语句覆盖率升序」与实际排序不符）。契约测试 tests/coverage-suggest-hint.mjs 13 项全绿。

---

## 汇总阶段修复（主模型）

三组产出合并后统一验证发现两处收尾问题，均由主模型修复：

1. **C 组测试的类型债务（37 处 TS 错误）**：子代理跑 vitest 验证（esbuild 转译不查类型）但漏跑 typecheck。修复：web-fs.bindings.test.ts 的 `ab2u8` 签名放宽（`ArrayBuffer | Uint8Array` 归一，zipSync 返回值可直接回灌）、`seedMark` 第 5 参放宽 `unknown`、5 处 `as string[]` 断言删除（绑定声明即返回 `Promise<string>`，断言非法且多余）、`getMockImplementation` 非空断言；detail.test.ts 删 `mockResolvedValue` 多余第二参 + `vi.mocked()` 包装修复函数窄化；ysm-object.test.ts 的 `typeof x![0]` 改 `NonNullable<typeof x>[0]`。
2. **app-modules.boot.test.ts「启动 2s 后预取」跨用例竞态**：源码 IIFE 注册的是真实 `setTimeout(2000)`，上一用例的 timer 在全量慢跑下于本用例断言前到点触发共享 mock（单跑绿、全量挂）。修复：boot 前 `mockClear()` 清跨用例迟到调用——boot 的 `flushMicro` 是纯微任务泵（宏任务无插入点），boot 后同步断言无竞速窗口。

## 总体结论

**通过**。三组 30 个源文件语句覆盖从欠测区（0%~76%）整体拉到 92%~100%，全量验证绿（vitest / typecheck / vite build，见工作区验证记录）。测试补全顺带产出 1 个 P1 修复（worker-bridge 接线）+ 10 项待修清单——「补测即审核」的路径再次验证有效：测试要锁住分支就必须读懂分支，读懂分支才能发现分支里的坑。

## 后续建议

1. ~~待修清单 #2（halfToFloat）建议尽快修~~ —— 已完成（见「已修复」第 2 条）。
2. #3/#4（loadState 开关丢失 / fullCleanup 不完整）属用户可感知的状态丢失，排入下一审核轮。
3. worker-模式白等 30 秒的问题修复后，建议实测一次 `mmd-pmx-worker=1` 的加载耗时确认回归。
4. 欠测清单口径已修正，下轮补测直接 `node scripts/test-coverage-report.mjs --top 30` 取目标即可。
