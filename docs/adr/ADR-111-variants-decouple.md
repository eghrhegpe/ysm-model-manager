# ADR-111：variants 解耦——类别—格式分层，角色模型合并 PMX/VRM

- **状态**：✅ 已采纳
- **日期**：2026-08-21
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-092` `ADR-094` `ADR-104` `ADR-110`

---

## 1. 背景（Context）

### 1.1 问题诊断

当前资源类型注册表把「文件格式」错当成了「资源类别」。典型症状：

| 维度 | EntityPlayer（PMX 模型） | vrm（VRM 模型） |
|---|---|---|
| 仓库侧 `storageSubDir` | `PMX` | `VRM` |
| 安装侧 `instanceDir` | `3d-skin` | `3d-skin` |
| 所需模组 | `mmdskin/mmd-skin` | `mmdskin` |
| 预览器 | mmd-adapter | vrm-adapter |

**三同（仓库/安装/模组）不同预览器**——上游 MC-MMD-rust 的 `ModelCatalogEntry.java` 把 `.pmx > .pmd > .vrm` 当格式优先级，角色/场景纯靠目录区分。VRM 在上游根本不是独立类型，它是角色模型目录里的一个格式变体。

### 1.2 当前冲突

- `.vrm` 被 3 个类型声明（EntityPlayer / SceneModel / vrm），`ExtBelongsTo` 返回多值
- EntityPlayer 和 vrm 的 `instanceDir` 都是 `3d-skin`，路径消歧**无法区分**二者
- `.vrm` 文件可能被 MMD 适配器（PMX 渲染器）错误打开
- 同步层 `.vrm` 在两次 `SyncResourcesDirLevel` 中重复出现
- 导航栏 EntityPlayer 和 vrm 各占一个 tab，UI 膨胀

### 1.3 上游证据

`ModelCatalogEntry.java` / `SceneModelCatalog.java`：玩家与场景模型扫描算法**完全同构**（子文件夹 → `.pmx` > `.pmd` > `.vrm` → 优先），模型是玩家还是场景**纯靠所在根目录区分，无类型字段**。

---

## 2. 决策（Decision）

### 2.1 合并 vrm → EntityPlayer

- 删除独立 `vrm` 资源类型
- EntityPlayer 的 `name` 改为「角色模型」
- `.vrm` 仅由 EntityPlayer 和 SceneModel 声明（从 3 个降为 2 个）
- `storageSubDir` 统一为 `PMX`（原 `mmd/VRM/` 仓库目录废弃）

### 2.2 引入 `variants` 字段

```jsonc
{
  "id": "EntityPlayer",
  "name": "角色模型",
  "extensions": [".pmx", ".pmd", ".vrm", ".zip"],
  "variants": [
    { "ext": ".pmx", "preview": "mmd" },
    { "ext": ".pmd", "preview": "mmd" },
    { "ext": ".vrm", "preview": "vrm" }
  ],
  // ...
}
```

- `variants` 是可选字段，声明类型内部的格式变体
- 每个 variant 带 `ext`（扩展名）和 `preview`（预览器 id）
- 未声明 variants 的类型行为不变（`preview` 字段兜底）

### 2.3 预览路由按 variants 分发

前端 3D 预览层查询 `variants` 字段，按文件扩展名分发到对应 adapter：
- `.pmx` / `.pmd` → mmd-adapter（@moeru/three-mmd）
- `.vrm` → vrm-adapter（@pixiv/three-vrm）

取代当前按 `rtype` 分发的方式（`RESOURCE_TYPES.MMD` → mmd / `RESOURCE_TYPES.VRM` → vrm）。

### 2.4 SceneModel 同步加 variants

SceneModel 也声明了 `.pmx/.pmd/.vrm`，同步加 variants（预览 key 用 `mmd-scene`——SceneModel variants 的 `preview` 值即 `mmd-scene`，与 EntityPlayer 的 `mmd` 区分场景模型渲染；注意顶层 `preview` 字段仍为 `"3d"`，勿混）：
```jsonc
"variants": [
  { "ext": ".pmx", "preview": "mmd-scene" },
  { "ext": ".pmd", "preview": "mmd-scene" },
  { "ext": ".vrm", "preview": "vrm" }
]
```

---

## 3. 后果（Consequences）

### 正面

- **消除歧义**：`.vrm` 不再被 3 个类型声明，路径消歧 + variants 预览路由双重保障
- **UI 简化**：导航栏 MMD 组从 9 个 tab 减为 8 个
- **同步简化**：`.vrm` 不再在两次 DirLevel 同步中重复
- **对齐上游**：与 MC-MMD-rust 的「目录区分 + 格式优先级」语义一致
- **可扩展**：未来新增格式（如 .fbx）只需加 variant，不需新建类型

### 负面 / 改动面

- **注册表 schema 变更**：`ResourceType` struct 加 `Variants` 字段
- **前端预览路由重构**：从按 rtype 分发改为按 variants 分发
- **存量迁移**：`mmd/VRM/` 仓库目录需合并到 `mmd/PMX/`
- **前端常量变更**：`RESOURCE_TYPES.VRM` 删除，`RESOURCE_TYPES.MMD` 改名为 `PLAYER`（或保留 `MMD`）

### 不动的部分

- **Scanner**：不按 rtype 过滤，不受影响
- **Importer**：`.vrm` 直接归属 EntityPlayer，无歧义
- **同步层逻辑**：`SyncResourcesDirLevel` 不变，只是调用次数减少

---

## 4. 实施分阶段

**范围边界**：阶段 C（存量迁移）未立项，不阻塞新数据写入——老目录需用户手动合并或迁移脚本处理。

- 阶段 A：schema + 注册表——`ResourceType` 加 `Variants []Variant`，`resource_types.json` 类别挂 variants，前端 `RESOURCE_TYPES` 同步调整。
- 阶段 B：预览路由重构——前端 3D 预览层按 variants 分发 adapter，删除 `RESOURCE_TYPES.VRM` 相关路由。

---

## 5. 数据溯源

- 来源：`upstream/MC-MMD-rust/common/src/main/java/com/shiroha/mmdskin/config/ModelCatalogEntry.java` → 结果：`.pmx > .pmd > .vrm` 格式优先级，目录区分角色/场景
- 来源：`go/types/extensions.go:222` `ExtBelongsTo` → 结果：`.vrm` 被 3 个类型声明
- 来源：`frontend/src/utils/resource/types.ts:238` `AMBIGUOUS_EXTS` → 结果：`.vrm` 是歧义扩展名，路径消歧无法区分（instanceDir 相同）
- 来源：`frontend/src/views/app-preview/preview-library.ts` → 结果：按 rtype 分发 adapter，`.vrm` 可能错误使用 MMD 适配器
