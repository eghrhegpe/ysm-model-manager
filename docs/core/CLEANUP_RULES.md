> **重定向**：治理规则的决策理由已提炼至 **[ADR-005: 前端治理规则体系](../architecture/adr/ADR-005-frontend-governance-rules.md)**。
> 本文档保留检测命令速查表，供 CI 配置和手动检查使用。

# 治理规则清单

> 每条规则标注严重度 + 自动检测方式，方便 CI 拦截而非人肉 review。

| # | 规则 | 严重度 | 检测方式 | 替代方案 | 治理背景 |
|---|------|--------|----------|----------|----------|
| 1 | 禁止 `window.*` 全局变量（`window.__lastModel` / `window.$spec` 等） | **Error** | ESLint `no-restricted-globals` | 模块级 `let` + getter/setter | v1.5.1 已清理，见 `pending-cleanup.md` |
| 2 | 禁止 `cfg.repoRoot` / `repoRoot` 变量名 | **Error** | grep `repoRoot`（Go + JS，false positive 极少） | `cfg.FilesRoot`（Go）/ `filesRoot`（JS） | v1.6.4 统一 |
| 3 | 禁止回调式 API（`entry.file(callback)`） | **Warn** | ESLint `no-callback-literal` + review | `new Promise(resolve => entry.file(resolve))` | 见 `copilot-instructions.md` #11 |
| 4 | 禁止 `display: none/block` 做动画切换 | **Warn** | grep `display:\s*(none|block)` in animation context | `opacity` / `transform` / `grid-template-rows` | 见 `animation-roadmap.md` |
| 5 | 禁止硬编码颜色值 | **Warn** | stylelint + grep `#([0-9a-f]{3,8})\b` / `rgba?\(` | `var(--txt)` / `var(--bg)` 等 CSS 变量 | 见 `Design.md` §10 |
| 6 | 禁止 `public/` 下放 JS | **Error** | grep `public/.*\.js` | ESM import → `app-modules.js` | 见 `copilot-instructions.md` |
| 7 | 禁止魔法字符串 `rtype` 字面量 | **Warn** | grep `"ysm"\|"mmd-skin"\|"vrchat-avatar"` 在 JS 中 | `types/resource.go` 常量 / `RESOURCE_TYPES` 常量 | 枚举已定义 |
| 8 | 禁止未转义拼接 HTML | **Error** | CodeQL / grep `innerHTML\s*=\s*.*\+` | `esc()` / `renderFormattedText()` / `renderDisplayName()` | copilot XSS 加固 |
| 9 | 禁止 `public/` 侧边栏手动拼接 | **Warn** | grep `sidebarItem\|tb-btn.*title=` | 统一用 `renderSidebar()` 模板函数 | 可复用性 |

## 检测命令速查

```powershell
# 规则 1
grep -rn "window\." frontend/js/ --include="*.js" | Select-String -NotMatch "window\.addEventListener|window\.document"

# 规则 2
grep -rn "repoRoot" . --include="*.go" --include="*.js" --include="*.json"

# 规则 5
rg "#[0-9a-f]{6}\b" frontend/ --include="*.js" --include="*.css"

# 规则 7
rg '"ysm"|"mmd-skin"|"vrchat-avatar"' frontend/js/ --include="*.js"

# 规则 8
rg 'innerHTML\s*=' frontend/js/ --include="*.js"
```
