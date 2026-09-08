#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { finish, ok, runScript } from "./_lib.mts";

const _ROOT = process.cwd();

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ysm-status-contract-"));
const TMP_CARD = path.join(TMP_DIR, "zzz-status-contract-tmp.md");

function writeTmpCard(statusLines) {
  const fm = [
    "---",
    "kind: zzz-status-contract-tmp",
    "name: status 契约测试临时卡",
    "tier: leaf",
    "category: utils",
    ...statusLines,
    "source_files:",
    "  - frontend/src/utils/array.ts",
    "use_when:",
    "  - 临时测试",
    "---",
    "",
    "# status 契约测试临时卡",
    "",
    "## 概览",
    "",
    "契约测试用临时卡，测完即删。",
    "",
  ].join("\r\n");
  fs.writeFileSync(TMP_CARD, fm, "utf8");
}

function runDrift() {
  const r = runScript("check-knowledge-drift.ts", "--json", "--kc-dir", TMP_DIR);
  let out = { errors: [], warns: [] };
  try {
    out = r.stdout ? JSON.parse(r.stdout) : out;
  } catch {
    /* 解析失败保持空 */
  }
  return { status: r.status, out };
}

console.log("=== 知识卡 status 生命周期契约 ===");

try {
  // 1. 合法 status：active → 无 ERROR
  writeTmpCard(["status: active"]);
  let { status, out } = runDrift();
  ok("status: active → 无 ERROR", out.errors.length === 0, `errors=${out.errors.join("; ")}`);
  ok("退出码 0", status === 0, `status=${status}`);

  // 1.5 合法 status：draft（新词表值）→ 无 ERROR
  writeTmpCard(["status: draft"]);
  ({ status, out } = runDrift());
  ok("status: draft → 无 ERROR", out.errors.length === 0, `errors=${out.errors.join("; ")}`);

  // 2. 词表外 status → ERROR 且提示词表
  writeTmpCard(["status: banana"]);
  ({ status, out } = runDrift());
  ok(
    "status: banana → ERROR 且含词表提示",
    out.errors.some(
      (e) => e.includes("status 非法") && e.includes("banana") && e.includes("active"),
    ),
    `期望 ERROR 含词表: ${out.errors.join("; ").slice(0, 300)}`,
  );
  ok("ERROR → 退出码 1", status === 1, `status=${status}`);

  // 3. status: snapshot 缺 affected:false → WARN（不阻断）
  writeTmpCard(["status: snapshot"]);
  ({ status, out } = runDrift());
  ok(
    "snapshot 缺 affected:false → WARN",
    out.warns.some((w) => w.includes("snapshot") && w.includes("affected: false")),
    `期望 WARN: ${out.warns.join("; ").slice(0, 300)}`,
  );
  ok("WARN 不阻断 → 退出码 0", status === 0, `status=${status}`);

  // 4. status: snapshot + affected:false → 无此 WARN
  writeTmpCard(["status: snapshot", "affected: false"]);
  ({ status, out } = runDrift());
  ok(
    "snapshot + affected:false → 无 WARN",
    !out.warns.some((w) => w.includes("snapshot") && w.includes("affected: false")),
    `不应有 snapshot WARN: ${out.warns.join("; ").slice(0, 300)}`,
  );

  // 5. 无 status 字段（存量 0 卡 + 新模板 draft 前的写法）→ 无 ERROR（缺省不报）
  writeTmpCard([]);
  ({ status, out } = runDrift());
  ok("无 status 字段 → 无 ERROR", out.errors.length === 0, `errors=${out.errors.join("; ")}`);
} finally {
  if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true, force: true });
}

finish("知识卡 status 生命周期契约全过");
