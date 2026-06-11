# P7 计划：多资源类型支持

> 日期: 2026-06-10
> 状态: 规划中

## 目标

将管理器从仅管理 YSM 模型扩展为通用 MC 资源管理器，支持材质包、光影包、MMD 模型、机械动力蓝图等 Minecraft 可加载的资源类型。

## 原则

1. **扩展名是硬边界** — 一个文件归一类，不跨类型
2. **`installDir` 模板化** — `{instance}` 动态替换，没有 `{instance}` 的就是全局资源
3. **`parser` 插件化** — 每种格式的元数据提取作为一个独立函数，不强制全部实现
4. **预览按能力降级** — 3D → 缩略图 → 文件名 → 无，不阻塞

## 注册表结构（`resource_types.json`）

```json
{
  "resourceTypes": [
    {
      "id": "ysm",
      "name": "YSM 模型",
      "icon": "🧱",
      "extensions": [".ysm"],
      "installDir": "versions/{instance}/ysm/",
      "instanceLevel": true,
      "preview": "3d",
      "parser": "ysm"
    },
    {
      "id": "resourcepack",
      "name": "材质包",
      "icon": "🎨",
      "extensions": [".zip"],
      "installDir": "resourcepacks/",
      "instanceLevel": false,
      "preview": "thumbnail",
      "parser": "mcmeta"
    },
    {
      "id": "shaderpack",
      "name": "光影包",
      "icon": "☀️",
      "extensions": [".zip"],
      "installDir": "shaderpacks/",
      "instanceLevel": false,
      "preview": "thumbnail",
      "parser": "txt"
    },
    {
      "id": "create_schematic",
      "name": "机械动力蓝图",
      "icon": "⚙️",
      "extensions": [".nbt"],
      "installDir": "schematics/",
      "instanceLevel": true,
      "preview": "none",
      "parser": null
    },
    {
      "id": "mmd_model",
      "name": "MMD 模型",
      "icon": "💃",
      "extensions": [".pmx", ".pmd", ".vmd"],
      "installDir": "versions/{instance}/mmd/",
      "instanceLevel": true,
      "preview": "none",
      "parser": null
    }
  ]
}
```

## 实施步骤

### 第一步：配置层（纯数据，不动架构）

- [ ] 新建 `resource_types.json`，定义当前支持的资源类型
- [ ] Go 端新增 `LoadResourceTypes()` 读取
- [ ] 前端缓存注册表

### 第二步：扫描通用化

- [ ] `ScanModelEntries` → `ScanResourceEntries`，按注册表识别类型
- [ ] 文件树按类型分组显示
- [ ] 扩展名白名单由注册表驱动

### 第三步：安装逻辑

- [ ] 根据类型选择目标目录（`installDir` 模板渲染）
- [ ] 全局资源直接放 `.minecraft/{dir}`，实例资源放 `versions/{instance}/{dir}`
- [ ] 整合包同步扩展到所有注册类型

### 第四步：预览（可选）

- [ ] 材质包读取 `pack.png` 缩略图
- [ ] 光影包读取 `README.md` 首行
- [ ] 其他类型暂仅显示文件名

## 不变的内容

- 回收站、去重、导入日志 — 完全通用，无需改动
- 创意工坊/GitHub 下载 — 只需加类型标记
- 仓库页「文件树 + 预览」布局 — 天然适配

## 图标系统

### 现状

整个前端使用 emoji 作为图标（如 `⬇️`、`📥`、`🗑️`），零依赖但存在：

- 跨平台渲染不一致（Windows 风格 vs macOS）
- 语义不够精确（`⬇️` 可能表示下载、安装、下拉）
- 不可着色（无法跟随 `currentColor` 主题）

### 方案：内联 SVG 图标库

在 `frontend/js/utils/icons.js` 中集中管理，每个图标是一个返回 SVG 字符串的函数：

```js
// 示例
export const ICONS = {
  download: `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M8 1a.75.75 0 0 1 .75.75v5.69l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 0 1 1.06-1.06L7.25 7.44V1.75A.75.75 0 0 1 8 1zM3.5 9a.75.75 0 0 1 .75.75v2.5c0 .138.112.25.25.25h7a.25.25 0 0 0 .25-.25v-2.5a.75.75 0 0 1 1.5 0v2.5A1.75 1.75 0 0 1 11.5 14h-7A1.75 1.75 0 0 1 2.75 12.25v-2.5A.75.75 0 0 1 3.5 9z"/></svg>`,
  install: `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M..."/></svg>`,
  delete: `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M..."/></svg>`,
  refresh: `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M..."/></svg>`,
  settings: `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M..."/></svg>`,
  // ...
};
```

### 使用方式

```js
import { ICONS } from "../utils/icons.js";
// 模板中
`${ICONS.download} 一键安装模型`;
```

### 迁移策略

1. [ ] 创建 `utils/icons.js`，先收录 10 个最常用图标
2. [ ] 逐步替换高频按钮的 emoji
3. [ ] 资源类型图标（`resource_types.json` 的 `icon` 字段）改用图标 key 而非 emoji
4. [ ] 旧 emoji 保留在新图标未覆盖的地方，不急一次性全换

### 好处

- 跨平台渲染完全一致
- `fill="currentColor"` 自动跟随主题色
- 大小统一控制（`width/height`）
- 无外部依赖，不增加包体积
