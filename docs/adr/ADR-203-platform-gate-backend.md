# ADR-203：平台门控归位 backend——断 utils/dom→backend 依赖环

- **状态**：🔄 部分采纳
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-07
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/utils/dom/android-bridge.ts,capabilities.ts,directory-picker.ts;frontend/src/backend/platform.ts,platform-web.ts`
- **前置**：[ADR-189](./ADR-189-frontend-core-backend-utils-core-feedback.md)（core 准入准则，含「core 不依赖 utils/features/views/backend」红线），[ADR-123](./ADR-123-platform-gating-triage.md)（platform-web 三态能力矩阵收口）

---

## 1. 背景（Context）

锐评 2026-09-07 发现 `utils/dom/` 下三个文件存在 `utils/dom → backend` 向上依赖，违反 ADR-189 D4「依赖方向只许别人引 core，不允许 core 或 utils 反向拉上层」的精神——虽然 ADR-189 具体条文只禁止 `core→backend`，但 `utils/dom` 作为 DOM 原语层反向拉 `backend/` 同样形成分层倒挂。

实证（grep 结果）：

| 文件 | import | 问题类型 |
|------|--------|---------|
| `android-bridge.ts:5` | re-export `backend/platform.ts` | re-export shim，未断根 |
| `capabilities.ts:7` | import `backend/platform-web.ts` | 直接依赖 |
| `directory-picker.ts:9-10` | import `backend/app.ts` + `platform-web.ts` | 直接依赖 |

消费者分布（25+ 处 `from "./android-bridge"` / `from "./capabilities"`，4 处 `from "./directory-picker"`）意味着**全量改路径成本大**，且 `directory-picker.ts` 的 `pickDirectory()` 函数本身是「平台感知型 UI 原语」，与纯 DOM 原语定位不完全吻合。

`android-bridge.ts` 头注释已自陈（ADR-123 P3）：探测原语已下沉到 `backend/platform.ts`，本文件保持 re-export shim——**说明团队已有归位意图，只是未完成**。

---

## 2. 决策（Decision）

### D1 三文件归属重新审视（采纳）

| 文件 | 当前归属 | 建议归属 | 理由 |
|------|---------|---------|------|
| `android-bridge.ts` | `utils/dom/` | `backend/platform.ts`（合并） | 功能纯为「Android Java 桥探测 + 返回键栈」，与 platform 判定同域；25+ 消费方改 import 路径 |
| `capabilities.ts` | `utils/dom/` | `backend/capabilities.ts` | 纯 platform 能力矩阵映射，零 DOM 依赖；21 处消费方改 import |
| `directory-picker.ts` | `utils/dom/` | **保留** `utils/dom/` | 是「平台感知型目录选择器 UI 原语」，含 toast 反馈、i18n、bus.emit——本质是 DOM 层应用，依赖 backend 是合理的 |

D1 的核心思路：**`android-bridge` 和 `capabilities` 是平台探测原语，不应住在 DOM 层；`directory-picker` 是平台感知的 UI 组件，可保留在 `utils/dom/` 但需明确其身份**。

### D2 `android-bridge.ts` 与 `backend/platform.ts` 合并（采纳）

将 `android-bridge.ts` 的内容合并进 `backend/platform.ts`：
- `getAndroidBridge` / `WailsAndroidBridge` 已在 `platform.ts` 中定义，直接移除 re-export
- `isViewerMode()` → 重命名为 `isViewerPlatform()`（与 `platform-web.ts:82` 的公开 API 对齐）
- `registerAndroidBackHandler()` / `emitAndroidBack()` → 移至 `backend/platform.ts` 或新建 `backend/android-back.ts`（视复杂度决定）

消费方（25+ 处）改 `from "../../utils/dom/android-bridge.ts"` → `from "../../backend/platform.ts"`（或新路径）。

### D3 `capabilities.ts` 迁移至 `backend/capabilities.ts`（采纳）

- `can()` / `canWebAction()` / `VIEWER_PURE_ACTIONS` / `VIEWER_WEB_ACTION_BINDINGS` 全部平移到 `backend/capabilities.ts`
- 原文件 `utils/dom/capabilities.ts` 删除
- 消费方（21 处）改 import 路径

### D4 `directory-picker.ts` 保留但清理对 `backend/app.ts` 的运行时 import（采纳）

`directory-picker.ts` 用 `await getApp()` 仅用于获取 `GetDefaultRepoRoot` / `SelectDirectory`，这两个 binding 在 `browser-adapter.ts` 中也有对应实现。考虑：
- 保留 `directory-picker.ts` 在 `utils/dom/`，但将 `getApp()` 调用改为通过 `backend/platform.ts` 的桥接口传入（类似 `registerErrorDiary` 的注入范式）
- 或者：接受 `directory-picker.ts` 对 `backend/app.ts` 的依赖——它是「需要 Wails 绑定的 UI 原语」，与 ADR-189 D4 的「纯 DOM 原语」定位有差异但属灰区，可允许

**折中方案（暂缓）**：`directory-picker.ts` 暂不迁移，仅在知识卡记录灰区，后续看是否有更多平台感知型组件需要归位时再统一处理。

---

## 3. 后果（Consequences）

**正面**
- 断掉 `utils/dom → backend` 依赖环，`utils/dom` 回归纯 DOM 原语定位
- `android-bridge` + `platform` 合并后消除 re-export shim，符号单一事实源
- `capabilities` 归位 backend 后，能力矩阵逻辑集中，新增平台特有能力只需改一处

**负面 / 成本**
- D2/D3 涉及 25+ 21 = 46 处 import 路径变更，机械替换但 diff 面大
- 需同步更新 `android-bridge.test.ts` / `capabilities.test.ts` 的路径引用
- `directory-picker.ts` 的测试需在迁移后确认仍覆盖 Android 桥 re-export 路径

**已知遗留**
- `directory-picker.ts` 仍 import `backend/app.ts`，属于灰区消费，未在本 ADR 范围内处理
- 若未来有更多「平台感知型 UI 原语」出现（如 `android-events.ts` 等），需评估是否统一归位

---

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `grep -rl "from.*utils/dom/android-bridge" frontend/src` | 25 处消费点（含测试） |
| `grep -rl "from.*utils/dom/capabilities" frontend/src` | 21 处消费点（含测试） |
| `grep -rl "from.*utils/dom/directory-picker" frontend/src` | 4 处消费点 |
| `frontend/src/backend/platform.ts` 头注释 | ADR-123 P3 已声明探测原语下沉意图 |
| `frontend/src/utils/dom/android-bridge.ts:4` | 头注释自陈「re-export shim，保持既有消费方导入路径不变」 |
