# 2026-06-09 复盘报告

**日期**：2026-06-09
**时长**：全天
**范围**：Go 后端 ~15 处修改，前端 ~30+ 文件改动
**构建次数**：大量
**发版**：v1.3.0 → v1.3.1 → v1.3.2（三连发）
tip：当时我们决定闭门造车，导入渲染路线选择错误，10轮对话都没搞定下来，所以没啥心情写日记。

---

## 一、三大主线

### 主线 1: 3D 渲染引擎翻修

**目标**：对齐 YSMViewer `ThreeJsPayloadBuilder.cs` 的渲染管线，修复多文件模型渲染错误。

| 问题              | 根因                                                 | 修复                                         |
| ----------------- | ---------------------------------------------------- | -------------------------------------------- |
| 同名骨骼层级错误  | RightArm 在两个文件中都有，后加载的覆盖了正确 parent | 同名骨骼**保留首次层级**，仅追加 cubes       |
| 手臂立方体偏移    | `pivots` 共享 map 被同名骨骼的第二次出现覆盖         | cube 计算使用**当前骨骼自身 pivot**          |
| 骨骼旋转丢失      | `Bone2D` 缺少 `Rotation` 字段                        | 新增 `Rotation [3]float64` + 四元数转换      |
| ZIP/7z 立方体丢失 | 合并时用 `seen` map 跳过同名骨骼                     | 全追加 + `threejs.Build()` 内去重            |
| 透明度渲染异常    | 透明纹理像素遮挡后面模型                             | `alphaTest: 0.5` + `transparent: true`       |
| UV 映射不正确     | `applyBoxUV` 算法与 YSMViewer 不一致                 | 改用 `expandBoxUV` + 自定义 `BufferGeometry` |
| 纹理过滤模糊      | Three.js 默认 `LinearFilter`                         | 强制 `NearestFilter`（像素风）               |

**波及文件**：

- `frontend/js/utils/model3d.js` — 重写 UV 映射、骨骼合并、材质
- `go/threejs/spec.go` — Go 端同步 JS 算法（bone dedup、rotation）
- `frontend/js/components/app-preview/utils.js` — `texSlot` 解析

### 主线 2: WASM 解码器集成

**目标**：将 YSMParser C++ 编译器编译为 WASM，前端直接解码 .ysm，不再依赖 sidecar exe。

| 组件            | 文件名                          | 说明                                        |
| --------------- | ------------------------------- | ------------------------------------------- |
| WASM 二进制     | `ysm-wasm-data.js`              | 编译后的 `.wasm` 经 base64 嵌入 JS          |
| 胶水代码        | `ysm-glue-data.js`              | Emscripten 生成的 JS 胶水代码               |
| 封装层          | `ysm-parser.js`                 | `decodeYsmFileFromMemory` + `decodeYsmFile` |
| Go CLI fallback | `app.go` → `runYSMParserOnFile` | WASM 失败时走 YSMParser.exe                 |
| 诊断工具        | `check_wasm.go`, `wasm_diag.go` | wazero 检测 WASM 导出函数                   |

**关键设计**：

- `Module.wasmBinary` 注入方式规避 WebView2 `fetch()` 限制
- 优先内存解析（`ysm_decode_from_memory`），回退 `callMain` + MEMFS
- base64 内嵌导致 WASM 加载慢（~500KB 解码 + 编译）

### 主线 3: CSS 工程化

**目标**：解决 Shadow DOM 样式隔离问题，将全局 CSS 迁移到 Web Component 内部。

- `frontend/css/components.css` — 大重构（~440 行变更）
- `content-css.js` — 动态注入 `adoptedStyleSheets`
- Shadow DOM 样式隔离 + `@import` 链修复

---

## 二、发版记录

| 版本   | 说明                                                     |
| ------ | -------------------------------------------------------- |
| v1.3.0 | 3D 渲染引擎翻修 + 多文件模型管线统一（草稿，未正式发布） |
| v1.3.1 | CSS 工程化 + Shadow DOM 样式隔离修复                     |
| v1.3.2 | 配置文件持久化修复 + 路径设置入口合并                    |

---

## 三、关键教训

### 1. 提交信息垃圾化

6月9日的提交信息全部是 `ssss` / `aaa` / `kk` / `aa`，毫无意义。这导致：

- 复盘时无法直接从 git log 判断改动意图
- 后续开发者（包括 AI）无法追踪历史

**教训**：提交信息必须写清楚改动内容。战斗手册已隐含此要求，但未显式规定。

### 2. WASM 内嵌的代价

base64 内嵌 WASM 二进制的方案（约 500KB）虽然规避了 WebView2 fetch 限制，但带来了：

- 每次初始化需 base64 解码（CPU 密集型）
- 浏览器 WASM 编译延迟
- 构建产物膨胀（JS 从 ~200KB 到 ~1.5MB）

后续在 6月10日 优化了 base64 解码 performance，但根本方案仍是 `.wasm` 独立文件 + `instantiateStreaming`。

### 3. 三连发版的节奏

一天内发布三个版本（v1.3.0 → v1.3.1 → v1.3.2），说明：

- 功能开发与发布混在一起
- 没有充分测试就发布了
- 每次发布修复/补充上一次的遗漏

**教训**：功能开发完成后应该集中测试一轮再发布，减少补丁版本。

---

## 四、架构决策

### 三路合并路径统一

WASM / CLI / ZIP-7z 三种模型来源统一使用"全追加骨骼 → threejs.Build() 内去重"策略。

**原因**：之前三种路径各有一套去重逻辑，行为不一致导致渲染结果不同。

### Shadow DOM + adoptedStyleSheets

选择 `adoptedStyleSheets` + `CSSStyleSheet` 而非 `<style>` 标签内联：

- 共享样式表，减少内存
- 避免 Shadow DOM 样式重复注入
- 支持动态替换

---

## 五、待办（6月9日遗留）

- [ ] WASM 加载优化（base64 解码 + 编译缓存）→ **6月10日已完成**
- [ ] CSS 全局样式缺失恢复 → **6月10日 v1.3.4 修复**
- [ ] mcRoot 配置保存修复 → **6月10日 v1.3.5 修复**
