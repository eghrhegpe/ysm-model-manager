# ADR-047：Android 可用性落地规划：触屏交互 + FileAccessor 抽象（ADR-046 P2 实施）

- **状态**：✅ 已采纳
- **日期**：2026-08-09
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-046`

---

## 1. 背景（Context）

ADR-046 已裁决全平台化高可行，P2 Android 为高可行但条件成立（YSMParser WASM 单线程审计已关闭红线前置）。本 ADR 落地前，以 3 个只读子代理按重要性分组审核当前 Android 能力面（Go 侧平台隔离 / 宿主层与构建 / 前端适配），结论：**编译层已无阻塞**（Wails v3 自带全套 android 实现 + 项目 6 组 `_windows/_other` build tag 覆盖完整，`GOOS=android` 交叉编译通过），真正的阻断在**运行层**三处 P1：

1. **目录选择**：wails android `dialogs_android.go` 硬编码「directory selection is not supported on Android」→ 仓库根/游戏目录引导流程全断；
2. **overlay 可移植性**：`build/android/overlay.json` 入库机器绝对路径（`C:\Users\...`）→ 换机/CI 必失败；
3. **前端触屏交互**：全前端 grep `touchstart/touchmove/touch-action` 零命中，3D 旋转/体素 orbit/面板 resize/预览拖拽均纯 mouse 事件 → Android 完全不可用。

## 2. 决策（Decision）

按投入产出排序分四批落地 ADR-046 P2，每批独立可交付、独立验证：

| 批次 | 范围 | 依据 |
|------|------|------|
| **先行小修** | overlay.json 移出 git 跟踪 + Taskfile 强制重新生成（P1-2）；PathManager 收尾：`scanMinecraftDirs` 直调改走 `appDataRoot()`（app_config.go:379）、`app_config_other.go` 拆 `!windows && !android` + android 空实现 | 审核 P1-2/P2-1/P2-2 |
| **核心立项 A：前端 Pointer Events 统一改造** | 全部拖拽/缩放/旋转从 mouse 事件迁移 `pointerdown/move/up` + `setPointerCapture` + CSS `touch-action:none`；hover 交互（骨骼名/菜单/tooltip）补 tap 兜底；`android:back` 先关活动弹窗再退出（弹窗目前只听 Esc） | 审核前端 P1/P2 |
| **核心立项 B：FileAccessor 抽象 + SAF 桥** | 对标 MikuMikuAR ADR-018 build-tag 双实现模式：新增第二个平台抽象接口，收敛 `os.Rename/os.Link/os.Symlink/os.RemoveAll/os.ReadDir` 等 10+ 处直调；Android 实现走 SAF document-tree URI 读/写/列目录；文件选择补 `onShowFileChooser` 验证 | 审核 P1-1/P2-4/F3/F6 |
| **平台守卫批量** | 自动更新入口 Android 隐藏/明确拒绝（P2-3）；`RevealInExplorer`/`OpenFolder` android 分支返回明确不支持（P3-1）；`RestartApplication` 平台守卫（P2-5）；Node sidecar 解码降级说明（P3-2）；watcher FUSE 轮询或关闭明示（P3-4） | 审核 P2-3/P3-1/P2-5/P3-2/P3-4 |

决策原则沿用 ADR-044 防御范式与项目「通用化、统一、复用」偏好：优先复用既有 build-tag 双文件模式与 Wails 绑定契约，禁止引入运行时 GOOS 分支重复实现。

## 3. 后果（Consequences）

**正面**
- Android 可用性三大 P1 阻断逐批关闭，真机可交付里程碑清晰（每批可独立验证）。
- Pointer Events 改造对桌面零回归（pointer 事件兼容 mouse），顺带统一三处事件实现（ADR-008 治理红利）。
- FileAccessor 与既有 pathmgr/screen/hidewindow 同构，MikuMikuAR ADR-017/018 经验可低成本复制。

**负面**
- 触屏改造面广（~10 文件涉及 3D/预览/面板），改完须近距渲染验证（陷阱 #11 高危区）。
- 低端机 3D 渲染质量可能折损（`powerPreference:"high-performance"` 上下文创建失败已有外层 catch 兜底）。
- 多平台维护面上升：Java 层（事件桥/权限路由 F4/F7）、构建脚本（Gradle/AGP 对齐 F9、cleartext 收紧 F10）需跟进。

**已知遗留**
- 自动更新维持 Windows-only（ADR-033 已明确），Android 走应用商店/自有分发另行评估。
- 大文件纹理 base64 传输（F6）与 `<a download>` 导出（P3）列入立项 B 或延后。
- 宿主层 P3/P4 项（allowBackup、onBackPressed 弃用、icon 占位、模板死文件清理）随批次顺带处理。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| 3 个只读子代理审核（Go 侧/宿主层/前端，2026-08-09） | P1×3（目录选择/overlay/触屏）、P2×8、P3/P4 若干，见各分组报告 |
| ADR-046 §2/§3 | P2 Android 高可行；PathManager/SAF/事件总线/权限为中阻项，WASM 红线前置已关闭 |
| MikuMikuAR ADR-017/018（ADR-046 引用范本） | SAF document-tree URI、FileAccessor build-tag 双实现、事件总线权限路由模式 |
| `go build ./go/... ./internal/...` + `GOOS=android` 交叉编译 | 编译层无阻塞复验通过 |

<!-- 文件名: android-usability-plan.md → 实际文件 ADR-047-android-usability-plan.md -->
