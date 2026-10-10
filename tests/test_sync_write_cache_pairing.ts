#!/usr/bin/env node
/**
 * 契约测试：整合包同步写入口的双缓存配对守卫（锐评 2026-10-10 配对审计）。
 *
 * 背景：整合包页与同步 diff 各有一层 30s TTL 派生缓存——go/instance 的同步结果缓存
 * （syncItemsCache）与 go/sync 的扫盘缓存（syncScanCache）。go/sync 的写操作内部
 * `defer InvalidateSyncScanCaches()` 自带后者；但前者**不能**由 go/sync 清——
 * go/instance 导入 go/sync，反向依赖成环。所以「改了磁盘 ⇒ 必须配对清两个缓存」
 * 是 **internal/app 层**每条 ysmsync 写入口的结构契约。
 *
 * 审计发现：七条写入口六条配对，`ResolveConflicts`（冲突解决改实例/全局两侧文件）
 * 独漏 instance 一侧——整合包页继续展示旧同步状态 ≤TTL。本测试把该契约固化为门禁，
 * 防止第八条入口再漏、或有人重构时删掉配对的一半。
 *
 * 规则（生产代码不变量，测试文件豁免）：
 *   1. internal/app/**.go（非测试）里每个 SYNC_WRITE_OPS 调用点，所在函数体内必须
 *      同时出现 `instance.InvalidateSyncItemsCache` 与 `ysmsync.InvalidateSyncScanCaches`。
 *   2. 读操作（DetectConflicts / SyncResourcesWithConfig / ListVersions）不在集合内——
 *      SyncResourcesWithConfig 仅当传入 config.ConflictPolicy 非空才写盘；当前 app 层
 *      全部传 nil（app_install_instance.go 注释 D2′-a），若未来传非 nil 须入写集合。
 *
 * 边界：本测试只锁「函数体内配对存在」的结构不变量，不验运行时时序（那由
 * go/instance/instance_test.go 与 go/sync/sync_cache_test.go 的单元语义守护）。
 *
 * 依赖：node:fs / node:path（零第三方）。
 * 运行：node tests/test_sync_write_cache_pairing.ts（或经 _lib/contract-tests.ts 统一入口）。
 * 退出码：0 全绿；非 0 断言失败。
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_DIR = path.join(ROOT, "internal", "app");

/** 会改磁盘的 go/sync 写入口（别名 ysmsync 后的方法名）。 */
const SYNC_WRITE_OPS = [
  "SyncCustomToRepo", // 收编：写全局仓库目录
  "PushResources", // 推送：写实例目录
  "PullResources", // 拉取：写全局仓库目录
  "PushSingleResource", // 单条推送：写实例目录
  "PullSingleResource", // 单条拉取：写全局仓库目录
  "SyncToggleStatus", // 启禁：改实例目录文件名
  "RelinkDir", // 重链接：增删实例目录文件
  "ResolveConflicts", // 冲突解决：改实例/全局两侧文件
];

/** 生产 Go 文件（排除 _test.go） */
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

/** 剥离注释（块 + 行注释）——叙述性注释提到 ysmsync.Push 不算调用点。
 *  简化实现不处理反引号字符串里的 //；本仓 Go 代码无此类字面量，误剥方向只可能漏检。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, "");
}

/** 从索引出发回溯定位所属函数体：返回该函数从 `func ` 到配平右括号的文本。 */
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

const PAIRS = [
  "instance.InvalidateSyncItemsCache(",
  "ysmsync.InvalidateSyncScanCaches(",
];

const violations = [];
let callSites = 0;
for (const abs of productionGoFiles(APP_DIR)) {
  const text = stripComments(fs.readFileSync(abs, "utf8"));
  const relPath = path.relative(ROOT, abs).split(path.sep).join("/");
  for (const op of SYNC_WRITE_OPS) {
    const re = new RegExp(`\\bysmsync\\.${op}\\s*\\(`, "g");
    for (const m of text.matchAll(re)) {
      callSites++;
      const body = enclosingFuncBody(text, m.index);
      if (body === null) {
        violations.push(`${relPath}: 无法定位 ysmsync.${op} 调用点所属函数`);
        continue;
      }
      // 允许 helper 自持配对（RelinkDir 收在 app 层 relinkDir helper 内），
      // 此时调用点所在函数体即清理函数，天然满足；跨函数依赖不认。
      for (const p of PAIRS) {
        if (!body.includes(p)) {
          const line = text.slice(0, m.index).split("\n").length;
          violations.push(
            `${relPath}:${line} ysmsync.${op} 调用点所在函数缺配对 ${p.slice(0, -1)}`,
          );
        }
      }
    }
  }
}

// 断言 0：写入口集合非空转——若全部改名/删除，本测试失去意义，须显式失败。
assert.ok(
  callSites >= 7,
  `internal/app 的 ysmsync 写入口调用点应 ≥7（配对审计基线），实际 ${callSites}——` +
    "若重构收敛/迁移了入口，须同步更新本测试的 SYNC_WRITE_OPS 清单与调用面。",
);

// 断言 1：每个写调用点所在函数体双缓存配对齐全。
assert.deepStrictEqual(
  violations,
  [],
  "整合包写入口必须同函数体内配对清两个派生缓存（go/sync 不能反向依赖 go/instance，" +
    "instance 侧失效归 app 层）——缺半边 = 整合包页展示旧同步状态 ≤TTL。\n" +
    violations.map((v) => `  ${v}`).join("\n"),
);

console.log(
  `[test_sync_write_cache_pairing] OK — ${callSites} 个 ysmsync 写调用点全部双缓存配对`,
);
