#!/usr/bin/env node
/**
 * 契约测试：被 import 的 setup 模块禁 `vi.hoisted()`（2026-09-11 回归护栏）。
 *
 * 病灶（CI 实测，main CI 长期红）：
 *   `frontend/src/features/context-menu/context-menus.setup.ts` 用
 *   `const mocks = vi.hoisted(() => ({...}))` 声明 mock 句柄。该 hoisting 变换
 *   与 `--coverage` 插桩在**被 import 的 setup 模块**（非测试文件本身）中冲突，
 *   产出畸形代码 → RollupError「Parse failure: Expected ';', '}' or <eof>」，
 *   两个消费测试文件（context-menus.test.ts / context-menus-async.test.ts）静默
 *   0 test 加载失败。
 *
 * 为何难发现：`vitest run`（无覆盖）**绿**，`vitest run --coverage`（CI 命令）**红**。
 *   本地惯用 `npm test`（= `vitest run --maxWorkers 8`，无覆盖）→ 永远测不到。
 *
 * 修法：改普通模块级 `const`。vi.mock 工厂是**惰性**的（被测模块首次求值才调用），
 *   mocks 只需在工厂调用时已就绪——声明于 vi.mock 之前即天然满足，无需 hoisting。
 *
 * 本测试静态守护该约束，防止后人「好心」把 vi.hoisted 加回来。
 * 覆盖范围：全仓 *.setup.ts（当前仅 1 个；未来新增 setup 模块自动纳入）。
 *
 * 零依赖（仅 node:assert / node:fs / node:path / node:url）。
 * 运行：node tests/test_vitest_coverage_setup.ts
 */
import assert from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check, finish } from "./_lib.mts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "frontend", "src");

/** 递归收集 frontend/src 下全部 *.setup.ts。 */
function collectSetupFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) {
      out.push(...collectSetupFiles(abs));
    } else if (name.endsWith(".setup.ts")) {
      out.push(abs);
    }
  }
  return out;
}

const setupFiles = collectSetupFiles(SRC);

check("至少存在 1 个 *.setup.ts（防收集器失效导致空跑假绿）", () => {
  assert.ok(
    setupFiles.length > 0,
    "未收集到任何 setup 文件——收集器可能失效（tests/ 与 src/ 路径漂移？）",
  );
});

check("setup 模块不得使用 vi.hoisted()（与 --coverage 插桩冲突致 RollupError）", () => {
  const offenders = [];
  for (const abs of setupFiles) {
    const src = readFileSync(abs, "utf-8");
    const lines = src.split("\n");
    lines.forEach((line, i) => {
      // 剥离注释：先判整行注释（// 或 JSDoc *），再剥行尾 //。本仓注释大量引用该符号
      // （含红线说明、反引号包裹形式），不剥会把注释误报成调用。
      const trimmed = line.trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
        return;
      }
      const code = line.replace(/\/\/.*$/, "");
      if (/\bvi\.hoisted\s*\(/.test(code)) {
        offenders.push(`${path.relative(ROOT, abs)}:${i + 1}`);
      }
    });
  }
  assert.deepStrictEqual(
    offenders,
    [],
    `setup 模块禁用 vi.hoisted（改用模块级 const），涉事行：\n  ${offenders.join("\n  ")}`,
  );
});

check("context-menus.setup.ts 的 mocks 为模块级 const（修法锚点，防回退）", () => {
  const abs = path.join(SRC, "features", "context-menu", "context-menus.setup.ts");
  const src = readFileSync(abs, "utf-8");
  assert.ok(
    /^const mocks = \{/m.test(src),
    "应存在模块级 `const mocks = {`——若改为其他形态，请同步更新本断言",
  );
  assert.ok(
    !/\bvi\.hoisted\b/.test(src.replace(/\/\/.*$/gm, "")),
    "context-menus.setup.ts 不得出现 vi.hoisted 调用（详见文件头红线注释）",
  );
});

finish("setup 模块 vi.hoisted 约束守住（--coverage 下可正常加载）");
