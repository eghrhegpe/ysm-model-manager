# SearchModels 调用契约检查器

## 目标

禁止前端绕过 Wails bindings 直接调用 `window.go.main.App.SearchModels(...)`，确保所有搜索调用都经过强类型 bindings。

## 现状问题

`44b31b74` 提交发现：前端用 `window.go.main.App.SearchModels(filesRoot, keyword, ...)` 这种 `any` 路径调用，参数个数错位编译器不报错。bindings 本身是强类型的（8 个明确参数），但前端绕过了它。

## 解法 A：禁止绕过 bindings（推荐）

### 步骤

1. **创建检查脚本** `frontend/scripts/check-binding-usage.ts`
   - 扫描 `frontend/src/` 下所有 `.ts/.js` 文件
   - 匹配正则：`window\.go\.main\.App\.\w+\(`
   - 排除 bindings 声明文件（`bindings.ts`）
   - 输出违规调用列表 + 行号

2. **集成到 CI/构建**
   - 在 `package.json` 的 `scripts` 加 `"check-bindings": "node scripts/check-binding-usage.ts"`
   - 在 `typecheck` 或 `build` 前调用

3. **可选：ESLint 规则**
   - 配置 `no-restricted-syntax` 规则禁止 `MemberExpression` 访问 `window.go.main.App`
   - 或自定义 ESLint 插件

### 预期产出

```bash
npm run check-bindings
# 输出：
# ⚠️ 违规调用 detected:
# src/search/index.ts:45: window.go.main.App.SearchModels(...)
# src/search/index.ts:128: window.go.main.App.FilterModels(...)
# 
# 请改用 bindings 导入的函数
```

## 解法 B：参数个数契约测试（增强）

在 `generate:bindings` 后跑 ts-morph 解析调用点，断言参数个数匹配。

### 触发条件

- 解法 A 落地后仍发现绕过情况
- 或需要防御性断言（即使用了 bindings，也要保证调用参数正确）

### 实现

```typescript
// scripts/check-binding-contract.ts
import { Project, Symbol } from 'ts-morph';

const project = new Project();
const bindings = project.addSourceFileAtPath('frontend/src/bindings.ts');
const callSites = project.addSourceFileAtPath('frontend/src/search/index.ts');

// 对每个 binding 函数，断言调用点参数个数一致
```

## 验证方式

```bash
cd frontend
npm run check-bindings  # 通过（无输出）
# 或故意加入 window.go.main.App.xxx 调用，应报错
```

## 知识卡更新

- 本方案记录完成后，更新 `docs/knowledge/` 相关卡片的 `source_files` 字段
- 使用 `node scripts/new-knowledge-card.ts binding-check <file> <category>` 创建新卡

## 实施结果（已完成）

- ✅ `frontend/scripts/check-binding-usage.ts` 创建
- ✅ `package.json` 添加 `"check-bindings"` 脚本 + `"type": "module"`
- ✅ `typecheck` 前自动调用 `check-bindings`
- ✅ 验证通过：当前无绕过调用

## 提交策略

```bash
git add frontend/scripts/check-binding-usage.ts
git add frontend/package.json
git commit -m "chore: add binding usage checker to enforce bindings-only Go calls"
```
