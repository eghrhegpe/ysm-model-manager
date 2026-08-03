# ADR-011：前端路径拼接分隔符不一致

- **状态**：已采纳（Accepted，违规未修复）
- **日期**：2026-08-03
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/js/core/context-menus.js` / `frontend/js/components/app-tree/bus-handlers.js` / `frontend/js/features/import-queue.js` / `frontend/js/components/app-content/community/settings.js`

---

## 1. 背景（Context）

AGENTS.md §七明确指出：**路径分隔符统一正斜杠 `/`**。
这是整个项目的前端路径操作硬规则。

但实际代码扫描发现，前端 JS 中存在**两种路径拼接风格混用**：

### 使用 `/` 的位置（正确）

| 文件 | 行 | 代码 |
|------|----|------|
| `context-menus.js` | 121 | `repoRoot + "/" + folder.replace(/\\/g, "/")` |
| `context-menus.js` | 175 | 同上 |
| `context-menus.js` | 321 | 同上 |
| `context-menus.js` | 362 | 同上 |
| `bus-handlers.js` | 128 | `repoRoot ? repoRoot + "/" + dir : dir` |
| `bus-handlers.js` | 157 | `repoRoot + "/" + dir + "/" + name.trim()` |
| `bus-handlers.js` | 187 | 同上 |
| `bus-handlers.js` | 234 | 同上 |
| `settings.js` | 109 | `cfg.filesRoot + "\\" + ...` | ← **此处是反斜杠** |

### 使用 `\` 的位置（违规）

| 文件 | 行 | 代码 |
|------|----|------|
| `import-queue.js` | 108 | `fullPath = (repoRoot \|\| "") + "\\" + name` |
| `import-queue.js` | 372 | `(_ysmRoot \|\| "") + "\\" + newName` |
| `import-queue.js` | 717 | `fullPath = repoRoot + "\\" + name` |

**合计**：8 处正确 + **3 处违规**。

### 后果分析

项目运行在 Windows 上（AGENTS.md §七确认），Go 端 `os` 包和 `path/filepath` 原生支持反斜杠。
所以当前代码在功能上**不报错**——`\\` 和 `/` 在 Windows 上都能工作。

**但问题出在跨系统一致性和数据流转上**：

```js
// import-queue.js:108 — 反斜杠
const fullPath = (repoRoot || "") + "\\" + name;

// context-menus.js:121 — 正斜杠
const dstDir = repoRoot + "/" + folder.replace(/\\/g, "/");
```

同一个 `repoRoot` 值，在 `import-queue.js` 里用 `\` 拼接，在 `context-menus.js` 里用 `/` 拼接。
当这些路径最终传给 Go 端时，Go 端 `os.Open` 在 Windows 上能处理两种分隔符，
但如果路径经过 `net/url`、`filepath.Join` 或其他 Go 标准库函数，混用分隔符可能导致行为异常。

---

## 2. 决策（Decision）

**决策**：前端 JS 中所有路径拼接统一使用正斜杠 `/`，不使用反斜杠 `\`。

### 2.1 理由

- AGENTS.md §七已明确"路径分隔符统一正斜杠 `/`"
- 正斜杠在所有操作系统上都是合法路径分隔符（Windows 也接受）
- Go 端 `path/filepath` 在接收路径时会自动转换为系统分隔符
- 反斜杠在 JS 字符串中需要转义（`\\`），容易出错

### 2.2 修复范围

| 文件 | 修复内容 |
|------|----------|
| `import-queue.js:108` | `"\\"` → `"/"` |
| `import-queue.js:372` | `"\\"` → `"/"` |
| `import-queue.js:717` | `"\"` → `"/"` |
| `settings.js:109` | `"\\"` → `"/"` |

### 2.3 为什么 `settings.js` 也违规

`settings.js:109` 的路径拼接：
```js
(cfg.filesRoot + "\\" + (reg[t.rtype]?.storageSubDir || t.rtype || "")).replace(
```
这是 Windows 特有的反斜杠拼接，且后面还链式 `.replace()` 做二次处理——
说明代码作者对反斜杠本身也不信任，先用 `\` 拼再用 `replace` 修正，
逻辑上是"先用错了再补救"。

---

## 3. 后果（Consequences）

### 正面
- 修复后前端所有路径拼接风格统一，符合 AGENTS.md §七
- 减少跨路径函数的隐式转换开销

### 负面
- 修复是机械替换（`\` → `/`），风险极低
- 但需要确认 Go 端 `GetRepoRoot` / `filesRoot` 返回值本身已经是正斜杠格式，
  否则路径拼接会产生 `C:/repo//subdir`（双斜杠）等冗余
- Go 端 `os` 包在 Windows 上能处理双斜杠，但语义不清

### 已知风险
- Go 端返回的 `FilesRoot` 可能是 `C:\Users\...\ysm-model-manager\repo`（反斜杠），
  前端追加 `/` 后变成 `C:\Users\...\repo/subdir`，这种混合路径在 Go 端能工作但语义混乱
- **根本解决**：Go 端 `FilesRoot` 返回时统一转为正斜杠（`strings.ReplaceAll(p, "\\", "/")`）

---

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| grep `+ "\\\\"` 全量扫描 | 4 处命中（import-queue.js ×3, settings.js ×1） |
| grep `+ "/" +` 全量扫描 | 8 处命中（context-menus.js ×4, bus-handlers.js ×4） |
| AGENTS.md §七 | "路径分隔符统一正斜杠 /" |
