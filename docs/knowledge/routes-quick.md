<!-- 本文件由 scripts/gen-routes-quick.mjs 自动生成，请勿手改。重跑：node scripts/gen-routes-quick.mjs -->

# AI 急速版路由表（高频场景）

> 本表由知识卡 frontmatter 的 `quick_*` 字段自动生成。
> 新增高频场景请在对应知识卡 frontmatter 补充 `quick_groups`/`quick_intents`/`quick_risk_lines`/`pitfalls`。

## 🎯 后端桥接与数据存储

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| IndexedDB、网页版存储 | [浏览器后端 IndexedDB 封装](./backend-idb.md) | 事务必须接线 complete/error/abort 三事件 | ADR-177 |
| Wails 绑定、Go 调用 | [Wails 桥接 app.ts](./wails-bridge.md) | 前端必须经 getApp() 访问，禁止直调 window.go | ADR-049 |

## 🎯 模型扫描与仓库管理

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 仓库审计、健康分 | [扫描核心 go/scanner](./go-scanner.md) | - | - |
| 去重检测、dedup | [扫描核心 go/scanner](./go-scanner.md) | - | - |
| 扫描模型、ScanModelEntries | [扫描核心 go/scanner](./go-scanner.md) | 容器指纹缓存失效需调 ClearScanCache | - |
| 整合包同步、sync | [扫描核心 go/scanner](./go-scanner.md) | - | - |
| 资源类型识别、rtype 判定 | [扫描核心 go/scanner](./go-scanner.md) | resource_types.json 是唯一事实来源 | - |

## 🎯 3D 预览与模型追加

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 3D 预览菜单、根菜单、dock 按钮 | [统一 3D 预览核心 preview-core](./preview_core.md) | 适配器项经 setAdapterItems 注入，禁止内联 | ADR-125 |
| 模型切换、会话内替换 | [统一 3D 预览核心 preview-core](./preview_core.md) | switchTo 仅同类型；跨类型用 switchExternal | ADR-125 |
| 相机控制、OrbitControls | [3D 预览渲染 model3d](./model3d.md) | 相机定位公式固定：position(0, 80, -120), target(0, 80, 0) | - |
| 追加模型、同台加载、多模型同框 | [统一 3D 预览核心 preview-core](./preview_core.md) | 跨类型必须走 switchExternal，禁止直接调 adapter.build | ADR-125 |
| VRM 动画播放、VRMA | [统一 3D 预览核心 preview-core](./preview_core.md) | 必须 mixer.update(dt) → vrm.update(dt)，禁止手动 vrm.humanoid.update() | ADR-125 |

## 🚨 高频陷阱速查

| 陷阱 | 位置 | 正确做法 |
|------|------|----------|
| 跨类型追加走错适配器 | `preview-menu/core.ts` | 必须经 switchExternal → openModel3DFullscreen(cooperate) |
| 异步回调写入已卸载 DOM | `skeleton.ts` | 每个 await 后检查 container.isConnected |
| 手动调用导致 T-pose 回归 | `vrm.humanoid.update()` | 只用 vrm.update(dt) |

---
<!--  END_GENERATED_SECTION -->
