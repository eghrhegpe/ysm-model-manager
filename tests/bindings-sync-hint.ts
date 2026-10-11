// tests/bindings-sync-hint.ts — bindings 同步提醒钩子契约测试
//
// 覆盖纯函数（不触发真实 git / wails3，保持快速确定）：
//   1. needsBindingsHint：判定口径（绑定面源改动 ∧ 无生成物同步 → 提醒）
//   2. 边界：go/ CLI 不改动不触发；_test.go 不算绑定面；生成物在场不提示；空集不提示
import assert from "node:assert/strict";
import {
  BINDINGS_ARTIFACT_PREFIX,
  BINDING_SOURCE_PREFIX,
  needsBindingsHint,
} from "../scripts/hooks/bindings-sync-hint.ts";

const errors = [];
function check(name, fn) {
  try {
    fn();
    console.log(`  ok - ${name}`);
  } catch (e) {
    errors.push(`${name}: ${e.message}`);
    console.error(`  FAIL - ${name}\n    ${e.message}`);
  }
}

// ── 1. 判定口径 ──
check("改绑定面源文件但无生成物同步 → 提示", () => {
  assert.equal(
    needsBindingsHint(["internal/app/app.go", "docs/foo.md"]),
    true,
    "internal/app/*.go 改动 + 无 bindings 产物应提示",
  );
});

check("绑定面源 + 生成物同 commit → 不提示", () => {
  assert.equal(
    needsBindingsHint([
      "internal/app/app.go",
      "frontend/bindings/ysm-model-manager/internal/app/app.ts",
    ]),
    false,
    "生成物已随 commit 同步即不提示（正确闭环）",
  );
});

// ── 2. 边界 ──
check("go/ CLI 改动不触发（非绑定面）", () => {
  assert.equal(needsBindingsHint(["go/cli/main.go"]), false);
  assert.equal(needsBindingsHint(["go/scanner/scanner.go"]), false);
});

check("_test.go 不算绑定面改动", () => {
  assert.equal(needsBindingsHint(["internal/app/app_test.go"]), false);
});

check("非 .go 的 internal/app 文件不触发", () => {
  assert.equal(needsBindingsHint(["internal/app/README.md"]), false);
});

check("仅生成物改动不触发（无源改动）", () => {
  assert.equal(
    needsBindingsHint(["frontend/bindings/ysm-model-manager/internal/app/app.ts"]),
    false,
  );
});

check("空集 / 非数组不提示", () => {
  assert.equal(needsBindingsHint([]), false);
  assert.equal(needsBindingsHint(null), false);
  assert.equal(needsBindingsHint(undefined), false);
});

check("Windows 反斜杠路径归一（防御）", () => {
  assert.equal(
    needsBindingsHint(["internal\\app\\app.go"]),
    true,
    "反斜杠路径应归一为 posix 后判定",
  );
});

// ── 3. 常量口径 ──
check("判定域常量与 binding-check 扫描面一致", () => {
  assert.equal(BINDING_SOURCE_PREFIX, "internal/app/");
  assert.equal(BINDINGS_ARTIFACT_PREFIX, "frontend/bindings/");
});

// ── 汇总输出 ──
if (errors.length) {
  console.error(`\nbindings-sync-hint: ${errors.length} 项失败`);
  process.exit(1);
} else {
  console.log("bindings-sync-hint: 全部通过 ✅");
}
