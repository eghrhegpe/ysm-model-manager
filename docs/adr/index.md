---
layout: page
title: 决策记录（ADR）
permalink: /adr/
---

<!-- 本文件由 scripts/gen-docs-index.ts 自动生成，禁止手改。重跑：node scripts/gen-docs-index.ts -->

# 决策记录（ADR）

> 架构决策日志，共 **158** 篇。决策真相源 = 各 ADR 文件首部「状态」行；本页为登记表 + 规范索引（单文件承载全部）。

> 所有 ADR 存放于本目录。**写新 ADR 前必读本节**——防撞号靠登记，不靠自觉。

## 按状态分布

| 状态 | 数量 |
|------|------|
| [⚠️ 已采纳但遗留未修复](#已采纳但遗留未修复) | 0 |
| [🔄 部分采纳](#部分采纳) | 2 |
| [✅ 已采纳](#已采纳) | 154 |
| [❌ 已取代](#已取代) | 2 |
| [🧊 已废弃](#已废弃) | 0 |
| [❓ 未归类](#未归类) | 0 |

## 按状态分组导航

### 🔄 部分采纳（2）

| ADR | 标题 | 状态 |
|-----|------|------|
| [ADR-139](./ADR-139-platform-shim-dedup.md) | 平台 shim 收敛 rustbridge 与 scanner 四 OS 重复 | 🔄 部分采纳 |
| [ADR-122](./ADR-122-mdmmbuildctx-tier3-builder.md) | MdMmBuildCtx 三档重构与 tier3 Builder 化否决 | 🔄 部分采纳 |

### ✅ 已采纳（154）

| ADR | 标题 | 状态 |
|-----|------|------|
| [ADR-161](./ADR-161-render-vocabulary-charter.md) | 渲染会话词汇章程:spec 契约单一镜像 + 尺度词消歧(组件/模型/内容层/条目)+ built 黑话退役 | ✅ 已采纳 |
| [ADR-160](./ADR-160-subentity-component-spec-projection.md) | 子实体统一为组件视图:GetModel3DSpec spec.models 唯一源 + 详情统计 = spec 投影(maid L0 清单退役) | ✅ 已采纳 |
| [ADR-159](./ADR-159-scene-registry-container-semantics.md) | sceneRegistry 容器语义：displayName + components（资源包=实体、包内模型=组件） | ✅ 已采纳 |
| [ADR-158](./ADR-158-readme-drift-assertions.md) | check-readme-index 增加描述过时断言（提及但说错可机检） | ✅ 已采纳 |
| [ADR-157](./ADR-157-contract-test-targets-precise.md) | 契约测试 TARGETS 宽哨兵收敛为精确文件清单 | ✅ 已采纳 |
| [ADR-156](./ADR-156-contract-tests-precise-crop.md) | 契约测试按变更文件精确裁剪（scripts 改动不再全量） | ✅ 已采纳 |
| [ADR-155](./ADR-155-commit-with-check-lightweight.md) | commit-with-check 重构为独立轻量提交校验（与重型 push 门禁解耦） | ✅ 已采纳 |
| [ADR-154](./ADR-154-go-ts-golden.md) | Go-TS 解析层 golden 对拍（双端互锁契约） | ✅ 已采纳 |
| [ADR-153](./ADR-153-stats-worker-mt-lazy-import.md) | stats.worker WASM 资产条件加载——base / mt 双向动态 import | ✅ 已采纳 |
| [ADR-152](./ADR-152-gen-stage-concurrency-root.md) | gen-stage 并发卷带根除——快照变化 ∩ 非并行 dirty 判定（实证验收） | ✅ 已采纳 |
| [ADR-151](./ADR-151-commit-temp-index-concurrency.md) | commit-with-check 临时索引白名单提交：并发隔离取代裸 git commit | ✅ 已采纳 |
| [ADR-150](./ADR-150-pre-commit-git-add-u-docs-p2-2.md) | pre-commit 兜底收窄：禁用 git add -u docs/ 吞并发漂移 (P2-2 加固) | ✅ 已采纳 |
| [ADR-149](./ADR-149-modal-ts-dialogs-css.md) | modal.ts 内联样式外提为弹窗类（dialogs.css） | ✅ 已采纳 |
| [ADR-148](./ADR-148-container-preview-factory.md) | preview-3d 容器类适配器统一工厂(方案 C)决策方向 | ✅ 已采纳 |
| [ADR-147](./ADR-147-remove-apptree-typefilter-dead-field.md) | 移除 app-tree _typeFilter 死字段与自证测试 | ✅ 已采纳 |
| [ADR-146](./ADR-146-path-alias-anti-barrel.md) | TS 路径别名与反桶契约 | ✅ 已采纳 |
| [ADR-145](./ADR-145-cli-app-service-interface.md) | cli 解耦 app：消费方定义 AppService 接口 | ✅ 已采纳 |
| [ADR-144](./ADR-144-types-container-decouple.md) | types 解耦 container：识别大脑下沉 packs | ✅ 已采纳 |
| [ADR-143](./ADR-143-binding-json-to-struct.md) | 绑定返回值去 string-JSON 化（铲债决策） | ✅ 已采纳 |
| [ADR-142](./ADR-142-texture-cache-channel-unification.md) | 缓存三通道统一：texture-cache 内存池 + 磁盘压缩分层 | ✅ 已采纳 |
| [ADR-141](./ADR-141-large-script-split-baseline.md) | 大脚本拆分基线 | ✅ 已采纳 |
| [ADR-140](./ADR-140-go-dup-self-three-tier-variant-policy.md) | Go 重复代码治理：文件内自重复三层判定与变体层不强制合并 | ✅ 已采纳 |
| [ADR-138](./ADR-138-preview-3d-to-src.md) | preview-3d 上提 src/preview-3d（去 features 中间层） | ✅ 已采纳 |
| [ADR-137](./ADR-137-ysm-decoder-homecoming.md) | YSM 解码子系统归位（views/app-preview/decoder → features/preview-3d，第五刀） | ✅ 已采纳 |
| [ADR-136](./ADR-136-screenshot-domain-homecoming.md) | 截图/离屏渲染领域归位（views/app-preview → features/preview-3d，第四刀） | ✅ 已采纳 |
| [ADR-135](./ADR-135-go-jscpd.md) | Go 端 jscpd 重复代码检测与增量门禁 | ✅ 已采纳 |
| [ADR-134](./ADR-134-container-type-cache-component.md) | 将 containerTypeCache 包级全局收进组件（破隐藏耦合） | ✅ 已采纳 |
| [ADR-133](./ADR-133-testid-contract-authenticity.md) | 契约测试真实性：从存在性门禁升级为消费性校验 | ✅ 已采纳 |
| [ADR-132](./ADR-132-multi-model-select-menu-primitive.md) | 多模型选择菜单原语（跨资源类型统一 select） | ✅ 已采纳 |
| [ADR-131](./ADR-131-preview-stats-extraction.md) | 3D 渲染期统计提取（预览期统计与类型判定解耦） | ✅ 已采纳 |
| [ADR-130](./ADR-130-pack-dnd-repo-first-push.md) | 整合包卡片拖拽导入：先入仓库再推送 | ✅ 已采纳 |
| [ADR-129](./ADR-129-preview-3d-domain-root.md) | 3D 预览领域根升格（utils/3d → features/preview-3d，修依赖倒置） | ✅ 已采纳 |
| [ADR-128](./ADR-128-menu-nav-graph-e2e-selectors.md) | 菜单导航图生成器与 e2e 选择器派生（声明式收口后的可验证性） | ✅ 已采纳 |
| [ADR-127](./ADR-127-preview-perf-presets.md) | 性能档位薄壳版——数据表 + 通用套用器（低/中/高/自定义） | ✅ 已采纳 |
| [ADR-126](./ADR-126-menu-schema-final-form.md) | 3D 预览菜单声明式 Schema 终态——状态层泛化 + 面板 schema 化 + 可见性谓词化 + dockGroup 解耦 | ✅ 已采纳 |
| [ADR-125](./ADR-125-preview-menu-unified-state-single-renderer.md) | 3D 预览菜单统一：settingsState 横切状态层 + 单渲染器 + visible 规则 | ✅ 已采纳 |
| [ADR-124](./ADR-124-i18n-key-naming-three-segment.md) | i18n 键名三段式规范 | ✅ 已采纳 ⚠️ 被 [ADR-045] |
| [ADR-123](./ADR-123-cross-environment-downgrade-strategy.md) | 跨环境降级策略统一 | ✅ 已采纳 |
| [ADR-121](./ADR-121-shadow-dom.md) | Shadow DOM 样式隔离铁律 | ✅ 已采纳 |
| [ADR-120](./ADR-120-go-rust-manifest-jwalk.md) | Go/Rust 共享已扫描状态：manifest 注入跳过 jwalk | ✅ 已采纳 |
| [ADR-119](./ADR-119-dedup-parallel-hash.md) | dedup 并行化：共享并行哈希管道（串行收集+并行哈希+序号还原） | ✅ 已采纳 |
| [ADR-118](./ADR-118-face-level-translucency.md) | 面级透明分类：mesh 级 alpha 误判数据与分阶段落地 | ✅ 已采纳 |
| [ADR-117](./ADR-117-ground-material-spec.md) | 地面材质 spec 单一事实源 | ✅ 已采纳 |
| [ADR-116](./ADR-116-frontend-go-boundary.md) | 前端 vs Go 职责红线：筛选/类型判定权威层归 Go | ✅ 已采纳 |
| [ADR-115](./ADR-115-append-semantics.md) | 跨类型同台追加必须走 switchExternal 主门路由（➕ 三态行为契约见知识卡） | ✅ 已采纳 |
| [ADR-114](./ADR-114-per-component-textures.md) | 每组件独立纹理（perComponent Textures） | ✅ 已采纳 |
| [ADR-113](./ADR-113-ysm-molang.md) | YSM 骨骼动画 Molang 求值器与欧拉序修复（L4） | ✅ 已采纳 |
| [ADR-112](./ADR-112-fbx-loader-preview-foundation.md) | FBX 格式接入与独立预览地基 | ✅ 已采纳 |
| [ADR-111](./ADR-111-variants-decouple.md) | variants 解耦——类别—格式分层，角色模型合并 PMX/VRM | ✅ 已采纳 |
| [ADR-110](./ADR-110-mod-registry.md) | mod 依赖下沉注册表，消除 Go 硬编码 | ✅ 已采纳 |
| [ADR-108](./ADR-108-camera-framing-bounding-box.md) | 相机取景包围盒计算策略 | ✅ 已采纳 |
| [ADR-107](./ADR-107-sky-godrays-volumetric.md) | 天空体积光束 god rays（日出/日落） | ✅ 已采纳 |
| [ADR-106](./ADR-106-preview-env-menu-drill-visual.md) | 3D 预览环境菜单两级下钻与可视化控件扩展 | ✅ 已采纳 |
| [ADR-105](./ADR-105-subtype-self-describing.md) | subtype 完整自描述化：零继承识别单元（MMD 落地，光影包预留） | ✅ 已采纳 |
| [ADR-104](./ADR-104-resource-subtype-layer.md) | 资源类型子类层（subtypes）统一：大类/小类/防御性检验三层架构 | ✅ 已采纳 |
| [ADR-103](./ADR-103-registry-load-single-source.md) | 注册表加载单源化与僵尸覆盖分支清理 | ✅ 已采纳 |
| [ADR-102](./ADR-102-cli-embedded-return-diagnostic-platform.md) | CLI 内嵌模式回归与诊断协同平台 | ✅ 已采纳 |
| [ADR-101](./ADR-101-mmd-loading-perf.md) | MMD 场景加载性能分析与优化方向 | ✅ 已采纳 |
| [ADR-100](./ADR-100-ysm-bone-animation.md) | YSM 骨骼动画播放——L1 基础播放 | ✅ 已采纳 |
| [ADR-099](./ADR-099-3d-scenecapability-cap-tab-ssr.md) | 3D 预览 SceneCapability 注册表架构与能力分层（九 cap 接入、顶层五 tab 菜单映射、反射模式三档 SSR 闭环） | ✅ 已采纳 |
| [ADR-098](./ADR-098-3d-preview-perf.md) | 3D 预览性能优化——纹理复用 + 视锥裁剪 + 按需更新 | ✅ 已采纳 |
| [ADR-097](./ADR-097-scene-capability-registry.md) | 3D SceneCapability 注册表 + 模型切换复用架构 | ✅ 已采纳 |
| [ADR-096](./ADR-096-global-storage-hierarchy.md) | 全局库存储分层规范：MMD 子目录三链路消费 | ✅ 已采纳 |
| [ADR-095](./ADR-095-open-folder-installdir.md) | OpenInstanceFolder 打开资源存储目录而非模组扫描目录 | ✅ 已采纳 |
| [ADR-094](./ADR-094-mmd-subdir-position-routing.md) | MMD 子类型位置路由：3d-skin 目录层级优先于扩展名 | ✅ 已采纳 |
| [ADR-093](./ADR-093-multi-model-scene-core.md) | 多模型同框引擎核心（注册表/dispatch/相机累加/路由接缝/上限） | ✅ 已采纳 |
| [ADR-092](./ADR-092-resource-type-group-routing.md) | 资源类型分组（Group）分层路由：Minecraft / Minecraft-Mod / MMD 总目录归并 | ✅ 已采纳 |
| [ADR-091](./ADR-091-v2-2026-08-17.md) | 架构债务总览 v2（2026-08-17 并发审计） | ✅ 已采纳 |
| [ADR-090](./ADR-090-vitest-env-optimization.md) | vitest 环境切换与 npm 三件套并行优化 | ✅ 已采纳 |
| [ADR-089](./ADR-089-test-env-split-continued.md) | 测试环境切分持续推进：慢测试定位与 node 环境甄别 | ✅ 已采纳 |
| [ADR-088](./ADR-088-parallel-dispatch.md) | 检查体系并行调度——pre-push-gate 域间并行 + 静态工具分组 + pre-commit gen 并行 | ✅ 已采纳 |
| [ADR-087](./ADR-087-ai-automation-takeq.md) | AI 自动化取巧——pre-commit 智能 stage 与无脑指令下沉 | ✅ 已采纳 |
| [ADR-086](./ADR-086-check-system-reduction.md) | 检查体系减负与赋能决策表 | ✅ 已采纳 |
| [ADR-085](./ADR-085-menu-single-source.md) | 3D 预览菜单单一事实来源：注册表驱动 + 状态单向流 | ✅ 已采纳 |
| [ADR-084](./ADR-084-personal-lighting.md) | 个人灯光系统（Personal Lighting）——三点布光 + 聚光灯 + 体积光双引擎 | ✅ 已采纳 |
| [ADR-083](./ADR-083-semantic-layer.md) | 语义层双抽象——跨格式语义骨骼 + 语义 morph + 感知层程序化生命力 | ✅ 已采纳 |
| [ADR-082](./ADR-082-zipentries-any-fingerprint.md) | 材质包识别长治久安：zipEntries 任意层级指纹（any 模式）+ detector 容器统一 | ✅ 已采纳 |
| [ADR-081](./ADR-081-semantic-bone-layer.md) | 语义骨骼层——跨格式语义骨骼统一抽象 | ✅ 已采纳 |
| [ADR-080](./ADR-080-pack-model-adapter.md) | 资源包 block/item 模型 JSON 解析与渲染（PackModelAdapter） | ✅ 已采纳 |
| [ADR-079](./ADR-079-wasm-pthread-mt-decode.md) | WASM pthread 多线程解码：三端 COOP/COEP 注入 + 重编译上游 | ✅ 已采纳 |
| [ADR-076](./ADR-076-preview-bottom-nav-shell.md) | 3D 预览通用导航与弹窗脚手架收敛契约（v3 — 声明式根菜单 + 适配器项收编） | ✅ 已采纳 ⚠️ 被 [ADR-079] |
| [ADR-075](./ADR-075-preview-bottom-nav-environment-menu.md) | 3D 预览环境控件收进环境菜单契约 | ✅ 已采纳 |
| [ADR-074](./ADR-074-bone-hierarchy-toolkit.md) | 3D 骨骼层级通用工具：统一 YSM/MMD/VRM 的骨骼列表·拾取·显隐 | ✅ 已采纳 |
| [ADR-073](./ADR-073-federal-render-caps.md) | 联邦 3D 渲染能力共享策略（程序化天空为首个落地能力） | ✅ 已采纳 |
| [ADR-072](./ADR-072-3d-organization-adapter-sink.md) | 3D 代码归置与预览派发注册表化：适配器下沉 utils/3d/adapters | ✅ 已采纳 |
| [ADR-071](./ADR-071-web-capability-boundary-7z-community.md) | 网页版能力边界：.7z 明确不支持 + 社区站点编辑保存补齐 | ✅ 已采纳 |
| [ADR-070](./ADR-070-web-voxel-3d-ts-port.md) | 网页版体素 3D：蓝图/投影预览 TS 平移 voxel 解析 | ✅ 已采纳 |
| [ADR-069](./ADR-069-container-archive-unification.md) | 内容识别统一：ysm 作为解密容器参与 zip/7z 指纹匹配 | ✅ 已采纳 |
| [ADR-068](./ADR-068-container-reader-abstraction.md) | 统一容器桥接层：ContainerReader 抽象收敛 ysm/geometry/avatar 解包重复 | ✅ 已采纳 |
| [ADR-067](./ADR-067-zip-packaged-resource-detection.md) | zip 化资源识别：扩展名歧义消解与内容指纹覆盖 | ✅ 已采纳 |
| [ADR-066](./ADR-066-universal-resource-preview.md) | 全资源预览器：统一预览契约与注册表驱动分发 | ✅ 已采纳 |
| [ADR-065](./ADR-065-instance-rtype-registry-single-source.md) | 整合包侧资源类型语义收敛：rtype 分支注册表驱动单点 | ✅ 已采纳 |
| [ADR-064](./ADR-064-sync-convergence-scanner-single-source.md) | 同步层对比收敛：scanner 单一扫描源，对比实现单点化 | ✅ 已采纳 |
| [ADR-063](./ADR-063-updater-semver-semantics.md) | updater 版本比较语义化：semver 库接入替代手写比较 | ✅ 已采纳 |
| [ADR-062](./ADR-062-appconfig-configurable-thresholds.md) | AppConfig 可配置化下沉：运行阈值与检查间隔从常量收敛为配置项 | ✅ 已采纳 |
| [ADR-061](./ADR-061-3d.md) | 3D 渲染器能力边界与后续方向 | ✅ 已采纳 |
| [ADR-060](./ADR-060-dnd-component-scoped-registration.md) | 拖拽导入收敛：按组件域注册，去掉全局遮罩 | ✅ 已采纳 |
| [ADR-059](./ADR-059-cli-removal-standalone-exe.md) | CLI 移除与裸 exe 发布 | ✅ 已采纳 |
| [ADR-058](./ADR-058-standalone-exe-embedded-data.md) | 纯 exe 发布模型：数据编译期内嵌 | ✅ 已采纳 |
| [ADR-057](./ADR-057-3d-preview-fab-responsive.md) | 3D 预览悬浮触发按钮与双端响应式控制层 | ✅ 已采纳 |
| [ADR-056](./ADR-056-shared-install-lock.md) | 共享单锁：安装/同步/回收去重并发互斥 | ✅ 已采纳 |
| [ADR-055](./ADR-055-redlines-content-baseline.md) | 红线门禁行号不敏感比对 | ✅ 已采纳 |
| [ADR-054](./ADR-054-test-perf-governance.md) | 测试性能治理：fixtures 裁剪与 vitest 环境分流 | ✅ 已采纳 |
| [ADR-053](./ADR-053-web-bridge-boundary.md) | 网页版桥接能力边界（ADR-049 增强 B1–B3 收尾） | ✅ 已采纳 |
| [ADR-052](./ADR-052-render-session-objectification.md) | RenderSession 对象化：model3d 场景状态收敛与回调方法化 | ✅ 已采纳 |
| [ADR-051](./ADR-051-error-classification-single-source.md) | 错误分类单一事实来源：结构化错误码替代双份文本匹配表 | ✅ 已采纳 |
| [ADR-049](./ADR-049-web-edition-bridge.md) | 网页版（Web 端）桥接：backend 适配器 + IndexedDB 模型库 | ✅ 已采纳 |
| [ADR-048](./ADR-048-ci-workflow-split-cache.md) | CI 工作流架构：双 workflow 拆分 + 可复用测试门禁 + 三层缓存 + 版本单点 | ✅ 已采纳 |
| [ADR-047](./ADR-047-android-usability-plan.md) | Android 可用性落地规划：触屏交互 + FileAccessor 抽象（ADR-046 P2 实施） | ✅ 已采纳 |
| [ADR-046](./ADR-046-cross-platform-feasibility.md) | 全平台化可行性调查（对照 MikuMikuAR） | ✅ 已采纳 |
| [ADR-045](./ADR-045-i18n-framework.md) | 前端 i18n 轻量框架 | ✅ 已采纳 ⚠️ 被 [ADR-124] |
| [ADR-044](./ADR-044-code-writing-governance.md) | 代码写法治理范式：31 批审核反推的系统性不足与收敛策略 | ✅ 已采纳 |
| [ADR-043](./ADR-043-check-scripts-fail-closed-contract.md) | 检查脚本 fail-closed 三态契约（扫描不完整必须显式暴露，禁止假绿） | ✅ 已采纳 |
| [ADR-042](./ADR-042-modernysm-pivot-rotation.md) | 渲染复现借鉴上游 ModernYSM：二进制直读 pivot/rotation 与动画纯计算移植 | ✅ 已采纳 |
| [ADR-041](./ADR-041-spec-render-alignment.md) | 渲染对齐：Go spec 对齐 YSMViewer（C# ThreeJsPayloadBuilder） | ✅ 已采纳 |
| [ADR-040](./ADR-040-architecture-scale-governance.md) | 架构规模治理——前端大文件拆分与 internal 下沉收口 | ✅ 已采纳 |
| [ADR-039](./ADR-039-audit-remaining-decisions.md) | 两轮功能审核后的遗留决策项与处置方向 | ✅ 已采纳 |
| [ADR-038](./ADR-038-ysm-folder-model-contract.md) | YSM 文件夹模型统一契约：ysm.json 单一入口与整组操作 | ✅ 已采纳 |
| [ADR-037](./ADR-037-e2e-introduction.md) | E2E 测试引入（Playwright + vite dev 纯前端模式） | ✅ 已采纳 |
| [ADR-036](./ADR-036-3d-op-keymap.md) | 3D 预览操作键位与相机偏好可配置 | ✅ 已采纳 |
| [ADR-035](./ADR-035-forward-governance-initiatives.md) | 远期治理立项：组件测试与 CI 门槛 | ✅ 已采纳 |
| [ADR-034](./ADR-034-remaining-debt-after-12-round-audit.md) | 12 轮审计后的剩余技术债盘点与处置方向 | ✅ 已采纳 |
| [ADR-033](./ADR-033-updater-download-truncation-version-compare.md) | 更新包下载截断检测与版本比较加固 | ✅ 已采纳 |
| [ADR-032](./ADR-032-sync-diff-detection-failure-visibility.md) | 同步差异检测与失败可见性加固 | ✅ 已采纳 |
| [ADR-031](./ADR-031-watcher-lifecycle-sync-serialization.md) | 文件监听生命周期与同步串行化加固 | ✅ 已采纳 |
| [ADR-030](./ADR-030-backend-robustness-contract.md) | 后端持久化与健壮性契约 | ✅ 已采纳 |
| [ADR-029](./ADR-029-ysmparser-wasm-embed.md) | YSMParser 解码架构：WASM 内嵌取代 sidecar EXE | ✅ 已采纳 |
| [ADR-028](./ADR-028-installer-atomic-link-relink.md) | 安装器链接模式原子替换与 relink 回滚保护 | ✅ 已采纳 |
| [ADR-027](./ADR-027-web-component-contract-normalization.md) | Web Component 对外契约规范化 | ✅ 已采纳 |
| [ADR-026](./ADR-026-ysm-parser-ethics-boundary.md) | YSM 解析器集成伦理边界 | ✅ 已采纳 |
| [ADR-025](./ADR-025-download-mirror-fallback.md) | 工坊下载镜像回退架构 | ✅ 已采纳 |
| [ADR-024](./ADR-024-multi-resource-federation.md) | 多资源类型联邦架构（ResourceAdapter + resource_types.json 注册表） | ✅ 已采纳 |
| [ADR-023](./ADR-023-test-framework.md) | 测试体系 | ✅ 已采纳 |
| [ADR-022](./ADR-022-vitepress-site.md) | VitePress 建站 | ✅ 已采纳 |
| [ADR-021](./ADR-021-declarative-menu-testing.md) | 前端声明式菜单自动化测试方案 | ✅ 已采纳 ⚠️ 被 [ADR-037] |
| [ADR-020](./ADR-020-script-toolchain.md) | 脚本体系 | ✅ 已采纳 |
| [ADR-019](./ADR-019-knowledge-base.md) | 知识卡体系 | ✅ 已采纳 |
| [ADR-018](./ADR-018-user-guide.md) | 用户指南体系 | ✅ 已采纳 |
| [ADR-017](./ADR-017-frontend-enhancement-backlog.md) | 前端增强待办决策 | ✅ 已采纳 |
| [ADR-016](./ADR-016-ui-experience-improvement.md) | 前端 UI 体验优化决策 | ✅ 已采纳 |
| [ADR-015](./ADR-015-unified-animation-system.md) | 前端统一动画系统设计决策 | ✅ 已采纳 |
| [ADR-014](./ADR-014-typescript-migration.md) | 前端 TypeScript 渐进迁移 | ✅ 已采纳 |
| [ADR-013](./ADR-013-governance-convergence.md) | 治理体系收敛 — 文档宪法对账与联邦基线对齐 | ✅ 已采纳 |
| [ADR-012](./ADR-012-binding-call-consistency.md) | Wails Binding 调用路径一致性 | ✅ 已采纳 |
| [ADR-011](./ADR-011-path-separator-inconsistency.md) | 前端路径拼接分隔符不一致 | ✅ 已采纳 |
| [ADR-010](./ADR-010-resource-type-literals.md) | 资源类型字面量硬编码治理 | ✅ 已采纳 |
| [ADR-008](./ADR-008-event-registration-pattern.md) | 事件注册位置与防重复规范 | ✅ 已采纳 |
| [ADR-007](./ADR-007-context-menu-structure.md) | 右键菜单代码组织决策 | ✅ 已采纳 |
| [ADR-006](./ADR-006-rename-strictness.md) | 重命名文件名格式约束决策 | ✅ 已采纳 |
| [ADR-005](./ADR-005-frontend-governance-rules.md) | 前端治理规则体系 | ✅ 已采纳 |
| [ADR-004](./ADR-004-3d-rendering-pipeline.md) | 3D 骨骼渲染管线与坐标系决策 | ✅ 已采纳 ⚠️ 被 [ADR-041] |
| [ADR-003](./ADR-003-logic-sinking.md) | 业务逻辑从 Binding 层下沉至纯 Go 包（Logic Sinking） | ✅ 已采纳 |
| [ADR-002](./ADR-002-project-health-assessment.md) | 项目全面评估与改进方向 | ✅ 已采纳 |
| [ADR-001](./ADR-001-wails3-migration.md) | 升级至 Wails 3 | ✅ 已采纳 |

### ❌ 已取代（2）

| ADR | 标题 | 状态 |
|-----|------|------|
| [ADR-077](./ADR-077-bottom-nav-shell-convergence.md) | 底部导航通用外壳收敛（D1+D3 落地） | ❌ 已取代 ⚠️ 被 [ADR-076] |
| [ADR-050](./ADR-050-plaza-browser-window.md) | 模型广场 · 浏览器窗口（Wails 第二窗口） | ❌ 已取代 |

## 登记表（新→旧）

| 编号 | 标题 | 状态 | 日期 |
|------|------|------|------|
| ADR-161 | 渲染会话词汇章程:spec 契约单一镜像 + 尺度词消歧(组件/模型/内容层/条目)+ built 黑话退役 | ✅ 已采纳 | 2026-09-02 |
| ADR-160 | 子实体统一为组件视图:GetModel3DSpec spec.models 唯一源 + 详情统计 = spec 投影(maid L0 清单退役) | ✅ 已采纳 | 2026-09-02 |
| ADR-159 | sceneRegistry 容器语义：displayName + components（资源包=实体、包内模型=组件） | ✅ 已采纳 | 2026-09-02 |
| ADR-158 | check-readme-index 增加描述过时断言（提及但说错可机检） | ✅ 已采纳 | 2026-09-02 |
| ADR-157 | 契约测试 TARGETS 宽哨兵收敛为精确文件清单 | ✅ 已采纳 | 2026-09-02 |
| ADR-156 | 契约测试按变更文件精确裁剪（scripts 改动不再全量） | ✅ 已采纳 | 2026-09-02 |
| ADR-155 | commit-with-check 重构为独立轻量提交校验（与重型 push 门禁解耦） | ✅ 已采纳 | 2026-09-02 |
| ADR-154 | Go-TS 解析层 golden 对拍（双端互锁契约） | ✅ 已采纳 | 2026-09-02 |
| ADR-153 | stats.worker WASM 资产条件加载——base / mt 双向动态 import | ✅ 已采纳 | 2026-09-02 |
| ADR-152 | gen-stage 并发卷带根除——快照变化 ∩ 非并行 dirty 判定（实证验收） | ✅ 已采纳 | 2026-09-01 |
| ADR-151 | commit-with-check 临时索引白名单提交：并发隔离取代裸 git commit | ✅ 已采纳 | 2026-09-01 |
| ADR-150 | pre-commit 兜底收窄：禁用 git add -u docs/ 吞并发漂移 (P2-2 加固) | ✅ 已采纳 | 2026-09-01 |
| ADR-149 | modal.ts 内联样式外提为弹窗类（dialogs.css） | ✅ 已采纳 | 2026-09-01 |
| ADR-148 | preview-3d 容器类适配器统一工厂(方案 C)决策方向 | ✅ 已采纳 | 2026-09-01 |
| ADR-147 | 移除 app-tree _typeFilter 死字段与自证测试 | ✅ 已采纳 | 2026-09-01 |
| ADR-146 | TS 路径别名与反桶契约 | ✅ 已采纳 | 2026-09-01 |
| ADR-145 | cli 解耦 app：消费方定义 AppService 接口 | ✅ 已采纳 | 2026-09-01 |
| ADR-144 | types 解耦 container：识别大脑下沉 packs | ✅ 已采纳 | 2026-09-01 |
| ADR-143 | 绑定返回值去 string-JSON 化（铲债决策） | ✅ 已采纳 | 2026-09-01 |
| ADR-142 | 缓存三通道统一：texture-cache 内存池 + 磁盘压缩分层 | ✅ 已采纳 | 2026-08-31 |
| ADR-141 | 大脚本拆分基线 | ✅ 已采纳 | 2026-08-31 |
| ADR-140 | Go 重复代码治理：文件内自重复三层判定与变体层不强制合并 | ✅ 已采纳 | 2026-08-31 |
| ADR-139 | 平台 shim 收敛 rustbridge 与 scanner 四 OS 重复 | 🔄 部分采纳 | 2026-08-31 |
| ADR-138 | preview-3d 上提 src/preview-3d（去 features 中间层） | ✅ 已采纳 | 2026-08-31 |
| ADR-137 | YSM 解码子系统归位（views/app-preview/decoder → features/preview-3d，第五刀） | ✅ 已采纳 | 2026-08-31 |
| ADR-136 | 截图/离屏渲染领域归位（views/app-preview → features/preview-3d，第四刀） | ✅ 已采纳 | 2026-08-31 |
| ADR-135 | Go 端 jscpd 重复代码检测与增量门禁 | ✅ 已采纳 | 2026-08-30 |
| ADR-134 | 将 containerTypeCache 包级全局收进组件（破隐藏耦合） | ✅ 已采纳 | 2026-08-30 |
| ADR-133 | 契约测试真实性：从存在性门禁升级为消费性校验 | ✅ 已采纳 | 2026-08-30 |
| ADR-132 | 多模型选择菜单原语（跨资源类型统一 select） | ✅ 已采纳 | 2026-08-29 |
| ADR-131 | 3D 渲染期统计提取（预览期统计与类型判定解耦） | ✅ 已采纳 | 2026-08-29 |
| ADR-130 | 整合包卡片拖拽导入：先入仓库再推送 | ✅ 已采纳 | 2026-08-29 |
| ADR-129 | 3D 预览领域根升格（utils/3d → features/preview-3d，修依赖倒置） | ✅ 已采纳 | 2026-08-29 |
| ADR-128 | 菜单导航图生成器与 e2e 选择器派生（声明式收口后的可验证性） | ✅ 已采纳 | 2026-08-29 |
| ADR-127 | 性能档位薄壳版——数据表 + 通用套用器（低/中/高/自定义） | ✅ 已采纳 | 2026-08-29 |
| ADR-126 | 3D 预览菜单声明式 Schema 终态——状态层泛化 + 面板 schema 化 + 可见性谓词化 + dockGroup 解耦 | ✅ 已采纳 | 2026-08-28 |
| ADR-125 | 3D 预览菜单统一：settingsState 横切状态层 + 单渲染器 + visible 规则 | ✅ 已采纳 | 2026-08-28 |
| ADR-124 | i18n 键名三段式规范 | ✅ 已采纳 ⚠️ 被 [ADR-045] | 2026-08-28 |
| ADR-123 | 跨环境降级策略统一 | ✅ 已采纳 | 2026-08-27 |
| ADR-122 | MdMmBuildCtx 三档重构与 tier3 Builder 化否决 | 🔄 部分采纳 | 2026-08-26 |
| ADR-121 | Shadow DOM 样式隔离铁律 | ✅ 已采纳 | 2026-08-24 |
| ADR-120 | Go/Rust 共享已扫描状态：manifest 注入跳过 jwalk | ✅ 已采纳 | 2026-08-24 |
| ADR-119 | dedup 并行化：共享并行哈希管道（串行收集+并行哈希+序号还原） | ✅ 已采纳 | 2026-08-24 |
| ADR-118 | 面级透明分类：mesh 级 alpha 误判数据与分阶段落地 | ✅ 已采纳 | 2026-08-23 |
| ADR-117 | 地面材质 spec 单一事实源 | ✅ 已采纳 | 2026-08-23 |
| ADR-116 | 前端 vs Go 职责红线：筛选/类型判定权威层归 Go | ✅ 已采纳 | 2026-08-23 |
| ADR-115 | 跨类型同台追加必须走 switchExternal 主门路由（➕ 三态行为契约见知识卡） | ✅ 已采纳 | 2026-08-23 |
| ADR-114 | 每组件独立纹理（perComponent Textures） | ✅ 已采纳 | 2026-08-22 |
| ADR-113 | YSM 骨骼动画 Molang 求值器与欧拉序修复（L4） | ✅ 已采纳 | 2026-08-22 |
| ADR-112 | FBX 格式接入与独立预览地基 | ✅ 已采纳 | 2026-08-21 |
| ADR-111 | variants 解耦——类别—格式分层，角色模型合并 PMX/VRM | ✅ 已采纳 | 2026-08-21 |
| ADR-110 | mod 依赖下沉注册表，消除 Go 硬编码 | ✅ 已采纳 | 2026-08-21 |
| ADR-108 | 相机取景包围盒计算策略 | ✅ 已采纳 | 2026-08-20 |
| ADR-107 | 天空体积光束 god rays（日出/日落） | ✅ 已采纳 | 2026-08-21 |
| ADR-106 | 3D 预览环境菜单两级下钻与可视化控件扩展 | ✅ 已采纳 | 2026-08-20 |
| ADR-105 | subtype 完整自描述化：零继承识别单元（MMD 落地，光影包预留） | ✅ 已采纳 | 2026-08-19 |
| ADR-104 | 资源类型子类层（subtypes）统一：大类/小类/防御性检验三层架构 | ✅ 已采纳 | 2026-08-19 |
| ADR-103 | 注册表加载单源化与僵尸覆盖分支清理 | ✅ 已采纳 | 2026-08-19 |
| ADR-102 | CLI 内嵌模式回归与诊断协同平台 | ✅ 已采纳 | 2026-08-19 |
| ADR-101 | MMD 场景加载性能分析与优化方向 | ✅ 已采纳 | 2026-08-18 |
| ADR-100 | YSM 骨骼动画播放——L1 基础播放 | ✅ 已采纳 | 2026-08-18 |
| ADR-099 | 3D 预览 SceneCapability 注册表架构与能力分层（九 cap 接入、顶层五 tab 菜单映射、反射模式三档 SSR 闭环） | ✅ 已采纳 | 2026-08-18 |
| ADR-098 | 3D 预览性能优化——纹理复用 + 视锥裁剪 + 按需更新 | ✅ 已采纳 | 2026-08-18 |
| ADR-097 | 3D SceneCapability 注册表 + 模型切换复用架构 | ✅ 已采纳 | 2026-08-18 |
| ADR-096 | 全局库存储分层规范：MMD 子目录三链路消费 | ✅ 已采纳 | 2026-08-18 |
| ADR-095 | OpenInstanceFolder 打开资源存储目录而非模组扫描目录 | ✅ 已采纳 | 2026-08-18 |
| ADR-094 | MMD 子类型位置路由：3d-skin 目录层级优先于扩展名 | ✅ 已采纳 | 2026-08-18 |
| ADR-093 | 多模型同框引擎核心（注册表/dispatch/相机累加/路由接缝/上限） | ✅ 已采纳 | 2026-08-18 |
| ADR-092 | 资源类型分组（Group）分层路由：Minecraft / Minecraft-Mod / MMD 总目录归并 | ✅ 已采纳 | 2026-08-18 |
| ADR-091 | 架构债务总览 v2（2026-08-17 并发审计） | ✅ 已采纳 | 2026-08-17 |
| ADR-090 | vitest 环境切换与 npm 三件套并行优化 | ✅ 已采纳 | 2026-08-17 |
| ADR-089 | 测试环境切分持续推进：慢测试定位与 node 环境甄别 | ✅ 已采纳 | 2026-08-17 |
| ADR-088 | 检查体系并行调度——pre-push-gate 域间并行 + 静态工具分组 + pre-commit gen 并行 | ✅ 已采纳 | 2026-08-17 |
| ADR-087 | AI 自动化取巧——pre-commit 智能 stage 与无脑指令下沉 | ✅ 已采纳 | 2026-08-17 |
| ADR-086 | 检查体系减负与赋能决策表 | ✅ 已采纳 | 2026-08-17 |
| ADR-085 | 3D 预览菜单单一事实来源：注册表驱动 + 状态单向流 | ✅ 已采纳 | 2026-08-16 |
| ADR-084 | 个人灯光系统（Personal Lighting）——三点布光 + 聚光灯 + 体积光双引擎 | ✅ 已采纳 | 2026-08-16 |
| ADR-083 | 语义层双抽象——跨格式语义骨骼 + 语义 morph + 感知层程序化生命力 | ✅ 已采纳 | 2026-08-17 |
| ADR-082 | 材质包识别长治久安：zipEntries 任意层级指纹（any 模式）+ detector 容器统一 | ✅ 已采纳 | 2026-08-16 |
| ADR-081 | 语义骨骼层——跨格式语义骨骼统一抽象 | ✅ 已采纳 | 2026-08-17 |
| ADR-080 | 资源包 block/item 模型 JSON 解析与渲染（PackModelAdapter） | ✅ 已采纳 | 2026-08-16 |
| ADR-079 | WASM pthread 多线程解码：三端 COOP/COEP 注入 + 重编译上游 | ✅ 已采纳 | 2026-08-16 |
| ADR-077 | 底部导航通用外壳收敛（D1+D3 落地） | ❌ 已取代 ⚠️ 被 [ADR-076] | 2026-08-16 |
| ADR-076 | 3D 预览通用导航与弹窗脚手架收敛契约（v3 — 声明式根菜单 + 适配器项收编） | ✅ 已采纳 ⚠️ 被 [ADR-079] | 2026-08-16 |
| ADR-075 | 3D 预览环境控件收进环境菜单契约 | ✅ 已采纳 | 2026-08-16 |
| ADR-074 | 3D 骨骼层级通用工具：统一 YSM/MMD/VRM 的骨骼列表·拾取·显隐 | ✅ 已采纳 | 2026-08-16 |
| ADR-073 | 联邦 3D 渲染能力共享策略（程序化天空为首个落地能力） | ✅ 已采纳 | 2026-08-16 |
| ADR-072 | 3D 代码归置与预览派发注册表化：适配器下沉 utils/3d/adapters | ✅ 已采纳 | 2026-08-16 |
| ADR-071 | 网页版能力边界：.7z 明确不支持 + 社区站点编辑保存补齐 | ✅ 已采纳 | 2026-08-16 |
| ADR-070 | 网页版体素 3D：蓝图/投影预览 TS 平移 voxel 解析 | ✅ 已采纳 | 2026-08-16 |
| ADR-069 | 内容识别统一：ysm 作为解密容器参与 zip/7z 指纹匹配 | ✅ 已采纳 | 2026-08-16 |
| ADR-068 | 统一容器桥接层：ContainerReader 抽象收敛 ysm/geometry/avatar 解包重复 | ✅ 已采纳 | 2026-08-16 |
| ADR-067 | zip 化资源识别：扩展名歧义消解与内容指纹覆盖 | ✅ 已采纳 | 2026-08-16 |
| ADR-066 | 全资源预览器：统一预览契约与注册表驱动分发 | ✅ 已采纳 | 2026-08-16 |
| ADR-065 | 整合包侧资源类型语义收敛：rtype 分支注册表驱动单点 | ✅ 已采纳 | 2026-08-15 |
| ADR-064 | 同步层对比收敛：scanner 单一扫描源，对比实现单点化 | ✅ 已采纳 | 2026-08-15 |
| ADR-063 | updater 版本比较语义化：semver 库接入替代手写比较 | ✅ 已采纳 | 2026-08-15 |
| ADR-062 | AppConfig 可配置化下沉：运行阈值与检查间隔从常量收敛为配置项 | ✅ 已采纳 | 2026-08-15 |
| ADR-061 | 3D 渲染器能力边界与后续方向 | ✅ 已采纳 | 2026-08-14 |
| ADR-060 | 拖拽导入收敛：按组件域注册，去掉全局遮罩 | ✅ 已采纳 | 2026-08-14 |
| ADR-059 | CLI 移除与裸 exe 发布 | ✅ 已采纳 | 2026-08-14 |
| ADR-058 | 纯 exe 发布模型：数据编译期内嵌 | ✅ 已采纳 | 2026-08-14 |
| ADR-057 | 3D 预览悬浮触发按钮与双端响应式控制层 | ✅ 已采纳 | 2026-08-13 |
| ADR-056 | 共享单锁：安装/同步/回收去重并发互斥 | ✅ 已采纳 | 2026-08-13 |
| ADR-055 | 红线门禁行号不敏感比对 | ✅ 已采纳 | 2026-08-12 |
| ADR-054 | 测试性能治理：fixtures 裁剪与 vitest 环境分流 | ✅ 已采纳 | 2026-08-12 |
| ADR-053 | 网页版桥接能力边界（ADR-049 增强 B1–B3 收尾） | ✅ 已采纳 | 2026-08-12 |
| ADR-052 | RenderSession 对象化：model3d 场景状态收敛与回调方法化 | ✅ 已采纳 | 2026-08-11 |
| ADR-051 | 错误分类单一事实来源：结构化错误码替代双份文本匹配表 | ✅ 已采纳 | 2026-08-11 |
| ADR-050 | 模型广场 · 浏览器窗口（Wails 第二窗口） | ❌ 已取代 | 2026-08-11 |
| ADR-049 | 网页版（Web 端）桥接：backend 适配器 + IndexedDB 模型库 | ✅ 已采纳 | 2026-08-10 |
| ADR-048 | CI 工作流架构：双 workflow 拆分 + 可复用测试门禁 + 三层缓存 + 版本单点 | ✅ 已采纳 | 2026-08-10 |
| ADR-047 | Android 可用性落地规划：触屏交互 + FileAccessor 抽象（ADR-046 P2 实施） | ✅ 已采纳 | 2026-08-09 |
| ADR-046 | 全平台化可行性调查（对照 MikuMikuAR） | ✅ 已采纳 | 2026-08-09 |
| ADR-045 | 前端 i18n 轻量框架 | ✅ 已采纳 ⚠️ 被 [ADR-124] | 2026-08-09 |
| ADR-044 | 代码写法治理范式：31 批审核反推的系统性不足与收敛策略 | ✅ 已采纳 | 2026-08-09 |
| ADR-043 | 检查脚本 fail-closed 三态契约（扫描不完整必须显式暴露，禁止假绿） | ✅ 已采纳 | 2026-08-09 |
| ADR-042 | 渲染复现借鉴上游 ModernYSM：二进制直读 pivot/rotation 与动画纯计算移植 | ✅ 已采纳 | 2026-08-09 |
| ADR-041 | 渲染对齐：Go spec 对齐 YSMViewer（C# ThreeJsPayloadBuilder） | ✅ 已采纳 | 2026-08-08 |
| ADR-040 | 架构规模治理——前端大文件拆分与 internal 下沉收口 | ✅ 已采纳 | 2026-08-06 |
| ADR-039 | 两轮功能审核后的遗留决策项与处置方向 | ✅ 已采纳 | 2026-08-06 |
| ADR-038 | YSM 文件夹模型统一契约：ysm.json 单一入口与整组操作 | ✅ 已采纳 | 2026-08-05 |
| ADR-037 | E2E 测试引入（Playwright + vite dev 纯前端模式） | ✅ 已采纳 | 2026-08-04 |
| ADR-036 | 3D 预览操作键位与相机偏好可配置 | ✅ 已采纳 | 2026-08-04 |
| ADR-035 | 远期治理立项：组件测试与 CI 门槛 | ✅ 已采纳 | 2026-08-04 |
| ADR-034 | 12 轮审计后的剩余技术债盘点与处置方向 | ✅ 已采纳 | 2026-08-04 |
| ADR-033 | 更新包下载截断检测与版本比较加固 | ✅ 已采纳 | 2026-08-04 |
| ADR-032 | 同步差异检测与失败可见性加固 | ✅ 已采纳 | 2026-08-04 |
| ADR-031 | 文件监听生命周期与同步串行化加固 | ✅ 已采纳 | 2026-08-04 |
| ADR-030 | 后端持久化与健壮性契约 | ✅ 已采纳 | 2026-08-04 |
| ADR-029 | YSMParser 解码架构：WASM 内嵌取代 sidecar EXE | ✅ 已采纳 | 2026-08-04 |
| ADR-028 | 安装器链接模式原子替换与 relink 回滚保护 | ✅ 已采纳 | 2026-08-04 |
| ADR-027 | Web Component 对外契约规范化 | ✅ 已采纳 | 2026-08-04 |
| ADR-026 | YSM 解析器集成伦理边界 | ✅ 已采纳 | 2026-08-04（原决策 2026-06-07） |
| ADR-025 | 工坊下载镜像回退架构 | ✅ 已采纳 | 2026-08-04（原方案 2026-06-06 定稿） |
| ADR-024 | 多资源类型联邦架构（ResourceAdapter + resource_types.json 注册表） | ✅ 已采纳 | 2026-08-04（决策时间线：联邦愿景 2025-06-07 起草 / P7 多资源计划 2026-06-10 定稿 / 注册表现行落地） |
| ADR-023 | 测试体系 | ✅ 已采纳 | 2026-08-03（初定），2026-08-04（L3 落地 + 覆盖率基线 + 进门禁/CI + 阈值红线 + 补测报告脚本） |
| ADR-022 | VitePress 建站 | ✅ 已采纳 | 2026-08-03 |
| ADR-021 | 前端声明式菜单自动化测试方案 | ✅ 已采纳 ⚠️ 被 [ADR-037] | 2026-08-03 |
| ADR-020 | 脚本体系 | ✅ 已采纳 | 2026-08-03 |
| ADR-019 | 知识卡体系 | ✅ 已采纳 | 2026-08-03 |
| ADR-018 | 用户指南体系 | ✅ 已采纳 | 2026-08-03 |
| ADR-017 | 前端增强待办决策 | ✅ 已采纳 | 2026-08-03 |
| ADR-016 | 前端 UI 体验优化决策 | ✅ 已采纳 | 2026-08-03（初定，决策时间线 2026-06-16） |
| ADR-015 | 前端统一动画系统设计决策 | ✅ 已采纳 | 2026-08-03（初定，决策时间线 v1.7.6） |
| ADR-014 | 前端 TypeScript 渐进迁移 | ✅ 已采纳 | 2026-08-03 |
| ADR-013 | 治理体系收敛 — 文档宪法对账与联邦基线对齐 | ✅ 已采纳 | 2026-08-03 |
| ADR-012 | Wails Binding 调用路径一致性 | ✅ 已采纳 | 2026-08-03 |
| ADR-011 | 前端路径拼接分隔符不一致 | ✅ 已采纳 | 2026-08-03 |
| ADR-010 | 资源类型字面量硬编码治理 | ✅ 已采纳 | 2026-08-03 |
| ADR-008 | 事件注册位置与防重复规范 | ✅ 已采纳 | 2026-08-03 |
| ADR-007 | 右键菜单代码组织决策 | ✅ 已采纳 | 2026-08-03 |
| ADR-006 | 重命名文件名格式约束决策 | ✅ 已采纳 | 2026-08-03 |
| ADR-005 | 前端治理规则体系 | ✅ 已采纳 | 2026-08-03（初定，规则时间线 v1.5.1 → 持续维护） |
| ADR-004 | 3D 骨骼渲染管线与坐标系决策 | ✅ 已采纳 ⚠️ 被 [ADR-041] | 2026-08-03（初定，决策时间线 v1.5.1 → v1.8.7） |
| ADR-003 | 业务逻辑从 Binding 层下沉至纯 Go 包（Logic Sinking） | ✅ 已采纳 | 2026-08-03（初定），原方案记录于 2026-06-16 |
| ADR-002 | 项目全面评估与改进方向 | ✅ 已采纳 | 2026-08-03 |
| ADR-001 | 升级至 Wails 3 | ✅ 已采纳 | 2026-07-14 |

## 使用规则（硬约束）

1. **编号**：取本表最大编号 +1（三位，如 `ADR-014`），禁止 `ADR-000N` 式前缀，禁止跳号复用。
2. **占号**：写文件**前**先在本表登记占号（并提交登记），再创建文件——多会话并行时以登记顺序为准，撞号者必须让位改号。
3. **命名**：文件名 `ADR-NNN-kebab-case.md`（如 `ADR-013-governance-convergence.md`）。
4. **必填字段**：状态 / 日期 / 决策人 / 相关；正文结构：背景（Context）→ 决策（Decision）→ 后果（Consequences）→ 数据溯源。
5. **状态值**：`✅ 已采纳` / `🔄 部分采纳` / `🧊 已废弃` / `❌ 已取代` / `⚠️ 已采纳（违规或未修复，自动从文件首部识别）`。状态变更只改文件首部，本页由 `gen-docs-index.ts` 自动重写。取代关系用 `- **被取代**：[ADR-NNN] 取代` 独立行标注（`gen-adr-supersede.ts` 扫描）。
6. **新 ADR 落地后**：本页自动重写（改文件首部即可），无需手动同步；历史 `PROJECT_STATUS.md` 已冻结于 `docs/archive/`，不再维护。

---

*登记表由 `gen-docs-index.ts` 自动重写；一致性校验已接入：`node scripts/check-adr-health.ts`（状态值域 + 登记同步 + 技术债）+ `node scripts/check-doc-drift.ts`（编号连续性/漏登/幽灵）+ `node scripts/gen-adr-supersede.ts`（取代关系扫描）。*
