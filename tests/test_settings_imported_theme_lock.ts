#!/usr/bin/env node
/**
 * 契约测试：settings:imported 主题镜像因果链的源码回归锁（二轮锐评 2026-10-17 P2⑧）。
 *
 * 背景：导入/恢复磁盘设置后，前端必须经 `emit("settings:imported")` → app-content
 * 订阅回调内 `initTheme()` 重算主题镜像——这是一轮锐评 P1② 修复建立的因果链
 * （磁盘 theme 变了、镜像键 authority=dual-write 不回写，不重算则 UI 与真相分叉
 * 挂到下次重启）。但链两端此前只被 settings-backup.test.ts 的 mock-bus 钉住
 * 「emit 被调用」，消费侧（订阅回调里有 initTheme）无任何回归锁：重构 app-content
 * 生命周期时手滑删掉一行，主题镜像重算静默消失，全仓测试仍绿。
 *
 * 本锁用源码级断言（与 test_settings_key_ledger.ts 同风格——只锁结构不锁行为，
 * 行为面仍由 vitest 承担）：
 *   A. 发射侧：settings-backup.ts 存在 emit("settings:imported")
 *   B. 消费侧：app-content/index.ts 的 settings:imported 订阅回调体内有 initTheme() 调用
 *   C. 前提侧：index.ts 确实 import 了 initTheme（防 B 的窗口匹配到注释孤例）
 *
 * 依赖：node:fs / node:path（零第三方）。
 * 运行：node tests/test_settings_imported_theme_lock.ts（或经 scripts/contract-tests.ts 全量枚举）。
 * 退出码：0 全绿；非 0 断言失败。
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// A. 发射侧：导入/恢复完成后必须广播 settings:imported（唯一出口 settings-backup.ts）
const backup = read("frontend/src/views/app-content/settings/settings-backup.ts");
const emitHits = backup.match(/emit\(\s*["']settings:imported["']\s*\)/g) ?? [];
assert.ok(
  emitHits.length >= 1,
  "settings-backup.ts 不再 emit(\"settings:imported\")——导入/恢复后的 UI 同步链已断裂",
);
console.log(`✔ A 发射侧：settings-backup.ts emit("settings:imported") ×${emitHits.length}`);

// B. 消费侧：订阅回调体内必须调 initTheme()（重算并回写主题镜像）
const index = read("frontend/src/views/app-content/index.ts");
assert.ok(
  /"settings:imported"[\s\S]{0,800}?initTheme\s*\(\s*\)/.test(index),
  "app-content/index.ts 的 settings:imported 订阅回调 800 字符窗口内没有 initTheme() 调用——" +
    "导入磁盘 theme 后镜像不再重算（一轮锐评 P1② 回归）。" +
    "若确属重构搬迁，请把同一因果链迁到新的唯一消费点并同步更新本锁。",
);
console.log("✔ B 消费侧：订阅回调体内 initTheme() 在位");

// C. 前提侧：initTheme 必须来自真实 import（防窗口命中的是注释/字符串孤例）
assert.match(
  index,
  /import[^;]*\binitTheme\b[^;]*from\s["'][^"']+["']/,
  "app-content/index.ts 没有 import initTheme——B 命中的可能是注释孤例",
);
console.log("✔ C 前提侧：initTheme import 在位");

console.log("settings:imported 主题镜像回归锁：全绿");
