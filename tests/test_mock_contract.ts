// ===== 契约测试：mock-data.ts 与 Wails binding 导出双向对齐 =====
// 守护目标：binding 新增函数 → mock 必须补 key（否则 CI 红）；
//           binding 删除函数  → mock 旧 key 变死代码（tsc 守卫已覆盖，此脚本补运行时报告）。
//
// 与 frontend/e2e/mock-data.ts 的编译期类型守卫（__mockBindingContract /
// __mockBindingReverseContract）互补：后者需 tsc 才触发，本脚本是纯 Node 运行，
// 可直接被 tests/*.mjs 批量调用，也可在 CI 非 TypeScript 阶段跑。
//
// 运行：node tests/test_mock_contract.mjs

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;

// ─── 工具 ─────────────────────────────────────────────────────────────────────

/** 累加失败信息 */
function fail(msg) {
  console.error(`[FAIL] ${msg}`);
  failed++;
}

/** 从文件内容里提取所有 `export function FnName(` 的函数名 */
function extractBindingFunctions(filePath) {
  const content = readFileSync(filePath, "utf8");
  const re = /export function (\w+)\(/g;
  const names = new Set();
  let m;
  while ((m = re.exec(content)) !== null) {
    names.add(m[1]);
  }
  return names;
}

/**
 * 从 mock-data.ts 解析 MOCK_DATA 对象的所有顶层键。
 * 策略：找 `export const MOCK_DATA = { ... }`，用栈平衡找到匹配的右花括号，
 * 再从中提取 `"Key":` 或 `Key:` 形式的键名（跳过注释行和嵌套对象内部）。
 */
function extractMockKeys(filePath) {
  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n");

  // 找到 MOCK_DATA 声明行
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/export\s+const\s+MOCK_DATA\s*=/.test(lines[i])) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) {
    fail("mock-data.ts 未找到 MOCK_DATA 声明");
    return new Set();
  }

  // 从 startIdx 开始平衡花括号，找到对象结束位置
  let braceDepth = 0;
  let inObj = false;
  const keys = new Set();
  // 匹配 KeyName: 或 "KeyName": — mock-data.ts 用无引号键（Go export 风格）
  const topLevelKeyRe = /^  (\w+)\s*:/;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    // 检测对象起始
    if (!inObj && line.includes("{")) {
      inObj = true;
      braceDepth = (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
      // 检查该行是否有顶层键
      const tm = topLevelKeyRe.exec(line);
      if (tm) keys.add(tm[1]);
      continue;
    }
    if (!inObj) continue;

    braceDepth += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
    if (braceDepth <= 0) {
      // 对象结束
      break;
    }
    // 顶层键（缩进 2 空格）
    const tm = topLevelKeyRe.exec(line);
    if (tm) keys.add(tm[1]);
  }

  return keys;
}

// ─── 主逻辑 ───────────────────────────────────────────────────────────────────

const BINDING_FILE = path.join(ROOT, "frontend/bindings/ysm-model-manager/internal/app/app.ts");
const MOCK_FILE = path.join(ROOT, "frontend/e2e/mock-data.ts");

// 1. 扫描 binding 导出
if (!existsSync(BINDING_FILE)) {
  fail(`binding 文件不存在: ${BINDING_FILE}（可能尚未 generate:bindings）`);
  process.exit(1);
}
const bindingFuncs = extractBindingFunctions(BINDING_FILE);
console.log(`[info] bindings/app.ts 导出 ${bindingFuncs.size} 个函数`);

// 2. 解析 mock 键集合
if (!existsSync(MOCK_FILE)) {
  fail(`mock-data.ts 不存在: ${MOCK_FILE}`);
  process.exit(1);
}
const mockKeys = extractMockKeys(MOCK_FILE);
console.log(`[info] mock-data.ts MOCK_DATA 包含 ${mockKeys.size} 个键`);

// 3. 正向：binding 有但 mock 缺 → 缺失（会导致 E2E 运行时 bridge 方法 undefined）
const missingInMock = [...bindingFuncs].filter((f) => !mockKeys.has(f));
for (const f of missingInMock) {
  fail(`binding 导出 ${f}() 在 mock-data.ts 中缺失键（需在 MOCK_DATA 补充）`);
}

// 4. 反向：mock 有但 binding 无 → 过时死代码（运行时注入 window.go 但无人消费）
const staleInMock = [...mockKeys].filter((k) => !bindingFuncs.has(k));
for (const k of staleInMock) {
  fail(`mock-data.ts 含键 ${k}，但 bindings/app.ts 未导出（可能 binding 已删除，请清理 mock）`);
}

// 5. 汇总
if (failed > 0) {
  console.error(
    `\n契约失败: ${failed} 项 — mock-data.ts 与 binding 导出不对齐，请同步修正`,
  );
  process.exit(1);
}
console.log("[OK] mock-binding 契约通过（双向对齐）");
