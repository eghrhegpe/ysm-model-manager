#!/usr/bin/env node
/**
 * 契约测试：仓库文件写绑定成功路径必须失效扫描缓存（锐评 2026-10-10 文件操作审计）。
 *
 * 背景：internal/app 薄壳把文件 CRUD 转发 go/fileops（纯执行层、不碰缓存，分层正确），
 * 缓存失效责任归 app 层绑定。`app_files.go` 的 RenameDir / RemoveDir / RenameFile /
 * WriteModelFolder(importModelFolderAs) 全部在成功路径调 `scanner.InvalidateCache()`，
 * 注释逐条写着「否则 30s 内旧名/已删目录仍可被扫描命中」——这是本域既定家族约定。
 * 审计发现 MoveModelFile / CopyModelFile 独漏：右键移动/复制后前端 tree:reload 命中
 * 旧扫描缓存 ≤TTL（旧位置仍在、新位置不出现），watcher 只在 McRoot 已配且有整合包时兜底
 * （syncAll 无实例短路），查看器模式无任何兜底。已补两行 + 单测 TestMoveCopyModelFile_InvalidatesScanCache。
 *
 * 本测试把「家族约定」固化为源码结构闸：app_files.go 里每个 `return fileops.<写操作>` 的
 * **直返形态**（无成功路径失效）一律违规。豁免 CreateDir（建空目录，不产模型条目、
 * 不改扫描结果）与只读函数。
 *
 * 规则：
 *   1. 扫描 internal/app/**.go（非测试）里 `fileops.X(` 调用点，X ∈ FILE_WRITE_OPS。
 *   2. 调用点所在函数体（含 defer 也算，但 defer 须显式调 InvalidateCache/InvalidatePath）
 *      必须出现 scanner.Invalidate 之一，否则违规。
 *
 * 运行：node tests/test_fileops_write_invalidate.ts（或经 _lib/contract-tests.ts 统一入口）。
 * 退出码：0 全绿；非 0 断言失败。
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_DIR = path.join(ROOT, "internal", "app");

/**
 * 会改「可被扫描的仓库文件树」的 go/fileops 操作。
 * CreateDir 排除：建空目录不产模型条目。只读操作（FindPreviewImage 等）不在列。
 */
const FILE_WRITE_OPS = [
  "RenameDir",
  "RemoveDir",
  "RenameFile",
  "MoveModelFile",
  "CopyModelFile",
  "WriteModelFolder",
  "ToggleModelEnable", // 启禁改文件名（.disabled/.ban 增删），扫描结果随变
];

function productionGoFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      out.push(...productionGoFiles(abs));
      continue;
    }
    if (!e.name.endsWith(".go") || e.name.endsWith("_test.go")) continue;
    out.push(abs);
  }
  return out;
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, "");
}

/** 定位调用点所属函数体（从 `\nfunc ` 起，到配平 `}`）。 */
function enclosingFuncBody(text, idx) {
  const start = text.lastIndexOf("\nfunc ", idx);
  if (start < 0) return null;
  const braceAt = text.indexOf("{", start);
  if (braceAt < 0 || braceAt > idx) return null;
  let depth = 0;
  for (let i = braceAt; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

const INVALIDATE = ["scanner.InvalidateCache", "scanner.InvalidatePath"];

const violations = [];
let callSites = 0;
for (const abs of productionGoFiles(APP_DIR)) {
  const text = stripComments(fs.readFileSync(abs, "utf8"));
  const relPath = path.relative(ROOT, abs).split(path.sep).join("/");
  for (const op of FILE_WRITE_OPS) {
    const re = new RegExp(`\\bfileops\\.${op}\\s*\\(`, "g");
    for (const m of text.matchAll(re)) {
      callSites++;
      const body = enclosingFuncBody(text, m.index);
      if (body === null) {
        violations.push(`${relPath}: 无法定位 fileops.${op} 调用点所属函数`);
        continue;
      }
      if (!INVALIDATE.some((inv) => body.includes(inv))) {
        const line = text.slice(0, m.index).split("\n").length;
        violations.push(`${relPath}:${line} fileops.${op} 成功路径缺 scanner.Invalidate 失效`);
      }
    }
  }
}

assert.ok(
  callSites >= 6,
  `internal/app 的 fileops 写操作调用点应 ≥6（家族约定基线），实际 ${callSites}——` +
    "若重构收敛/迁移了绑定，须同步更新 FILE_WRITE_OPS 清单与调用面。",
);

assert.deepStrictEqual(
  violations,
  [],
  "改仓库文件树的 fileops 写绑定成功路径必须失效扫描缓存（否则 tree:reload 命中 ≤TTL 旧缓存，" +
    "已改名/已删/已移走的文件仍出现、新位置不出现；watcher 查看器模式无兜底）。\n" +
    violations.map((v) => `  ${v}`).join("\n"),
);

console.log(
  `[test_fileops_write_invalidate] OK — ${callSites} 个 fileops 写调用点全部失效扫描缓存`,
);
