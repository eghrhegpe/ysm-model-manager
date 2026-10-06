#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { finish, ok, runScript } from "./_lib.mts";

const _ROOT = process.cwd();

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ysm-status-contract-"));
const TMP_CARD = path.join(TMP_DIR, "zzz-status-contract-tmp.md");

function writeTmpCard(statusLines, opts = {}) {
  const sources = opts.omitSources
    ? []
    : [
        "source_files:",
        "  - frontend/src/utils/base/pure/array.ts",
      ];
  const fm = [
    "---",
    "kind: zzz-status-contract-tmp",
    "name: status 契约测试临时卡",
    "tier: leaf",
    "category: utils",
    ...statusLines,
    ...(opts.fmExtra || []),
    ...sources,
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

  // 6. 演进态 status + affected:false + 无 source_files → WARN（卡完全无漂移安全网）
  //    画像：extensibility-round2.md 曾以 status: active + affected:false + 无 source_files 存在，
  //    源码领先卡 6 周无人告警，2026-10 审计才发现 2 个已删除符号写进正文。
  writeTmpCard(["status: active", "affected: false"], { omitSources: true });
  ({ status, out } = runDrift());
  ok(
    "active + affected:false + 无 source_files → WARN（无漂移安全网）",
    out.warns.some((w) => w.includes("无漂移安全网") && w.includes("affected: false")),
    `期望 WARN: ${out.warns.join("; ").slice(0, 300)}`,
  );
  ok("该 WARN 不阻断 → 退出码 0", status === 0, `status=${status}`);

  // 6.5 同组合但 source_files 齐全 → 无此 WARN（已放弃匹配但仍有覆盖登记，属可辩护的取舍）
  writeTmpCard(["status: active", "affected: false"]);
  ({ status, out } = runDrift());
  ok(
    "active + affected:false + 有 source_files → 无 WARN",
    !out.warns.some((w) => w.includes("无漂移安全网")),
    `不应有 WARN: ${out.warns.join("; ").slice(0, 300)}`,
  );

  // 6.6 draft + affected:false + 无 source_files → WARN（draft 同为演进态，非冻结）
  writeTmpCard(["status: draft", "affected: false"], { omitSources: true });
  ({ status, out } = runDrift());
  ok(
    "draft + affected:false + 无 source_files → WARN",
    out.warns.some((w) => w.includes("无漂移安全网") && w.includes("draft")),
    `期望 WARN: ${out.warns.join("; ").slice(0, 300)}`,
  );

  // 7. 冻结态 status + affected:false + 无 source_files → 无此 WARN（快照/归档/取代即终态，退出匹配合理）
  for (const frozen of ["snapshot", "archived", "superseded"]) {
    writeTmpCard([`status: ${frozen}`, "affected: false"], { omitSources: true });
    ({ status, out } = runDrift());
    ok(
      `${frozen} + affected:false + 无 source_files → 无「无漂移安全网」WARN`,
      !out.warns.some((w) => w.includes("无漂移安全网")),
      `不应有 WARN: ${out.warns.join("; ").slice(0, 300)}`,
    );
  }

  // 8. frontmatter 内列 0 YAML 注释不得被误判为 H1
  //    H1 vs name 检查原用 /^#\s+/ 扫全文（含 frontmatter），`# 说明` 与 Markdown H1 字形全同 →
  //    任何 provenance 注释都会触发假 WARN。实证：extensibility-round2.md 2026-10-06 治理注释。
  //    H1 应只认 frontmatter 之后的正文。
  writeTmpCard(["status: active"], {
    fmExtra: ["# 治理注记：此处是 YAML 注释，不是标题"],
  });
  ({ status, out } = runDrift());
  ok(
    "frontmatter 列 0 注释 → 不误判 H1 与 name 不一致",
    !out.warns.some((w) => w.includes("H1 标题")),
    `不应有 H1 WARN: ${out.warns.filter((w) => w.includes("H1")).join("; ").slice(0, 300)}`,
  );

  // 8.5 真 H1 与 name 不一致 → 仍须 WARN（修 H1 作用域不得放过真失配）
  writeTmpCard(["status: active"]);
  fs.writeFileSync(
    TMP_CARD,
    fs
      .readFileSync(TMP_CARD, "utf8")
      .replace(/\r\n# status 契约测试临时卡\r\n/, "\r\n# 正文标题与 name 不符\r\n"),
    "utf8",
  );
  ({ status, out } = runDrift());
  ok(
    "正文 H1 真与 name 不一致 → 仍 WARN",
    out.warns.some((w) => w.includes("H1 标题") && w.includes("正文标题与 name 不符")),
    `期望 WARN: ${out.warns.join("; ").slice(0, 300)}`,
  );
} finally {
  if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true, force: true });
}

finish("知识卡 status 生命周期契约全过");
