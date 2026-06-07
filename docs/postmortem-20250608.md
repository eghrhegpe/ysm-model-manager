# Postmortem: YSMParser 集成与 2D 模型渲染（2026-06-07/08）

> 历时约 6 小时，横跨 Go 后端、JS 前端、Canvas 渲染、第三方 CLI 集成

## 目标

为 `.ysm` 和 `.zip`/`.7z` 模型文件提供 2D 骨骼线条图预览（前视图 + 俯视图小窗）。

## 最终结果

| 指标 | 值 |
|------|----|
| 开源模型（zip） | ✅ 31 骨 59 方（四季映姬） |
| 加密模型（.ysm） | ✅ 187 骨 877 方（Eanes） |
| 代码改动 | app.go +125 / -60，model2d.js +5，index.js 重写 _loadModel2D |
| 新增依赖 | YSMParser.exe（1.2 MB sidecar） |

## Debug 路径

### Round 1: Canvas 渲染不可见

**症状**: 2D 渲染的 UI 骨架标题不出现

**错误猜测**: JS 代码截断加载

**查了什么**: 读 `_loadModel2D` 全流程，确认代码正确但方法未执行到 DOM 创建

**真相**: `_loadModel2D` 方法的花括号被 `replace_string_in_file` 吃掉了，导致 `_showModelDetail` 后的方法定义语法错误，Vite 解析到 `Parse error @:1:1`

**Lesson**: 替换时 `oldString` 末尾的闭合 `}` 必须包含在新字符串中。改完立即 `npx vite build` 检测。

---

### Round 2: 颜色太淡

**症状**: Canvas 有绘制（9716 非空像素）但肉眼看不见

**错误猜测**: 渲染算法不对

**查了什么**: 创建独立测试页 `prototypes/model2d-test.html`，用高透明度手动绘制确认算法正确

**真相**: `rgba(124,131,255,0.15)` 填充在深色背景上接近全透明

**修复**: 填充 0.15→0.45，边框 0.6→0.85，线宽 0.5→1

---

### Round 3: .ysm 文件「无骨骼数据」

**症状**: `AnalyzeBedrockModel` 返回 `boneCount=0`

**错误猜测**: YSM 格式不同需要专用解析

**查了什么**: 加 Go println 日志（但 Wails GUI 不显示 stdout）→ 前端加红色调试文字 → 确认 Go 返回空

**真相**: YSM 是 `YSGP header + AES 加密` 的二进制格式，**不是 zip**。`parseBedrockFromZip` 永远找不到 `minecraft:geometry`

**Lesson**: 查文件格式应先看社区文档（旧版 YSM mod 源码 `YesModelUtils.java` 证实了 YSGP 格式），而不是反复试 zip 解析

---

### Round 4: YSMParser.exe 路径找不到

**症状**: 前端显示「需要 YSMParser.exe 解码」

**真相 ×2**:
1. `wails build -clean` 清空了 `build/bin/`，YSMParser.exe 被删除
2. `runYSMParserOnFile` 函数体在 `replace_string_in_file` 中被损坏（插入了 `findYSMParser` 的重复代码）

**修复**:
- `findYSMParser()` 增加工作目录兜底
- `runYSMParserOnFile` 重写为独立函数
- `build-release.ps1` 新增 YSMParser 检测

**Lesson**: 每次 `wails build -clean` 后必须恢复 sidecar。`multi_replace` 不回滚 — 改后立即 build 检测。

---

### Round 5: UV 格式不兼容

**症状**: `parseBedrockGeometry` 对 YSMParser 输出的 `models/main.json` 返回 nil

**日志**: `{"format_version":"1.12.0","minecraft:geometry":[{"description":{...}}]}` — 看起来完全正确

**真相**: YSMParser 输出 BlockBench 风格的 UV 对象 `{"down":{"uv":[55,37],"uv_size":[6,4]},...}`，但 struct 声明 `UV [3]float64` 期望数组。Go `json.Unmarshal` 类型不匹配 → 返回 error → `parseBedrockGeometry` 返回 nil

**Lesson**: YSM mod 的 `UvUnion.java` 用 `@JsonAdapter` 自定义反序列化，同时支持两种 UV 格式。我们的 Go 应该用 `json.RawMessage` 等效处理。

---

### Round 6: `texture_width` 类型不匹配

**症状**: 即使 UV 修了，`parseBedrockGeometry` 仍然对 `models/main.json` 返回 nil

**日志**: 前 200 字节中 `"texture_width":512.0` — 注意是浮点数

**真相**: YSMParser 输出 `512.0`（float），Go struct `TextureWidth int` 无法 unmarshal

**修复**: 改为 `float64`，赋值时 `int(...)` 转换

---

### Round 7: `bone.cubes is not iterable`

**症状**: 无骨骼的模型（有 metadata 但无 cubes）在前端崩溃

**真相**: Go nil slice 序列化为 JSON `null`，前端 `for (const c of bone.cubes)` 对 null 报错

**修复**:
- Go 端: `var cubes []Cube2D` → `make([]Cube2D, 0)` 保证 `[]`
- 前端: 全部 4 处 `bone.cubes` → `bone.cubes || []`

---

## 关键发现

### .ysm 文件格式真相

```
旧版 YSM (LegacyYSM):
  .ysm = YSGP header + AES 加密二进制
  → YesModelUtils.input() 解密 → Map<文件名, 内容>
  → Converter.fromJsonString() → RawGeoModel (minecraft:geometry)

新版 YSM (OYSM):
  .ysm = zip 内含 无加密 minecraft:geometry JSON
  → 直接用 zip.NewReader 读取
```

我们的工具现在**同时支持两种格式**：
1. `.zip` → `parseBedrockFromZip` → 直接解析
2. `.ysm` (加密) → `YSMParser.exe` 解密 → `parseBedrockGeometry` 解析
3. `.zip` (内含 YSM) → Bedrock 解析失败 → fallback YSMParser

### YSMParser 输出格式特点

| 字段 | 格式 | 兼容方式 |
|------|------|----------|
| `texture_width` | `512.0` (float) | Go `float64` + `int()` |
| `texture_height` | `512.0` (float) | 同上 |
| `uv` | 对象 `{face:{uv,uv_size}}` 或数组 `[u,v]` | `json.RawMessage` |
| `bones[].cubes` | `null` / `[]` / `[{...}]` | Go `make()` + JS `\|\| []` |

## 工具链改进

- `build-release.ps1` 新增 YSMParser.exe 自动检测和复制
- `.github/copilot-instructions.md` 新增 4 条规则（#4-7）
- `prototypes/model2d-test.html` 独立测试页
- 文件日志 `writeDebug()` 用于生产环境无控制台的场景

## 待办

- [ ] 修复 `build-release.ps1` 中 `-clean` 后 YSMParser 丢失的问题（从外部缓存恢复而非每次都下载）
- [ ] 考虑 WASM 内嵌方案替代 CLI sidecar（无额外 exe 依赖）
- [ ] 加密模型的纹理预览（当前 YSMParser 输出了纹理但未在前端利用）
