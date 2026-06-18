# MmdSkin 模组分析

> 分析时间：2026-06-12
> 模组：MmdSkin by shiroha (MIT)
> 源码：https://github.com/shiroha-233/MC-MMD-rust
> Modrinth：https://modrinth.com/mod/mmdskin

---

## 目录结构

```
.minecraft/
└── 3d-skin/
    ├── EntityPlayer/       # 玩家模型
    │   ├── ModelA/         # 每个子文件夹 = 一个模型
    │   │   ├── model.pmx   # 模型文件 (.pmx/.pmd)
    │   │   ├── *.png       # 纹理贴图
    │   │   ├── dance.vmd   # 模型专属动作 (可选)
    │   │   └── smile.vpd   # 模型专属表情 (可选)
    │   └── ModelB/
    ├── DefaultAnim/        # 系统预设动作
    ├── CustomAnim/         # 用户自定义动作
    ├── DefaultMorph/       # 系统预设表情
    └── CustomMorph/        # 用户自定义表情
```

## 文件格式

| 类型 | 扩展名                            | 说明           |
| ---- | --------------------------------- | -------------- |
| 模型 | `.pmx` / `.pmd`                   | 必需，PMX 优先 |
| 纹理 | `.png` / `.jpg` / `.bmp` / `.tga` | 模型引用       |
| 动作 | `.vmd`                            | 可选，模型专属 |
| 表情 | `.vpd`                            | 可选，模型专属 |

## 模型发现规则

- 扫描 `EntityPlayer/` 下每个子文件夹
- 查找 `.pmx` 或 `.pmd` 文件
- 如果存在 `model.pmx` 或 `model.pmd`，优先使用
- 否则按字母顺序选第一个

---

## 与 YSM 的对比

| 维度     | YSM                          | MMD-Skin                           |
| -------- | ---------------------------- | ---------------------------------- |
| 文件形态 | 单文件 (`.ysm`)              | 文件夹 (模型+纹理+动作)            |
| 存放目录 | 仓库或 `versions/{ver}/ysm/` | `.minecraft/3d-skin/EntityPlayer/` |
| 预览     | 3D Three.js                  | PMX 渲染 (需独立引擎)              |
| 资源隔离 | 实例级                       | 全局                               |
| 社区分享 | Workshop 站点                | Aplaybox/Bowlroll                  |

## 集成方案评估

### 方案 A：作为新的资源类型（轻量）

```
resource_types.json:
  mmd-skin:
    extensions: [".pmx", ".pmd"]
    installDir: "3d-skin/EntityPlayer/"
    detector: "extension"
    actions: ["import", "delete", "openFolder"]
```

- 直接用 `<app-resource-manager>` 列表浏览
- 导入策略需要自定义（复制文件夹而非单文件）
- 没有预览（PMX 渲染需要 Rust/WASM 解析器，代价大）

### 方案 B：以 YSM 模型管理为蓝本，深度集成

- 参考 YSM 的仓库治理体系（去重/回收站/健康度）
- 新增 `3d-skin/` 目录的扫描和文件树
- 未来加 PMX 前端预览

### 方案 C：暂不实现，先稳固 YSM 基本盘

- 记录分析结果
- 等用户基数增长后再做

## 结论

目前建议走 **方案 C**——MMD-Skin 模型的文件夹结构（模型+纹理+动作分散在多个文件中）与我们现有的单文件管理体系差异较大，强行集成收益有限。先把 YSM 体验打磨到极致，等用户有明确需求再扩展。
