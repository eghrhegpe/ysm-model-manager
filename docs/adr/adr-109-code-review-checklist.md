# ADR-109：代码审查 Checklist

## 状态
✅ 已采纳

## 背景
七轮审核发现 41 处问题，其中 40% 是规范存在但未遵循、25% 是跨平台边界条件、20% 是前端 3D 资源生命周期管理。需要系统性 checklist 防止同类问题再次出现。

## 决策

### 1. 安全 Checklist（所有文件操作/网络请求必须过）

#### 路径安全
- [ ] 所有 Wails binding 方法（`internal/app/app_*.go`）是否经过 `isPathInRootOrSelf` 校验？
- [ ] 前端 WASM 层（`frontend/src/wasm/`）是否有路径穿越风险？
- [ ] ZIP 解压路径是否经过 `sanitizeZipEntryPath` 清洗？
- [ ] NBT/JSON 解析是否有长度/深度上限？

#### XSS 防护
- [ ] 所有 `innerHTML` 拼接是否经过 `esc()` 或 `escHTML()` 转义？
- [ ] 翻译函数 `t()` 的返回值是否安全（不直接拼接 HTML）？

#### 内存安全
- [ ] 大文件 base64 解码是否有大小守卫（`DetectZipType` 50MB）？
- [ ] NBT TAG_LIST 长度是否有预算校验（`minPayloadBytes`）？
- [ ] Schematic 维度是否有总量上限（`MAX_SCHEMATIC_BLOCKS`）？

### 2. 跨平台 Checklist（文件操作必须过）

#### 跨设备移动
- [ ] `os.Rename` 失败时是否检测 `fsutil.IsCrossDeviceErr`？
- [ ] EXDEV 回退是否用 `copyFile` + `os.RemoveAll`？
- [ ] 跨设备移动是否携带 `.ban` 状态文件？

#### 符号链接
- [ ] 文件存在性检查是否用 `os.Lstat`（不跟随链接）？
- [ ] 恢复操作是否处理符号链接分支（`Readlink` → `Remove` → `Symlink`）？
- [ ] 硬链接判定是否用 `fsutil.IsHardLink`？

#### 大小写敏感
- [ ] 路径比较是否用 `strings.EqualFold`（Windows）或 `filepath.Rel`？
- [ ] 文件名剥离 `.ban` 后缀是否大小写不敏感？

### 3. 前端 3D 资源 Checklist（所有 3D 模块必须过）

#### GPU 资源生命周期
- [ ] `geometry`/`material`/`texture` 是否在 `dispose()` 中释放？
- [ ] `DataTexture`（如法线贴图）是否单独 `dispose()`？
- [ ] `render target`/`framebuffer` 是否释放？
- [ ] 后处理 `EffectComposer` 是否释放？

#### DOM 资源生命周期
- [ ] `addEventListener` 是否有对应的 `removeEventListener`？
- [ ] 主题提交的核心卖点路径是否有**先行端到端断言**（不依赖 review 补洞）？例：截图灯光接线（e8178c82 初版只接 fallback 分支）、roles 详情模型信息通道（P5 事故）——「有集成测试就会初版变红」的路径，提交前自查而非等 review 发现。
- [ ] 多实例注册表 key（schema-registry 等）是否 per-scene 显式、无 id 隐式兜底、dispose 只注销自身？
- [ ] `viewContainer` 是否在 `fullCleanup` 中移除？
- [ ] rAF 循环是否在 `perFrame` 列表空时停止？

#### 会话切换
- [ ] `setPerFrame` 是否先移除旧回调再注册新回调？
- [ ] `setSceneBaseline` 是否排除内容层增量？
- [ ] `switchTo` 是否用差量移除旧内容层？

### 4. 原子写入 Checklist（所有配置/数据持久化必须过）

- [ ] 配置文件写入是否用 `fsutil.WriteFileAtomic`？
- [ ] 标签系统写入是否用 `fsutil.WriteFileAtomic`？
- [ ] 日志写入是否用 `fsutil.WriteFileAtomic`？
- [ ] 临时文件是否在 `defer` 中清理？

### 5. 并发 Checklist（所有共享状态必须过）

- [ ] 共享资源操作是否持有 `installer.InstallLock`？
- [ ] 事件 `Emit` 是否在锁外？
- [ ] `sync.Map`/`atomic` 使用是否正确？
- [ ] `defer` 中是否有锁释放？

## 后果

### 正面
- 新开发者/AI 代理有明确的 checklist 可遵循
- 代码审查有统一的验收标准
- 减少同类问题再次出现

### 负面
- checklist 较长，可能增加审查时间
- 需要团队培训，确保所有人都了解

## 执行
- 所有 PR 必须过上述 checklist
- AI 代理在修复 bug 后，必须检查是否触及 checklist 中的其他项
- 每季度回顾 checklist，根据新发现的问题更新
