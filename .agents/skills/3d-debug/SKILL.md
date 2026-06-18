---
name: 3d-debug
description: 3D 渲染调试。当用户报告 3D 模型显示异常、骨骼错位、纹理问题时使用此技能。
---

# 3D 渲染调试流程

## 快速诊断

### 1. 获取 Spec JSON

在 DevTools 控制台执行：
```javascript
window.debugGetSpec("path/to/model.ysm")
```

检查输出：
- `localPosition` 是否合理（骨骼相对父级的偏移）
- `localRotation` 四元数是否为 `[0,0,0,1]` 或合理值
- `texIdx` 是否正确分配

### 2. 对比原始数据

读取 BedrockModel JSON（解压后的 `models/main.json`）：
```json
{
  "bones": [
    {
      "name": "Head",
      "pivot": [0, 24, 0],
      "parent": "AllBody"
    }
  ]
}
```

对比 spec 输出：
- `Head.localPosition` 应该 = `Head.pivot - AllBody.pivot`

### 3. 手算验证

取一个已知骨骼，手动计算预期坐标：
```
Head: pivot=[0,24,0], parent=AllBody: pivot=[0,0,0]
预期: localPosition = [0,24,0] - [0,0,0] = [0,24,0]
```

如果实际值与预期不符，问题在 `go/threejs/spec.go`。

## 常见问题

### 骨骼偏移

**根因**：坐标系转换错误（X 轴取反）

**检查**：`spec.go:72` 的 pivot 处理
```go
// 正确：不取反
np := vec3{b.Pivot[0], b.Pivot[1], b.Pivot[2]}
```

### 旋转方向错误

**根因**：`eulerToQuaternion` 符号或顺序错误

**检查**：`spec.go:104`
```go
// 正确：三轴均取反
localRot = eulerToQuaternion(-b.Rotation[0], -b.Rotation[1], -b.Rotation[2])
```

### 纹理错乱

**根因**：texIdx 未正确分配

**检查流程**：
1. 看控制台 `[YSM] 纹理:` 日志确认 texIdx 分配
2. 看 `[3dspec]` 日志确认 MeshData.texIdx 值
3. 确认 PNG 不是头像/小图（检查尺寸）

### 多文件模型层级错误

**根因**：同名骨骼覆盖策略问题

**检查**：`spec.go:73-78` 的 pivots map 逻辑
- 优先保留有 `parent` 的骨骼 pivot
- 同名骨骼去重时同步更新 ParentID/LocalPosition/LocalRotation

## 调试工具

```javascript
// 获取 Go spec JSON
window.debugGetSpec(path)

// 打印 Three.js 场景信息
window.__dumpScene()
```

## 参考文档

- `docs/3D-RENDERING/3d-rendering-report.md` — 完整开发报告
- `docs/3D-RENDERING/2026-06-17-summary.md` — 修复总结
- `docs/3D-RENDERING-PLAN.md` — 攻关计划

## 关键文件

| 文件 | 职责 |
|------|------|
| `go/threejs/spec.go` | Go 端骨骼计算、pivot、顶点、四元数 |
| `go/geometry/archive.go` | ZIP/7z 解析 + ysm.json 读取 + TexSlot 分配 |
| `frontend/js/utils/model3d.js` | Three.js 3D 渲染 |
| `frontend/js/utils/model3d-loader.js` | 纹理加载 + spec 调用 |
