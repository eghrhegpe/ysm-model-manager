#!/usr/bin/env node
/**
 * 契约测试：scripts/_lib/deadcode-keys.ts 基线键派生（knip/jscpd 输出 → 稳定 key）。
 *
 * 背景（2026-10-08 技术债审计）：knip v5+ 的 `duplicates` 是**嵌套数组对**
 * `[[{name:"a"},{name:"b"}]]`，旧解析按 `.name || ""` 取标量 → 基线存出
 * `src/backend/platform.ts|duplicates|`（空名残渣）：不可读、不可归属、永远无法销账。
 * 同族第二洞：jscpd 键 `f1#f2` 曾在本文件内做 toPosix 归一（Windows 反斜杠），
 * 与 knip 键的归一化不对称地散落在主脚本两处——下沉为单一事实源，防「一处归一一处漏」。
 *
 * 覆盖：
 *   1. knipIssueKeys：标量项 / {name} 项 / duplicates 数组对（a#b）/ files 整文件项
 *   2. jscpdCloneKeys：反斜杠归一化、文件对级去行号、缺失字段兜底 "?"
 *   3. 回归锁：嵌套 duplicates 绝不产生以 "|" 结尾的空名键（基线残渣形态）
 *   4. 归属兼容：新键仍可被 _lib/deadcode-attrib.ts 的 findingFiles 正确解析
 *
 * 零依赖、纯函数、无 IO。用法：node tests/test_deadcode_keys.ts
 */
import assert from "node:assert";
import { jscpdCloneKeys, knipIssueKeys } from "../scripts/_lib/deadcode-keys.ts";
import { findingFiles } from "../scripts/_lib/deadcode-attrib.ts";

let failed = 0;
const fail = (msg: string): void => {
  console.error(`[FAIL] ${msg}`);
  failed++;
};

// ── 1. knipIssueKeys ────────────────────────────────
{
  const issues = [
    {
      file: "src/backend/platform.ts",
      exports: [{ name: "isWebEntryMode", line: 39 }],
      types: ["RawThing"],
      duplicates: [[{ name: "isViewerPlatform" }, { name: "isViewerMode" }]],
      binaries: ["wails3"],
      unresolved: ["/src/preview-3d/state/env-state.ts"],
      files: [{ name: "src/preview-3d/vendor/mmdTypes.js" }],
    },
  ];
  const keys = knipIssueKeys(issues);
  const set = new Set(keys);
  assert(set.has("src/backend/platform.ts|exports|isWebEntryMode"), "exports 标量名");
  assert(set.has("src/backend/platform.ts|types|RawThing"), "types 字符串项");
  assert(
    set.has("src/backend/platform.ts|duplicates|isViewerPlatform#isViewerMode"),
    `duplicates 数组对应展开为符号对，实际键集: ${keys.join(" , ")}`,
  );
  assert(set.has("src/backend/platform.ts|binaries|wails3"), "binaries 字符串项");
  assert(
    set.has("src/backend/platform.ts|unresolved|/src/preview-3d/state/env-state.ts"),
    "unresolved 目标路径项",
  );
  assert(
    set.has("src/backend/platform.ts|file|src/preview-3d/vendor/mmdTypes.js"),
    "files 整文件项",
  );
  // 回归锁：绝不产生空名残渣（旧 bug 形态 = "|" 结尾）
  for (const k of keys) if (k.endsWith("|")) fail(`空名残渣键再现: ${k}`);
}

// ── 2. jscpdCloneKeys ───────────────────────────────
{
  const dup = [
    { firstFile: { name: "views\\a.ts" }, secondFile: { name: "views\\b.ts" } },
    { firstFile: { name: "views/a.ts" }, secondFile: { name: "views/a.ts" } },
  ];
  const keys = jscpdCloneKeys(dup);
  assert.deepStrictEqual(
    keys,
    ["views/a.ts#views/b.ts", "views/a.ts#views/a.ts"],
    `反斜杠应归一化且自克隆保留，实际 ${JSON.stringify(keys)}`,
  );
}
// 缺失字段兜底 "?"（与旧内联实现同口径，不新增失败模式）
assert.deepStrictEqual(jscpdCloneKeys([{}]), ["?#?"], "缺失 firstFile/secondFile 应兜底 ?");

// ── 3. 归属兼容（键形态不得破坏 findingFiles）─────────
{
  const k = "src/backend/platform.ts|duplicates|isViewerPlatform#isViewerMode";
  assert.deepStrictEqual(findingFiles(k), ["src/backend/platform.ts"], "knip 键首段仍是文件");
  const j = "views/a.ts#views/b.ts";
  assert.deepStrictEqual(findingFiles(j), ["views/a.ts", "views/b.ts"], "jscpd 键仍拆两文件");
}

if (failed) {
  console.error(`✖ test_deadcode_keys: ${failed} 项失败`);
  process.exit(1);
}
console.log("✅ test_deadcode_keys 全部通过");
