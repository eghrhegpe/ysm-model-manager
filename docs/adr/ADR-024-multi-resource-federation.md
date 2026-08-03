# ADR-024: 多资源类型联邦架构（ResourceAdapter + resource_types.json 注册表）

- **状态**：✅ 已采纳
- **日期**：2026-08-04（决策时间线：联邦愿景 2025-06-07 起草 / P7 多资源计划 2026-06-10 定稿 / 注册表现行落地）
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`resource_types.json`（单一事实来源）/ `go/types/`（注册表运行时）/ `internal/app/resource_bindings.go` / 原 `docs/archive/vision.md` + `docs/archive/design/plan-p7-multi-resource.md`（已迁本 ADR）

---

> 决策真相源：本 ADR。原 `docs/archive/vision.md`（联邦愿景）与 `docs/archive/design/plan-p7-multi-resource.md`（P7 多资源计划）已于 2026-08-04 迁为本 ADR，原文降级为重定向 stub。

## 背景

管理器最初仅管理 YSM 模型。两篇早期文档提出将其扩展为通用 Minecraft 资源管理平台，但路径分歧：

1. **`vision.md`（2025-06-07，P5 封板后）** 提出「联邦制，非帝国制」——不试图用一套 UI 管理所有资源类型，而是每种资源类型是一个**自治联邦**，共享底层基础设施（文件系统抽象、事件总线、组件库），各自独立演进。
2. **`plan-p7-multi-resource.md`（2026-06-10）** 将上述愿景落地为具体的 `resource_types.json` 注册表结构与四项实施原则。

当前仓库已落地 `resource_types.json`（7 类资源）作为单一事实来源，扫描/安装/预览均注册表驱动，证明该决策已被采纳。本 ADR 将其固化为决策真相源。

## 决策

采用**联邦制资源架构**，核心约定如下：

### 1. 自治联邦，共享底座

每种资源类型是一个自治联邦，复用通用基础设施（文件树 `app-tree`、同步层、回收站、事件总线、组件库），各自演进扫描/安装/预览逻辑。

### 2. ResourceAdapter 体系

每种资源类型实现一个 adapter，统一能力接口（`scan` / `install` / `uninstall` / `preview` / 可选 `marketplace`）。通用组件**禁止**写 `if (type === 'mmd')` 之类的类型分支——必须抽象为 `adapter.xxx()` 调用，否则代码退化为意大利面条。

### 3. resource_types.json 注册表四原则

| 原则 | 含义 |
|------|------|
| **扩展名是硬边界** | 一个文件归一类，不跨类型 |
| **`installDir` 模板化** | `{instance}` 动态替换；无 `{instance}` 即全局资源 |
| **`parser` 插件化** | 每种格式元数据提取为独立函数，不强制全部实现 |
| **预览按能力降级** | 3D → 缩略图 → 文件名 → 无，不阻塞主流程 |

### 4. 图标系统决策

审视 emoji 图标（跨平台渲染不一致、语义不精确、不可着色跟随主题）后，决定建立**内联 SVG 图标库**（`fill="currentColor"` 跟随主题、大小统一、零依赖）。该子决策为渐进迁移，当前 `resource_types.json` 的 `icon` 字段仍用 emoji，SVG 化属后续项（见后果）。

### 5. 明确不做的（范围边界）

- **光影包 GLSL 调试** —— 另一维度，文件树无法胜任
- **Mod 管理** —— 与 CurseForge/Modrinth 竞品正面冲突，需 JVM 知识
- **世界存档管理** —— 文件过大，同步逻辑完全不同

**试点选择**：OptiFine 材质包作为第一个非 YSM 资源类型（ZIP 扫描、只读、风险极低）。

## 后果

### 正面

- ✅ 新增资源类型只需改 `resource_types.json` + 实现对应 adapter，**不改通用 UI**。
- ✅ 「跨资源类型操作铁律」从架构层杜绝意大利面条。
- ✅ 注册表驱动使扩展名白名单、installDir、preview 能力全部声明式配置，可测试。

### 负面 / 遗留

- ⚠️ **图标 SVG 化未完成**：决策确立内联 SVG 库方向，但 `resource_types.json` 的 `icon` 字段现仍为 emoji，迁移为开放项。
- ⚠️ 部分资源类型（如 `mmd-skin` / `vrchat-avatar` / `create-blueprint`）`preview: none`，仅显示文件名，未实现专用预览。
- 增添「新增类型须同步四处消费链」的一致性维护成本（由 `test_resource_schema.mjs` + `go/types/registry_test.go` 守护，见 `docs/architecture.md` §5）。

### 数据溯源

- `docs/archive/vision.md` —— 联邦制理念、ResourceAdapter 接口、跨资源操作铁律、明确不做清单、试点建议。
- `docs/archive/design/plan-p7-multi-resource.md` —— `resource_types.json` 注册表结构示例、四原则、图标系统方案与迁移策略。
- 现行实现：`resource_types.json`（7 类）、`go/types/resource.go` `LoadRegistry()`、`internal/app/resource_bindings.go:21` `LoadResourceTypes()`、`frontend/js/utils/extensions.ts`。
