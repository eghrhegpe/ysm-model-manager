# 2026-06-10 全功能复盘报告

**日期**：2026-06-10
**时长**：全天（连续多段会话）
**范围**：Go 后端 ~5 处修改，前端 ~20 个 JS/CSS 文件改动
**构建/发布次数**：~40 次构建，2 次发版（v1.3.5、v1.3.6）

---

## 一、本轮改动范围

### 大修：WASM 解码器性能

| 改动               | 文件                                                           | 说明                                        |
| ------------------ | -------------------------------------------------------------- | ------------------------------------------- |
| base64 解码加速    | `ysm-wasm-data.js`, `ysm-glue-data.js`, `app-preview/index.js` | `Uint8Array.from(str, fn)` → `for` 循环     |
| WASM 二进制缓存    | `ysm-wasm-data.js`                                             | 首次解码后缓存 `ArrayBuffer`                |
| 胶水代码缓存       | `ysm-glue-data.js`                                             | 首次解码后缓存字符串                        |
| 脚本注入消除       | `ysm-parser.js`                                                | `<script>` DOM 注入 → `(0, eval)` 间接 eval |
| 移除 callMain 回退 | `app-preview/index.js`                                         | 跳过必然失败的 callMain，节省 ~100ms        |

### 大修：内存泄漏修复

| 问题                  | 根因                                       | 修复                                          |
| --------------------- | ------------------------------------------ | --------------------------------------------- |
| 缓存无限增长          | `preview-cache.js` Map 永不淘汰            | 上限 50 条 + FIFO 淘汰                        |
| Blob URL 只创建不释放 | `URL.createObjectURL` 永不 revoke          | 淘汰时自动 `URL.revokeObjectURL()`            |
| 切换模型旧 DOM 堆积   | `_loadModel2D` 只 append                   | 加载前 `content.innerHTML = ""`               |
| 3D 僵尸动画循环       | `cleanup()` 没取消 `requestAnimationFrame` | `cancelAnimationFrame` + `controls.dispose()` |

### 重写：自动更新器（LytVPK 风格）

| 维度     | 旧                               | 新                                              |
| -------- | -------------------------------- | ----------------------------------------------- |
| 替换策略 | `updater.bat` (cmd 黑框 + xcopy) | `os.Rename` (exe → exe.old → exe.new)           |
| 回滚     | 无                               | 失败自动恢复                                    |
| 重启     | `window.close()`                 | `exec.Command(self).Start()` + `runtime.Quit()` |
| 启动清理 | 无                               | 自动删 `.old`                                   |
| 下载进度 | 无                               | 支持 `EventsOn("update_progress")`              |

### 新增：静默更新检查

- 启动异步检查 + 6h 限频 + 可点击 toast
- 更新日志聚合（`/releases?per_page=10` 取多版本发布说明）
- 自定义更新弹窗（主题适配 + 可滚动）

### 新增：发布说明分离

- 用户版 (`vX.Y.Z.md`) — 功能/改进/修复
- 开发者版 (`vX.Y.Z-compare.md`) — 对比表/文件变更
- 已分离全部 16 个历史版本，写入战斗手册

### 其他

- 设置页新增灵感来源署名
- README 新增灵感来源表格 + 许可证
- VS Code 设置：`diffEditor.maxComputationTime: 0`
- gopls 配置：`buildFlags: ["-tags=cli"]`
- 构建警告/错误清理（wazero import、TextureHeight 字段、nil check 等）

---

## 二、关键 Bug 与教训

### Bug 1: YSGP V2 文本头部变体 WASM 解码失败

**问题**：2023 年早期加密模型（如 芙兰朵露、苏溟等）在 WASM 路径返回空，回退 Go CLI 导致性能差 + 无纹理映射日志。

**排查路径**：

- Round 1: WASM 初始化问题？→ 日志 `WASM init: ✅`，排除
- Round 2: base64 解码慢？→ 优化 for 循环，但根本问题是解码失败
- Round 3: 内存解析返回空 → 打印文件列表发现 0 文件
- Round 4: `buildStdYsgpFromTextVariant` 重建标准 YSGP → 成功剥离头部，但重建时 hash 偏移错误
- **真相**：原始文件在文本头部后包含 16 字节 hash，`bytes.slice(dataStart)` 包含了这 16 字节，导致加密数据重复 hash，XXTEA 解密失败

**修复**：跳过 `dataStart + 16` 再取加密数据。

**教训**：二进制格式处理时，务必确认每个字段的精确偏移。文本头部变体包含 hash 两次（文本 `<hash>` 标签和二进制 hash），容易忽略第二个。

### Bug 2: 3D 僵尸动画循环

**问题**：每次开/关 3D 预览后 CPU 逐次叠加。开 N 次后 N 个 `requestAnimationFrame` 同时在跑。

**排查路径**：

- Round 1: WebGL 上下文泄漏？→ `renderer.dispose()` 已调用
- Round 2: Three.js 纹理泄漏？→ `texMap.forEach(tex.dispose())` 已调用
- Round 3: 观察 CPU 使用率 → 每次开关后升高
- **真相**：`renderModel3D` 的 `renderLoop()` 递归调 `requestAnimationFrame` 永不停止。`cleanup()` 只 dispose 了 renderer 但没取消动画帧。

**修复**：`cleanup()` 中补 `cancelAnimationFrame(_rafId)` + `controls.dispose()` + resize 监听清理。

**教训**：任何 `requestAnimationFrame` 循环必须有对应的取消机制。Three.js 的 `renderLoop` 模式容易漏掉 `cancelAnimationFrame`。

### Bug 3: 缓存无限增长

**问题**：`preview-cache.js` 的 `Map` 随浏览模型数量线性增长，从不释放。

**影响**：浏览 100+ 模型后内存占用飙升。

**修复**：上限 50 条 + FIFO 淘汰 + evict 回调释放 blob URL。

**教训**：模块级 `Map` 缓存必须设上限。数据 URL (base64) 和 blob URL 都不自动释放。

---

## 三、架构决策

### 更新器架构：batch → os.Rename

**决策**：废弃 `updater.bat`（cmd + xcopy），改用 Go 端 `os.Rename` 替换策略。

**原因**：

- batch 脚本弹出 cmd 黑框，影响用户体验
- xcopy 不可回滚，失败后程序损坏
- batch 依赖外部进程，难以控制

**新流程**：

1. 下载 ZIP → 解压 → 提取 exe → 写入 `exe.new`
2. `os.Rename(exe → exe.old)` 备份
3. `os.Rename(exe.new → exe)` 替换
4. 失败时 `os.Rename(exe.old → exe)` 回滚
5. 启动时清理 `exe.old`

### 发布说明分离

**决策**：每个版本两个文件——用户版 `vX.Y.Z.md` + 开发者版 `vX.Y.Z-compare.md`。

**原因**：

- 用户只看功能/改进/修复
- 开发者需要影响文件、实现对比、技术细节
- GitHub Release 使用用户版，减少阅读负担

---

## 四、发版记录

| 版本   | 说明                                           | 文件名      |
| ------ | ---------------------------------------------- | ----------- |
| v1.3.5 | WASM 性能优化 + 内存泄漏修复 + mcRoot 配置修复 | `ZIP 7.2MB` |
| v1.3.6 | 更新器重构 + 静默检测 + 更新日志聚合           | `ZIP 6.9MB` |

---

## 五、待办

- [ ] 修复双手臂模型（沐白）骨骼合并
- [ ] 高面数模型 3D 预览 LOD 优化
- [ ] 补充更新下载进度条
- [ ] WASM 初始化体验优化（加载动画）
