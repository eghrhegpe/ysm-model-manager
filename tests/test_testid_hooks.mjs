// 契约：G-1 抗脆弱测试基础设施的稳定钩子存在性（ADR-035 / Design.md §19.1）
// 关键 data-testid 被删除 / test-utils 缺失 → 契约红（防钩子静默失效）
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;

const check = (ok, msg) => {
  if (!ok) {
    console.error(`[FAIL] ${msg}`);
    failed++;
  }
};

// 1. test-utils helper 存在（G-1 ③）
check(
  existsSync(path.join(ROOT, "frontend/js/test-utils/index.ts")),
  "frontend/js/test-utils/index.ts 缺失",
);

// 2. app-tree row-tpl 关键 testid 存在（G-1 ①，前缀命名空间）
const rowTpl = readFileSync(
  path.join(ROOT, "frontend/js/widgets/app-tree/row-tpl.ts"),
  "utf8",
);
for (const tid of ["tree-file", "tree-toggle", "tree-dir", "tree-dir-toggle"]) {
  check(rowTpl.includes(`data-testid="${tid}"`), `row-tpl.ts 缺 data-testid="${tid}"`);
}

// 3. 首个组件测试存在（G-1 ④）
check(
  existsSync(path.join(ROOT, "frontend/js/widgets/app-tree/app-tree.state.test.ts")),
  "app-tree app-tree.state.test.ts 缺失",
);

if (failed > 0) {
  console.error(`\n契约失败: ${failed} 项 — testid 钩子被删除/缺失，检查 Design.md §19.1 规范`);
  process.exit(1);
}
console.log("[OK] testid 钩子契约通过");
