# Minecraft 客户端资源中枢 — 架构愿景

> 本文档于 P5 封板后起草（2025-06-07），记录将 YSM 模型管理器扩展为通用 Minecraft 资源管理平台的构想。

## 🎯 核心理念：联邦制，非帝国制

不试图用一套 UI 管理所有资源类型。而是每种资源类型是一个**自治联邦**，共享底层基础设施（文件系统抽象、事件总线、组件库），各自独立演进。

```
YSM 模型管理器                 Minecraft 资源中枢
┌─────────────────┐          ┌─────────────────────────┐
│ app-tree        │    →     │ app-tree (通用文件树)    │
│ sync (硬链接)   │    →     │ sync (通用同步层)       │
│ workshop        │    →     │ marketplace (市场)      │
│ installer       │    →     │ ResourceAdapter 体系    │
│ recycle         │          │ recycle                 │
└─────────────────┘          └─────────────────────────┘
```

## 🧱 ResourceAdapter 接口

每种资源类型实现一个 adapter，统一以下能力：

```typescript
interface ResourceAdapter {
  // 元数据
  id: string; // "ysm" | "resourcepack" | "mmd" | "shader"
  label: string; // "YSM 模型" | "材质包" | "MMD 动作"
  icon: string; // "🎨" | "🎭" | "💃"

  // 文件扫描
  scan(rootDir: string): ResourceEntry[];
  // 每个 entry: { name, path, size, type, meta }

  // 安装/同步
  install(entry: ResourceEntry, targetDir: string): void;
  uninstall(entry: ResourceEntry): void;

  // 预览
  preview(entry: ResourceEntry): PreviewResult;
  // 返回 { html?, imageUrl?, summary? }

  // 市场（可选）
  marketplace?: {
    sources: MarketSource[];
    fetchIndex(repo: string): Promise<ResourceEntry[]>;
  };
}
```

## 🗺️ 三阶段路线图

### Phase 1：侦察 — 不改现有结构，只加切换器

**目标**：验证"联邦制"在现有代码基上是否可行。

**改动量**：仅前端，~50 行。

1. 侧边栏加一个 `<select>` 资源类型切换器（模型 / 材质包 / 光影）
2. 切换时复用 `app-tree`，但调用不同的 `scan` 函数
3. 材质包扫描：读 `pack.png` + `pack.mcmeta`，在 `render.js` 里显示图标

**成功标准**：切到材质包模式时，能看到材质包列表和图标 ✅

### Phase 2：适配 — 写第一个 adapter

**目标**：证明 ResourceAdapter 接口设计合理。

**改动量**：新建 `adapters/resourcepack.js`，~80 行。

1. 实现 `scanResourcePacks(mcRoot)` — 扫描 `resourcepacks/` 目录
2. 解析每个 ZIP 内的 `pack.mcmeta` 获取名称和描述
3. 提取 `pack.png` 作为预览图
4. `app-tree/render.js` 判断 `type === "resourcepack"` 时显示材质包特有信息

**警告**：不要在 `app-tree` 里写 `if (type === "resourcepack")`，必须抽象到 adapter 的 `preview()` 方法里。

### Phase 3：联动 — 跨资源推荐

**目标**：在 YSM 模型详情页显示"推荐搭配的材质包"。

**改动量**：Go 端 ~30 行 + 前端 ~40 行。

1. 在 `app.go` 加一个 `GetRecommendedPacks(modelName)` 函数
2. 逻辑：从材质包名/描述中搜索模型文件名关键词
3. 预览面板加一个"推荐材质包"区域

## ⚠️ 跨资源类型操作铁律

```
禁止在 app-tree 里写 if (type === 'mmd')。
必须抽象成 ResourceAdapter.xxx() 调用，
否则代码会变成意大利面条。
```

## 🚫 明确不做的

1. **光影包 (Shaders)** — GLSL 代码调试是另一个维度的东西，`app-tree` 无法胜任
2. **Mod 管理** — 和 CurseForge/Modrinth 竞品正面冲突，且需要 JVM 知识
3. **世界存档管理** — 文件太大，同步逻辑完全不同

## 🥇 建议试点

**OptiFine 材质包** 作为第一个非 YSM 资源类型试点。理由：

- 本质是 ZIP 文件扫描，`app-tree` 几乎不用改
- `pack.png` 可以直接复用现有的预览图逻辑（文件名映射）
- 用户需求明确：装了 YSM 模型的人大概率也装材质包
- 风险极低：扫描只读，不改写文件系统
