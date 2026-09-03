# 架构演进摘要

> 基于 `docs/architecture.md`、`docs/adr/` 与近期文档提交历史整理。本文是架构变迁的可读摘要；当前事实源仍以 `docs/architecture.md` 与对应 ADR / 知识卡为准。

## 1. 从分散说明收敛到单一权威视图

`docs/architecture.md` 当前定位是 **YSM 模型管理器的系统架构基石文档 / 单一权威视图**。历史架构快照冻结在 `docs/archive/architecture.md`，ADR 则保留“决策方向与理由”，不再承载实施进度。

这反映了架构治理的一次收敛：

- 架构事实集中到 `docs/architecture.md`
- 决策沉淀到 `docs/adr/`
- 细节与漂移记录下沉到 `docs/knowledge/` 与自动生成物
- pre-commit / doctor 负责防止文档与源码漂移

## 2. 从工具目录升格为 3D 预览领域模块

早期 `utils/3d` 承担了 3D 预览的主要职责，但它是“工具目录里的领域子系统”。`ADR-129` 起，预览域开始升格为独立领域根：

- `utils/3d` → `features/preview-3d` → `frontend/src/preview-3d`
- 目录职责拆为 `menu`、`adapters`、`caps`、`state`、`perception`、`decoder`、`screenshot` 等
- 修掉状态层反向依赖适配器类型的依赖倒置
- 让 3D 预览从“工具集合”变成“有状态、有注册表、有适配器、有渲染能力的独立子系统”

后续 `ADR-136 / ADR-137 / ADR-138` 进一步把截图、离屏渲染、YSM 解码等能力归位到 `preview-3d` 体系，`architecture.md §14` 已记录为“3D 子系统归位 src/preview-3d”。

## 3. 从单模型预览扩展到会话化、容器化预览

预览架构的语义也在升级：

- `ADR-066`：建立统一预览核心 `mount-preview-core.ts`
- `ADR-073`：引入 8 类场景能力注册表
- `ADR-093`：支持多模型同框，`scene-registry.ts` 成为会话注册中心
- `ADR-159`：引入容器语义：**资源包 = 实体，包内模型 = 组件**

也就是说，预览层已经从“打开一个文件并渲染”演进为：

```text
资源 path → 模型 model → spec.models[i] 组件 → 3D 场景内容层 → sceneRegistry 条目
```

## 4. 从跨层黑话走向词汇章程

`ADR-161` 是当前架构治理的一个显著里程碑：

- `spec` 契约回到 Go JSON 作为唯一事实源
- 前端镜像类型不再另立第四套命名
- `built` / `allBuilt` / `getBuilt()` 等动词化黑话退役，统一收敛为 `content` 口径
- “组件 / 模型 / 内容层 / 注册条目”形成四级尺度词表
- “角色”在 3D 会话域收敛为“模型实例”

这反映项目已经从“靠作者记忆解释术语”进入“靠词表和契约降低跨层搜索成本”的阶段。

## 5. 平台架构从桌面单轨走向多轨适配

平台架构也完成了明显扩展：

- 桌面：Wails v3 + Go binding
- Android：Wails v3 + Java 桥 + 查看器模式
- 网页版：`browser-adapter.ts` + IndexedDB + GitHub Pages 静态托管
- iOS：仍待立项

共同点是：业务逻辑尽量集中在 Go 与前端统一预览域，平台差异通过 adapter / bridge / build tags 收敛，而不是每平台复制一套产品逻辑。

## 6. 总览判断

近期文档提交史显示，系统正在经历一次“架构成熟度跃迁”：

1. **文档层面**：从分散说明 → 单一权威视图
2. **目录层面**：从工具目录 → 领域模块
3. **预览层面**：从单模型渲染 → 会话化、容器化、多模型同框
4. **语义层面**：从黑话并存 → spec 契约 + 词汇章程
5. **平台层面**：从桌面应用 → 桌面 / Android / Web 多轨查看器与完整应用并存
6. **治理层面**：从人工维护 → 自动生成物 + ADR + 知识卡 + doctor 门禁

下一步可重点沉淀两类文档：

- `preview-3d` 数据流图：从资源路径到 sceneRegistry 内容层的完整链路
- 词汇章程配套清单：列出已退役黑话、替代词与 grep 锚点，防止新 AI 误读
