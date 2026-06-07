# P6 开发计划 — 模型预览增强

## 概述

7 个特性围绕模型预览体验，按依赖关系和风险排序。目标是把模型预览从"能看"变成"好用"。

---

## 1️⃣ WASM 能力补齐（解同版本 .ysm）

| 项目     | 内容                                                                         |
| -------- | ---------------------------------------------------------------------------- |
| **目标** | 让嵌入式 WASM 能解码当前 CLI 支持的所有 .ysm 版本，彻底消除 exe sidecar 依赖 |
| **难度** | ⭐⭐⭐⭐ 极高                                                                |
| **预估** | 跨语言调试未知（可能是 zstd/crypto 库差异或 Emscripten 兼容性问题）          |

### 背景

当前 WASM 和 CLI 编译自**同一份源码**，但 WASM 报 `Unsupported file version`，CLI 正常。怀疑原因：

- Emscripten 的 zstd 库与原生实现有差异
- Emscripten 的 AES/crypto 库不完整
- Emscripten 文件系统（MEMFS）行为差异
- 编译参数（`-sSHRINK_LEVEL` 等）导致代码路径被裁剪

### 需要探索

1. 在 YSMParser 源码中加入 verbose 日志，打印文件头版本号 + 各步骤入/出口
2. 分别编译 Debug WASM（`-O0 -g4`）和 Release WASM，对比行为
3. 检查 Emscripten 的 `crypto` 库是否完整（`-sUSE_OPENSSL` 或 `-lcrypto`）
4. 考虑分叉 YSMParser 源码适配 WASM 编译

### 风险

- 高：可能涉及 C++ 第三方库的 Emscripten 端口问题
- WASM 目标如果走不通，可考虑 Go 端移植（用 Go 重写 YSM 解码）

---

## 2️⃣ 双解码去重（缓存 YSMParser 输出）

| 项目     | 内容                                                                 |
| -------- | -------------------------------------------------------------------- |
| **目标** | 当前预览纹理 + 预览骨骼各跑一次 YSMParser，合并为一次解码 + 缓存复用 |
| **难度** | ⭐⭐ 中等                                                            |
| **预估** | 前端 ~30 行 + 选配 Go 缓存                                           |

### 方案

**前端缓存（当前实现方向）：**

- `_decodeYsmViaWasm()` 返回 `{ texture, geometry }` 后，`_ysmCache` 已缓存
- `_loadPreviewImage()` 先问 `_ysmCache`，命中则直接复用纹理
- `_loadModel2D()` 同样复用缓存的 geometry

**Go 端缓存（更彻底）：**

- 新增 Go Binding `DecodeYsm(path) → {texture, geometry}` 一次性解码
- YSMParser CLI 只调用一次，输出解析全部内容
- 前端收到后分别传递给 `_loadPreviewImage` 和 `_loadModel2D`

### 当前状态

- ✅ 前端 WASM 路径已实现 `_ysmCache`（`_decodeYsmViaWasm` 内缓存）
- ❌ Go（CLI）路径仍是双次调用 → 优先级高
- ❌ WASM 失败后回退 Go 路径不会用 Go 端的缓存

### 需要修改

**前端 — `components/app-preview/index.js`**

- 合并 `_loadPreviewImage` + `_loadModel2D` 为统一的 `_loadModelPreview(path)`
- 优先问缓存，未命中则一次性解码 → 拆出纹理 + 几何体 → 分别渲染

---

## 3️⃣ 骨骼交互高亮（悬停/点击）

| 项目     | 内容                                 |
| -------- | ------------------------------------ |
| **目标** | 鼠标悬停骨骼高亮，点击选中显示骨骼名 |
| **难度** | ⭐⭐ 中等                            |
| **预估** | `model2d.js` ~80 行                  |

### 方案

```js
// canvas 上绑 mousemove → 检测鼠标下的骨骼
canvas.addEventListener("mousemove", (e) => {
  const { offsetX, offsetY } = e;
  // 遍历骨骼 bounding box → 命中高亮
  const hit = bones.find(
    (b) =>
      offsetX >= b.screenX &&
      offsetX <= b.screenX + b.screenW &&
      offsetY >= b.screenY &&
      offsetY <= b.screenY + b.screenH,
  );
  if (hit) {
    // 高亮：重绘该骨骼为亮色，骨骼名显示在右上角
    highlightBone(hit);
  }
});
```

### 需要修改

- `frontend/js/utils/model2d.js` — `renderModel2D` 返回骨骼屏幕坐标映射，新增事件绑定
- `components/app-preview/index.js` — 可选：预览区下方显示选中骨骼详情

### 风险

- 低：纯 Canvas 拾取，无 DOM 交互
- 注意：缩放平移后坐标映射需同步

---

## 4️⃣ 动画预览（播放骨骼动画）

| 项目     | 内容                                                            |
| -------- | --------------------------------------------------------------- |
| **目标** | YSMParser 能解出 `animations/*.json`，Canvas 播放骨骼关键帧动画 |
| **难度** | ⭐⭐⭐⭐ 高                                                     |
| **预估** | `model2d.js` ~150 行 + 动画插值逻辑                             |

### 方案

1. 解析 Molang / Bedrock 关键帧格式（`{ "0.0": {...}, "1.0": {...} }`）
2. 按时间插值骨骼旋转/位移
3. Canvas `requestAnimationFrame` 循环渲染
4. 播放控制条：▶ 暂停 / ⏹ 重置 / 速度滑块

### 需要修改

- `frontend/js/utils/model2d.js` — 新增动画循环渲染函数
- `components/app-preview/index.js` — 加载 `animations/*` 数据
- `go/ysm/parse.go` 或 `app.go` — 从 YSMParser 输出中读取 `animations/`

### 风险

- 高：Molang 表达式解析复杂（条件表达式、变量作用域）
- 可以先支持 `pre_molang`（纯旋转/位移），暂不处理复杂表达式

---

## 5️⃣ 模型统计面板

| 项目     | 内容                                                   |
| -------- | ------------------------------------------------------ |
| **目标** | 预览区侧边显示模型统计数据：骨骼数、立方体数、纹理尺寸 |
| **难度** | ⭐ 简单                                                |
| **预估** | 前端 ~40 行                                            |

### 方案

```js
const stats = {
  bones: model.boneCount,
  cubes: model.cubeCount,
  textures: textureWidth + "×" + textureHeight,
  format: isYsm ? ".ysm (加密)" : path.endsWith(".zip") ? ".zip" : ".7z",
};
```

### 需要修改

- `components/app-preview/tpl.js` — 统计卡片增加纹理尺寸、格式等字段
- `index.js` — `_loadModel2D` 完成后传递统计数据

### 风险

- 极低

---

## 6️⃣ 导出格式扩展（GIF / glTF）

| 项目     | 内容                                           |
| -------- | ---------------------------------------------- |
| **目标** | 当前仅支持 PNG 导出，增加动画 GIF 和 glTF 导出 |
| **难度** | ⭐⭐⭐ 中等                                    |
| **预估** | 前端 ~100 行 + 选配 Go 端 ~50 行               |

### 方案

| 格式     | 实现方式                                 | 库依赖                                        |
| -------- | ---------------------------------------- | --------------------------------------------- |
| **GIF**  | Canvas 逐帧捕获 + gif.js（CDN 或 npm）   | [gif.js](https://github.com/jnordberg/gif.js) |
| **glTF** | 骨骼树→glTF JSON 序列化，下载 .gltf+.bin | 无依赖                                        |
| **SVG**  | Canvas→SVG 转换（保留矢量骨骼图）        | 可选                                          |

### 需要修改

- `frontend/js/utils/canvas-export.js` — 添加 GIF 录制（连续帧捕获）和 glTF 导出
- `go/types/bedrock.go` — 可选：Go 端 glTF 序列化

### 风险

- 中：gif.js 需要引入第三方库
- glTF 导出需要理解 glTF 2.0 规范

---

## 7️⃣ YSMParser / WASM 状态页

| 项目     | 内容                                                     |
| -------- | -------------------------------------------------------- |
| **目标** | 设置页新增「解析引擎」面板，显示 YSMParser/WASM 运行状态 |
| **难度** | ⭐⭐ 中等                                                |
| **预估** | 前端 ~60 行 + 选配 Go Binding ~20 行                     |

### 方案

```
┌─ 解析引擎 ──────────────────────────┐
│  📦 WASM 模块      ✅ 已加载 (v0.3.5) │
│  ⚙️ CLI Sidecar    ✅ 就绪 (2.3 MB)   │
│  📊 解码统计      总解码 47 次        │
│                   失败  3 次          │
│                   缓存命中 12 次      │
│  🧪 测试解码       [ 上传 .ysm 测试 ] │
└──────────────────────────────────────┘
```

### 需要修改

- 新文件 `frontend/js/pages/settings.js` 或作为已有设置页的一部分
- `app-modules.js` — 注册设置页路由
- 可选：Go 端 `GetParserStatus() → { wasmReady, cliPath, cliSize, decodeCount }`

### 风险

- 低：纯信息展示，不影响核心功能
- 需要决定「设置页」的导航入口位置

---

## 进度总表

| #   | 特性                  | 难度     | 依赖      | 预估     |
| --- | --------------------- | -------- | --------- | -------- |
| 1   | WASM 能力补齐         | ⭐⭐⭐⭐ | 无        | 未知     |
| 2   | 双解码去重            | ⭐⭐     | 1（可选） | 前端30行 |
| 3   | 骨骼交互高亮          | ⭐⭐     | 无        | 80行     |
| 4   | 动画预览              | ⭐⭐⭐⭐ | 1         | 150行    |
| 5   | 模型统计面板          | ⭐       | 无        | 40行     |
| 6   | 导出格式扩展          | ⭐⭐⭐   | 无        | 150行    |
| 7   | YSMParser/WASM 状态页 | ⭐⭐     | 无        | 80行     |
