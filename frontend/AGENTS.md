# 前端（frontend/）— AI 行为手册

> AI 处理 `frontend/` 代码时自动加载的前端专属约束（由 `.github/copilot-instructions.md` 前端部分迁移）。全项目规则见仓库根 `AGENTS.md`；3D 渲染标准见 `docs/architecture.md`；前端治理规则见 `docs/governance-rules.md`。

## 约束

- **按职责切文件**：一个文件放一个可独立工作的功能（如 DnD、同步、上传各一文件），不按行数机械切割。300-700 行的单一职责文件比拆成 5 个 80 行但耦合紧密的小文件更好维护。
- 新组件放 `components/app-xxx/`，工具函数放 `utils/`
- ES module → `app-modules.ts` 加 import；非 module → `index.html` 加 `<script>`
- 禁止在 `public/` 放 JS；改文件前先 `grep` 确认 `public/` 下无同名文件（Vite dev 优先加载 `public/`）

## 调试

- **日志优先于猜测**：遇到「逻辑对但没反应」，先加 `console.log` 看实际值，不要猜原因
- 生产环境无控制台时用 `writeDebug()`（`js/utils/debug.ts`）写桌面 `ysm-debug.log`，用完删除
- 调试日志用完即删，不留调试痕迹（见根 AGENTS §5）

## WebView2 DnD 特殊性

- `dragover` 阶段无法读取文件名（`getAsFile()` 返回 null，`webkitGetAsEntry()` 返回 null），只能 `preventDefault()` + 显示遮罩
- `drop` 阶段优先用 `dataTransfer.items` + `webkitGetAsEntry()`，兜底用 `dataTransfer.files`
- `FileSystemEntry.file(callback)` 是回调，须 Promise 化：`entry.file(callback)` → `new Promise(resolve => entry.file(resolve))`，再用 `await`
- `DataTransferItem` 没有 `.name` 属性（`File` 才有）
