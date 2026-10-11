// tests/vitest-env-switch.ts — vitest-env-switch 清单保鲜契约测试
//
// 背景（2026-10-11 收口）：脚本清单曾腐化 9 条死路（文件迁移/改名后未同步），
// 旧行为 SKIP 静默吞掉（console.warn 不退出）——死路无声。现改为 fail-closed：
//   - checkListEntries：清单条目必须全部真实存在（迁移/改名须同步清单）
//   - checkListAnnotated：清单条目必须全部已标注 node（登记即切换完成）
// 本测试锁这两个不变量，防清单再腐化。
import assert from "node:assert/strict";
import { checkListAnnotated, checkListEntries, files } from "../scripts/perf/vitest-env-switch.ts";

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

// ── 1. 清单条目存在性（fail-closed 主闸）──
check("清单条目全部真实存在（无死路）", () => {
  const r = checkListEntries();
  assert.equal(r.ok, true, `清单含死路: ${r.missing.join(", ")}`);
  assert.deepEqual(r.missing, []);
});

check("清单非空且无重复", () => {
  assert.ok(files.length > 0, "清单不应为空");
  assert.equal(new Set(files).size, files.length, "清单不应有重复条目");
});

// ── 2. 标注完整性（登记即切换完成）──
check("清单条目全部已标注 @vitest-environment node", () => {
  const r = checkListAnnotated();
  assert.equal(r.ok, true, `未标注: ${r.unannotated.join(", ")}`);
  assert.deepEqual(r.unannotated, []);
});

// ── 汇总输出 ──
if (errors.length) {
  console.error(`\nvitest-env-switch: ${errors.length} 项失败`);
  process.exit(1);
} else {
  console.log(`vitest-env-switch: 全部通过 ✅（清单 ${files.length} 条）`);
}
