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

### 待修清单（按置信度排序，未在本轮修——本轮只动测试）
3. **light-capability.ts loadState 开关丢失**：先恢复 `keyEnabled/spotlightEnabled/volumetricEnabled`，随后 `setPreset()` 全量合并预设把这些开关覆盖回预设值——用户保存的灯开关跨会话丢失。测试按实际行为锁定。
4. **mount-preview-core.ts fullCleanup 不完整**：post-build 路径（ESC/关闭按钮）不从 `_handles` 移除会话、不调 `adapter.onClose`——`hasActivePreview()` 残留 true、调用方状态复位缺失；且 abort 路径刚 build 完的内容层不被 dispose（`allBuilt.push` 在守卫之后）。
5. **mount-preview-core.ts 死代码**：`cleanupCtx`（591-630，约 40 行）无消费点，`runFullCleanup` 导入后从未调用。
6. **light-capability.ts:617 setTargetHeight**：挂载态下 `rebuildCone` 换新锥组后不自动回挂场景。
7. **ground-capability.ts setEnabled(false)**：只移除挂载不改写 `surface.visible` 门控标志（与 setVisible 路径不对称）。
8. **web-fs.ts:1188 vs 1193**：`moveOrCopyWebModel` 的「目标已存在」检查先于「自嵌套」检查，目标位于源内且目标 key 已存在时报错误语义偏移（无数据风险）。
9. **web-fs.ts:946 不可达**：外层 try/catch 永不触发（web-stats 内部已吞错），死代码无害。
10. **shadow-capability.ts collectLights**：只认 lightCap/legacyLights 两个来源不从场景遍历——靠调用方接线保证，属设计语义但未文档化（测试已按此语义锁定）。
11. **render-mode-capability.ts 单属性 override**：清除后材质保持覆盖值直到全部清空才 restoreSnapshot——分支语义存疑，需确认是否有意。

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
