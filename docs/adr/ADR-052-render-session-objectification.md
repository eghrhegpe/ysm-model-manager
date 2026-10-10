# ADR-052：RenderSession 对象化：model3d 场景状态收敛与回调方法化

- **状态**：✅ 已采纳（Accepted）
- **日期**：2026-08-11
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-004 3D 渲染管线,ADR-034 十二轮审计剩余债`
- **后续状态**：RenderSession 落地后生产无调用方，render-session.ts（470 行）与 renderer-setup.ts 随 ADR-052 P2 收尾删除，`model3d.ts` 缩为 Spec 类型枢纽；现行架构为 ADR-066 统一预览核心（单会话）+ ADR-093 多模型同框（sceneRegistry）。本 ADR 的「实例字段封装、显式 dispose」思想已被统一核心继承。

---

## 1. 背景（Context）

`frontend/src/utils/model3d.ts`（原 model3d.js）是 3D 预览渲染核心，经 ADR-004 定稿为 Three.js 渲染路径。多轮审计（含 ADR-034「十二轮审计剩余债」）与 9 次坐标修正（bug-chronicle 全项目第一）暴露出结构性问题：

1. **模块级可变状态散落**：`camera` / `renderer` / `controls` / `container` 等场景对象以模块级变量存在，非实例成员——多预览实例共存（对比视图/截图渲染）时互相覆盖，状态写入点不可追踪（审核反模式「隐式状态写入」）。
2. **回调参数漂移**：16 个回调（onProgress/onError/onTextureReady 等）以裸参数逐层透传，数百处引用，签名改动牵一发动全身；`glueCalled`/`_loadGen` 等标志散落（avatar_test 曾用 `_ =` 丢弃）。
3. **坐标系反复修**：model2d/model3d/spec.go 三处坐标口径不一致导致 9 次 fix——需要稳定入口而非继续打补丁。
4. **已完成的前置收敛**（本立项的已落地部分）：
   - 11 个可变状态收敛进 `state` 对象（d47f9855 / 17a33a3e）
   - model3d 顶层纯函数已拆至 `mesh.ts`（bf8438a0）

## 2. 决策（Decision）

**RenderSession 完整对象化**——以单一 `RenderSession` 实例封装全部渲染场景与生命周期：

1. **场景对象收敛**：`camera` / `renderer` / `controls` / `container` / `scene` / `clock` 全部成为 `RenderSession` 实例字段，删除模块级散落变量——多实例共存安全，状态写入点唯一（构造函数 + 显式方法）。
2. **回调方法化**：16 个透传回调收敛为实例方法（`onProgress`/`onError`/`onTextureReady`/`onFrame` 等），构造时注入 options 对象，签名稳定；删除裸参数逐层透传。
3. **生命周期显式化**：`dispose()` 完整释放（renderer.dispose / geometry.dispose / material.dispose / controls.dispose / 取消 RAF），与 ADR-008 资源释放范式对齐。
4. **代际守卫内聚**：`_loadGen` 等异步代际标志收敛进实例，await 后落 DOM/写状态前统一校验（ADR-044 ①）。
5. **坐标系单一入口**：pivot X 取反、`from.x = origin.x - size.x` 等 ysmview 口径收敛为实例内具名方法，禁止散落裸变换（陷阱 #11）。

## 3. 后果（Consequences）

**正面**：
- 多实例预览/截图渲染共存安全（消除模块级覆盖竞态）；
- 回调签名稳定，数百处引用经 codemod 一次性迁移后可长期演进；
- dispose 完整，消除渲染器/几何体泄漏（长会话反复预览内存增长的根因候选）；
- 坐标口径单点维护，终结「9 次 fix」循环。

**负面**：
- ~数百处引用迁移，改动面大（codemod 批量 + 人工核对）；
- 与 model2d / spec.go 的口径对齐需回归验证（陷阱 #11：改完须近距自由相机验证渲染，不能只过单测）；
- 截图渲染器（screenshot-renderer.ts）与 3D 预览共享逻辑需同步适配。

**已知遗留**：
- WASM 解码路径（ysmp YSGP 加密）不属本立项，仅消费 RenderSession 输出；
- 坐标口径与 ysmview 的剩余偏差（若有）在对象化后单独修正，不混入本重构。

## 4. 数据溯源

- ADR-004（3D 渲染管线定稿）→ model3d.js 为消费 Go spec 的唯一渲染路径；
- ADR-034（十二轮审计剩余债）→ model3d-loader.ts 结构债登记；
- bug-chronicle #14（model3d 9 次坐标 fix 全项目第一）→ 坐标散落是重构诱因；
- 已完成前置：d47f9855 / 17a33a3e（11 状态收敛进 state）、bf8438a0（纯函数拆至 mesh.ts）；
- 落地顺序：① RenderSession 类骨架 + 状态收敛（含已收敛 state 并入）→ ② 16 回调方法化 + codemod 迁移引用 → ③ dispose 完整化 → ④ 坐标口径单点化 → ⑤ 近距渲染验证 + 全量回归。

<!-- 文件名: render-session-objectification.md → 实际文件 ADR-052-render-session-objectification.md -->
