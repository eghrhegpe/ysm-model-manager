# ADR-010：资源类型字面量硬编码治理

- **状态**：✅ 已采纳（2026-08-03 清零完成）
- **日期**：2026-08-03
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`resource_types.json` / `frontend/js/` 全量 / CLEANUP_RULES.md §7

---

## 1. 背景（Context）

CLEANUP_RULES.md 第 7 条明确规定：**禁止在 JS 中使用 `"ysm"` / `"mmd-skin"` / `"vrchat-avatar"` 等魔法字符串字面量**，应使用 `RESOURCE_TYPES` 常量或 `types/resource.go` 常量。

但实际代码扫描发现，资源类型字面量**仍然大量存在于前端 JS 中**。

### 违规统计（2026-08-03 已清零，下表为 .js 时代历史记录）

| 文件 | 违规字面量 | 位置 |
|------|-----------|------|
| `context-menus.js` | `"ysm"` | 4 处（`GetRepoRoot("ysm")`） |
| `handler-dnd.js` | `"ysm"` | 1 处（`DetectZipType(base64) === "ysm"`） |
| `handler-sync.js` | `"ysm"`, `"mmd-skin"` | 4 处（`rtypeActual = rtype || "ysm"` 等） |
| `handler-upload.js` | `"ysm"` | 1 处（`GetRepoRoot("ysm")`） |
| `oldest-models.js` | `"ysm"` | 1 处（`localStorage 回退 "ysm"`） |
| `recycle-bin.js` | `"ysm"` | 1 处（同上） |
| `app-content/tpl.js` | `"ysm"`, `"mmd-skin"`, `"vrchat-avatar"` | 4 处（HTML 模板中 `data-rtab` 属性值） |
| `import-queue.js` | `"ysm"` | 多处（`GetRepoRoot("ysm")`） |
| `rename.js` | `"ysm"` | 2 处（扩展名默认值） |
| `batch-rename.js` | `"ysm"` | 1 处（扩展名默认值） |

**总计约 25+ 处**。其中 `context-menus.js` 一家独占 4 处 `GetRepoRoot("ysm")`。

---

## 2. 决策（Decision）

**决策**：资源类型字面量以 `resource_types.json` 为单一事实来源，前端通过 `RESOURCE_TYPES` 常量引用。
当前违规为历史遗留，不立即修复。

### 2.1 为什么是 25+ 处仍未清理

1. **`GetRepoRoot("ysm")` 是参数，不是类型判断**：Go 端 `GetRepoRoot` 接受字符串参数指定资源类型，
   这是函数调用而非类型声明，grep 检测时无法区分
2. **`tpl.js` 中的 `data-rtab` 属性值**：HTML 模板字符串中的字面量是 UI 数据，
   与类型判断无关，但 grep 规则会命中
3. **`detectZipType() === "ysm"` 是返回值判断**：这是类型判断，应替换为常量，但目前未替换
4. **扩展名默认值**：`rename.js` / `batch-rename.js` 中的 `"ysm"` 是扩展名默认值，
   不是资源类型标识，属于误判但实际也是硬编码

### 2.2 哪些真正需要修

| 类型 | 位置 | 是否该修 | 理由 |
|------|------|----------|------|
| 函数参数 `GetRepoRoot("ysm")` | 多处 | ⚠️ 建议修 | 参数名语义化，但实际是类型标识 |
| 返回值判断 `=== "ysm"` | `handler-dnd.js` | ✅ 应修 | 直接类型判断，违反规则 |
| HTML 属性 `data-rtab="ysm"` | `tpl.js` | ❌ 不修 | 数据属性值，非类型常量 |
| 扩展名默认值 `|| "ysm"` | `rename.js` | ⚠️ 建议修 | 虽是默认值，但语义即资源类型 |

---

## 3. 后果（Consequences）

### 正面
- `resource_types.json` 是唯一事实来源，新增资源类型只需改一处
- `RESOURCE_TYPES.YSM` / `.MMD` / `.VRC` 比 `"ysm"` / `"mmd-skin"` 拼写错误风险低

### 负面
- 25+ 处违规意味着 CLEANUP_RULES.md §7 目前是"纸面规则"
- 新增资源类型时如果不替换所有字面量，会出现"类型已注册但前端用旧字符串"的不一致
- `GetRepoRoot("ysm")` 和 `DetectZipType() === "ysm"` 的语义不同（一个是参数、一个是判断），
  统一替换时需要注意区分

### 修复成本估算
- `GetRepoRoot` 调用点：~8 处，替换为 `GetRepoRoot(RESOURCE_TYPES.YSM)` 即可
- `tpl.js` 模板属性：暂不修，但需在注释中说明数据属性与类型常量的区别
- `DetectZipType` 判断：~1 处，替换为 `=== RESOURCE_TYPES.YSM`

---

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| grep `"ysm"` 全量扫描 | 25+ 处命中 |
| `resource_types.json` | 资源类型事实来源 |
| `CLEANUP_RULES.md` §7 | 禁止魔法字符串规则 |
| `utils/resource-types.js` | `RESOURCE_TYPES` 常量定义（如存在） |

---

## 5. 治理完成（2026-08-03）

**状态更新**：原"已采纳（违规未修复）"→ ✅ 已采纳。commit `b6a74c3` 完成全量治理：

- `GetRepoRoot("ysm")` 21 处（9 个文件）→ `GetRepoRoot(RESOURCE_TYPES.YSM)`
- 魔法字符串 30+ 处（`"mmd-skin"` / `"vrchat-avatar"` / `"resourcepack"` / `"shaderpack"` /
  `"create-blueprint"` / `"litematic"` / `"ysm"`）→ `RESOURCE_TYPES` 常量：tab 判断、
  `DetectZipType()` 返回值判断、rtype 数组、mock 数据、HTML 模板 `data-rtab` /
  `data-sync-type` / `root` 属性（输出值不变，纯写法迁移）
- 顺手消除：`sidebar/tpl.ts` push/pull 两组下拉菜单重复 → 提取 `typeMenuItemsHTML()` 共用
- 保留合理字面量：`extensions.ts`（↔ resource_types.json 的桥）、`RTYPE_LABELS` /
  `shortLabel`（显示名映射）、preview-litematic-meta 的 `"schematic"` / `"nbt"`
  （文件类型标签，非资源类型 ID）

验证：`type-consistency.mjs` 全一致、`tsc --noEmit` 通过、`check-deadcode-baseline` 0 ERROR、
`doctor` 全绿（退出码 0）。
