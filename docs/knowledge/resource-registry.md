---
kind: resource-registry
name: 资源注册表 registry
tier: architecture
category: config
source_files:
  - resource_types.json
  - frontend/src/services/registry.ts
  - frontend/src/utils/resource/registry.ts
auto_fields:
  symbols_with_lines:
    - clear
    - get
    - has
    - loadResourceRegistry
    - register
    - ResourceTypeEntry
    - ServiceName
    - unregister
  tests:
    - frontend/src/services/registry.test.ts
    - frontend/src/utils/resource/registry.test.ts
  use_when:
    - 资源类型
    - 注册表
    - resource_types
    - registry
    - 文件类型
  invariant_anchors:
    - frontend/src/services/registry.ts|register
    - frontend/src/services/registry.ts|get
  quick_groups:
    - 配置与注册表
  quick_intents:
    - 新增资源类型 / 修改 resource_types.json / 文件类型
  quick_risk_lines:
    - resource_types.json 是唯一事实来源；前端只读不判、禁本地重算
tests:
  - frontend/src/services/registry.test.ts
  - frontend/src/utils/resource/registry.test.ts
use_when:
  - 资源类型
  - 注册表
  - resource_types
  - registry
  - 文件类型
invariant_anchors:
  - frontend/src/services/registry.ts|register
  - frontend/src/services/registry.ts|get
quick_groups:
  - 配置与注册表
quick_intents:
  - 新增资源类型 / 修改 resource_types.json / 文件类型
quick_risk_lines:
  - resource_types.json 是唯一事实来源；前端只读不判、禁本地重算
pitfalls:
  - services/registry.ts 是 Service 注册表（register/get/unregister/clear）≠ resource_types.json 资源类型定义；混淆两者会在「新增类型」场景误改 register 而非 JSON
  - loadResourceRegistry 空结果/异常不缓存（P2 修复）；旧实现 Go 失败返回 `"{}"` 时会缓存空注册表导致整会话降级；现正确行为是失败路径返回 `{}` 不写入 `_registry`，下次调用可重试
  - services/registry.get 用 Map.has() 判定，falsy 值 `0/""/false/null` 如实返回（P3 修复）；误判「不存在」走 null 分支会导致功能静默失效
  - MMD 子类型 instanceDir 必须精确为 `3d-skin/<子名>`（含子级），漏写一级右键「打开文件夹」打开到错误父目录；TestResolveInstDirTarget_MmdSubtype_3dSkinPrefix 回归测试锁定
status: active
---

# 资源注册表 registry

## 概览

`resource_types.json` 是 YSM 资源类型定义的单一事实来源（Single Source of Truth）。所有资源类型、子目录、扩展名的定义均以此处为准。

## 核心职责

- 定义资源类型及其 `StorageSubDir`、`specificRoot`、`ResourceExts`
- 前端 `services/registry.ts` 是**服务注册表**（`register`/`get`/`has`/`unregister`/`clear` 存 Service 实现到 Map），与资源类型定义（`resource_types.json`）无关
- Go 端 `go/types/` 包同步读取同一份定义

## 对外 API / 入口

- `register(name, service)` — 注册服务（`ServiceName` 联合类型收窄 + 泛型，拼错编译期拦截）
- `get(name)` / `has(name)` — 获取 / 检查服务是否存在（`get` 用 `Map.has()` 判定，falsy 值 `0/""/false/null` 如实返回，P3 修复）
- `unregister(name)` / `clear()` — 注销单个 / 清空全部
- `loadResourceRegistry()`（`utils/resource/registry.ts`）— 加载资源类型注册表；**空结果/异常不缓存**（Go 失败返回 `"{}"` 时不会写入 `_registry`，下次调用可重试，P2 修复）；失败路径 `console.warn` 告警（P3 修复，对齐 Go 端损坏回退告警）

## 与其他子系统关系

- `go/types/`: Go 端注册表加载
- `frontend/src/utils/resource/registry.ts`: 前端资源类型注册表加载（Go `LoadResourceTypes` binding）
- `frontend/src/utils/resource/types.ts`: 前端类型工具；`schema.ts` 为前端唯一 ResourceType 接口 + 单一 JSON 解析点（`types.ts`/`extensions.ts` 同源消费，T2 收敛）

## 不变量

- 新增资源类型必须在 `resource_types.json` 中添加，不可在 Go/Frontend 中手写新条目
- 一致性测试（`type-consistency.py`）自动校验 JSON ↔ Go ↔ JS 一致性
- **MMD 子类型 `instanceDir` 防回归（2026-08-23）**：游戏实际在整合包生成 6 个 `3d-skin/` 子目录——`SceneModel` / `EntityPlayer` / `CustomMorph` / `CustomAnim` / `DefaultMorph` / `DefaultAnim`，这些类型的 `instanceDir` **必须**精确为 `3d-skin/<子名>`（含子级），漏写一级（只写 `3d-skin`）会导致右键「打开文件夹」打开到错误父目录差一级。`StageAnim` / `mmd-shader` 游戏未实际生成独立子目录，`instanceDir` 保持 `3d-skin` 父目录兜底（打开到父级仍可定位，不报错）。`OpenInstanceFolder` → `resolveInstDirTarget` 只用 `rtype.instanceDir` 拼路径、`subdir` 参数已不参与路由（app_scan.go OpenInstanceFolder），所以「兜底」完全依赖 `instanceDir` 数据正确——**纯数据层契约，无代码猜测**。回归测试 `TestResolveInstDirTarget_MmdSubtype_3dSkinPrefix` 锁定这 6 个类型的子目录。

## 相关

- `resource_types.json` — 单一事实源
- 治理红线 §五.4: 注册表优先
