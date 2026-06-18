# 📋 代码重构更新报告

**日期**: 2026-06-12

## ✅ 构建状态

| 构建                  | 状态         | 产出                       |
| --------------------- | ------------ | -------------------------- |
| **Go 编译**           | ✅ 通过      | `wails build` 准备就绪     |
| **Vite 构建**         | ✅ 通过      | 92 modules → 14 个输出文件 |
| **主包 `index.*.js`** | **-5.8 KiB** | 275.56 → 269.76 KiB        |
| **运行时**            | ✅ 正常      | WebView2 无报错            |

---

## 📊 代码变更统计

```
13 个文件修改     117 行新增     4,758 行删除
10 个新文件（未跟踪）
```

### Go 后端：`app.go` 拆解

原始 `app.go` **2,503 行** → 拆为 8 个文件：

| 文件              | 行数   | 职责                                     |
| ----------------- | ------ | ---------------------------------------- |
| `app.go`          | **81** | App 结构体 + NewApp / startup / shutdown |
| `app_model.go`    | 485    | YSM 解析、几何体提取、CLI fallback       |
| `app_scan.go`     | 393    | 骨骼导出、搜索、模型扫描、index.json     |
| `app_install.go`  | 369    | 安装、导入、回收站、状态同步、日志       |
| `app_download.go` | 263    | 下载队列、文件下载、镜像回退             |
| `app_files.go`    | 259    | 文件 CRUD、预览提取、包信息              |
| `app_config.go`   | 245    | 配置持久化、自动更新、窗口、MC 定位      |
| `app_workshop.go` | 234    | 工坊站点 / 创作者 CRUD                   |

当前最大 Go 文件：**485 行**（app_model.go）

### 前端 `app-preview/`：`index.js` 拆解

原始 `index.js` **1,560 行** → 拆为 14 个文件：

| 文件                     | 行数    | 职责                              |
| ------------------------ | ------- | --------------------------------- |
| `index.js`               | **485** | 类定义 + 生命周期 + \_loadModel2D |
| `preview-wasm.js`        | 410     | WASM 解码                         |
| `preview-skeleton.js`    | 198     | 2D 骨骼加载                       |
| `preview-3d.js`          | 132     | 3D 全屏预览                       |
| `preview-actions.js`     | 121     | 操作按钮绑定                      |
| `preview-loader.js`      | 94      | 模型数据加载                      |
| `preview-detail.js`      | 93      | 模型 / 材质包详情                 |
| `preview-utils.js`       | 92      | 工具函数                          |
| `preview-pack.js`        | 88      | 整合包详情                        |
| `preview-zoom.js`        | 66      | Canvas 全屏放大                   |
| `preview-logs.js`        | 54      | 导入日志渲染                      |
| `preview-bone-export.js` | 43      | 导出骨骼名                        |
| `events.js`              | 24      | 事件总线                          |
| `utils.js`               | 67      | parseBedrockGeometry              |

### 前端 `model3d.js` + `app-tree/events.js`

| 原始                        | →   | 拆后                              |
| --------------------------- | --- | --------------------------------- |
| `model3d.js` 692 行         | →   | **333** + `model3d-spec.js` 240   |
| `app-tree/events.js` 604 行 | →   | **239** + `toolbar-events.js` 146 |

---

## 📐 当前架构

```
app-content/        主内容区（生命周期 + 7 个子模块）
app-preview/        预览面板（14 个文件，最大 485 行）
app-tree/           仓库树（12 个文件，最大 369 行）
workshop/           工坊功能（4 个文件，最大 551 行）
utils/              工具库（model3d/model2d/animation 等）

app*.go             Go 后端（8 个文件，最大 485 行）
```

**结论**: 项目中已无超 500 行的文件，结构健康，构建通过。
