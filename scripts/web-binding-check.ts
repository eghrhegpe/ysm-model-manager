#!/usr/bin/env node
/**
 * web binding 契约检查（backend 适配层的 CI 闸补全）。
 *
 * 设计意图（为何存在/适用场景）：browser-adapter.ts 的 webImpls 与 Go internal/app 导出的 Wails binding
 * 之间曾经零类型契约——Go 改签名 / 删 binding 后，web 实现静默漂移，只有用户
 * 点到了才抛 WebUnsupportedError。browser-adapter.ts 已用
 * `satisfies Partial<GoBindingShape>` 在编译期拦「键名拼写错 / Go 删 binding 后
 * 残留孤儿名」；本脚本补齐运行期/统计层：量化 web 覆盖率、列出未实现 binding、
 * 揪出既不在 Go 也不在白名单的真·孤儿键。
 *
 * 退出码：
 *   --fail-on-orphan 且存在真·孤儿键 → 1（挂 CI 阻断）
 *   否则 → 0（未实现 binding 是网页版功能子集的设计预期，不阻断）
 *
 * 用法：
 *   node scripts/web-binding-check.ts              # 报告
 *   node scripts/web-binding-check.ts --json      # JSON
 *   node scripts/web-binding-check.ts --fail-on-orphan
 *
 * 依赖：外部依赖 ./_lib/scan-files.ts（仅取 ROOT 常量）；标准库 node:fs / node:path。
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./_lib/scan-files.ts";

// 网页版专属扩展键（Go AppBindings 无此函数，由 browserAdapter 暴露给网页版 UI）：
// 这些键合法，不应被当作孤儿。
const WEB_ONLY_ALLOWLIST = new Set(["GetFsaAuthState", "SelectLocalRepo"]);

// ── Go 侧 binding ──
const GO_DIR = path.join(ROOT, "internal/app");
function listGoFiles(): string[] {
  if (!fs.existsSync(GO_DIR)) return [];
  return fs
    .readdirSync(GO_DIR)
    .filter((f) => f.endsWith(".go") && !f.endsWith("_test.go"))
    .sort();
}
function scanGoBindings(): Set<string> {
  const set = new Set<string>();
  for (const f of listGoFiles()) {
    const s = fs.readFileSync(path.join(GO_DIR, f), "utf-8");
    for (const m of s.matchAll(/^func \(a \*App\) ([A-Z]\w+)\(/gm)) {
      if (m[1]) set.add(m[1]);
    }
  }
  return set;
}

// ── web 实现侧 binding ──
const WEB_FILES = ["web-common.ts", "web-fs.ts", "web-store.ts", "web-community.ts", "web-cli.ts"];
const WEB_DIR = path.join(ROOT, "frontend/src/backend");
function scanWebBindings(): Set<string> {
  const set = new Set<string>();
  for (const f of WEB_FILES) {
    const fp = path.join(WEB_DIR, f);
    if (!fs.existsSync(fp)) continue;
    const s = fs.readFileSync(fp, "utf-8");
    const i = s.indexOf("Bindings = {");
    if (i < 0) continue;
    const seg = s.slice(i);
    for (const m of seg.matchAll(/^\s{2}([A-Z]\w*):/gm)) {
      if (m[1]) set.add(m[1]);
    }
  }
  return set;
}

function main(): number {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const failOnOrphan = args.includes("--fail-on-orphan");

  const go = scanGoBindings();
  const web = scanWebBindings();

  const implemented = [...go].filter((k) => web.has(k)).sort();
  const unimplemented = [...go].filter((k) => !web.has(k)).sort();
  const webOnly = [...web].filter((k) => !go.has(k) && WEB_ONLY_ALLOWLIST.has(k)).sort();
  const orphans = [...web].filter((k) => !go.has(k) && !WEB_ONLY_ALLOWLIST.has(k)).sort();

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          goTotal: go.size,
          webImplemented: implemented.length,
          coverage: go.size ? implemented.length / go.size : 1,
          unimplemented,
          webOnly,
          orphans,
        },
        null,
        2,
      ),
    );
  } else {
    const pct = go.size ? ((implemented.length / go.size) * 100).toFixed(1) : "100.0";
    console.log("=== web binding 契约报告 ===");
    console.log(`Go binding 总数      : ${go.size}`);
    console.log(`web 已实现 (对齐 Go) : ${implemented.length}  (覆盖率 ${pct}%)`);
    console.log(`web 未实现 (fail-fast): ${unimplemented.length}`);
    console.log(`web 专属扩展键        : ${webOnly.length}  [${webOnly.join(", ")}]`);
    console.log(`真·孤儿键             : ${orphans.length}  [${orphans.join(", ")}]`);
    if (unimplemented.length) {
      console.log(
        "\n-- 未实现 binding（网页版功能子集，设计预期；新增 Go binding 时建议评估是否补 web 实现）--",
      );
      console.log(unimplemented.join("\n"));
    }
    if (orphans.length) {
      console.log("\n-- ⚠ 孤儿键：既不在 Go 也不在白名单，疑似拼写错或已废弃，需人工确认 --");
      console.log(orphans.join("\n"));
    }
  }

  if (failOnOrphan && orphans.length > 0) return 1;
  return 0;
}

process.exit(main());
