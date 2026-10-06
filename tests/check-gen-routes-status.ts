#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { finish, ok, runScript } from "./_lib.mts";

// gen-routes status 闸契约（隔离 --kc-dir）：
//   arch + active（或缺省 status）→ 入路由；arch + draft/superseded/archived → 剔除；
//   leaf 卡永不入路由（tier 闸）；--check 与生成态自洽。
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ysm-genroutes-contract-"));

function mkCard(stem: string, opts: { tier?: string; status?: string; useWhen?: string[] }) {
  const lines = [
    "---",
    `kind: ${stem}`,
    `name: ${stem}`,
    `tier: ${opts.tier ?? "leaf"}`,
    "category: utils",
    "source_files:",
    "  - frontend/src/utils/base/pure/array.ts",
    ...(opts.status ? [`status: ${opts.status}`] : []),
    "use_when:",
    ...(opts.useWhen ?? ["临时"]).map((u) => `  - ${u}`),
    "---",
    "",
    `# ${stem}`,
    "",
    "## 概览",
    "",
    "契约测试临时卡，测完即删。",
    "",
  ];
  fs.writeFileSync(path.join(TMP_DIR, `${stem}.md`), lines.join("\r\n"), "utf8");
}

function runGen(args: string[]) {
  const r = runScript("gen-routes.ts", "--kc-dir", TMP_DIR, ...args);
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

console.log("=== gen-routes status 闸契约（routes.md 只路由 active 卡）===");

try {
  mkCard("aaa-active", { tier: "architecture", useWhen: ["关键词甲"] }); // 缺省 status = active
  mkCard("bbb-superseded", { tier: "architecture", status: "superseded", useWhen: ["关键词乙"] });
  mkCard("ccc-draft", { tier: "architecture", status: "draft", useWhen: ["关键词丙"] });
  mkCard("ddd-archived", { tier: "architecture", status: "archived", useWhen: ["关键词丁"] });
  mkCard("eee-leaf", { tier: "leaf", useWhen: ["关键词戊"] }); // leaf 永不入路由

  // 1. 生成：aaa 在表中，冻结/草稿/leaf 均不在
  let r = runGen([]);
  ok("生成退出码 0", r.status === 0, `status=${r.status} stderr=${r.stderr.slice(0, 200)}`);
  const routes = fs.readFileSync(path.join(TMP_DIR, "routes.md"), "utf8");
  ok("active 卡入路由", routes.includes("./aaa-active.md"), "aaa-active 应在 routes.md");
  ok(
    "superseded 剔除",
    !routes.includes("./bbb-superseded.md"),
    "bbb-superseded 不应在 routes.md",
  );
  ok("draft 剔除", !routes.includes("./ccc-draft.md"), "ccc-draft 不应在 routes.md");
  ok("archived 剔除", !routes.includes("./ddd-archived.md"), "ddd-archived 不应在 routes.md");
  ok("leaf 剔除", !routes.includes("./eee-leaf.md"), "eee-leaf 不应在 routes.md");

  // 2. --check 自洽（刚生成完应同步）
  r = runGen(["--check"]);
  ok("--check 同步退出码 0", r.status === 0, `status=${r.status} stderr=${r.stderr.slice(0, 200)}`);

  // 3. --check 检出漂移：删一张 active 卡后 --check 应失败
  fs.rmSync(path.join(TMP_DIR, "aaa-active.md"));
  r = runGen(["--check"]);
  ok("删卡后 --check 检出未同步（退出码 1）", r.status === 1, `status=${r.status}（期望 1）`);
} finally {
  if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true, force: true });
}

finish("gen-routes status 闸契约全过");
