#!/usr/bin/env node
/**
 * test_adr_tiering.ts — ADR-320 体系分级契约测试。
 *
 * 覆盖：
 *   1. _lib/adr-files.ts 语法函数（文件名解析 / ID 拼装 / 标题正则 / 子编号推进）
 *   2. 真仓三区清单（ADR-320 本体应住 architecture/，legacy 存量在根）
 *   3. new-adr.ts 双级 dry-run 端到端（architecture 主编号延续 / decisions 子编号挂靠；零写入）
 *   4. 缺省不猜级：裸跑必须报错退出 1（fail-loud，ADR-320 约定）
 *   5. adr-check --json 在分级语法下保持全绿
 */
import {
  ADR_TITLE_RE,
  adrId,
  hasMainAdr,
  listAdrFiles,
  maxMainNum,
  nextSubForParent,
  parseAdrFilename,
} from "../scripts/_lib/adr-files.ts";
import { finish, ok, runScript } from "./_lib.mts";

const fails: string[] = [];
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fails.push(name);
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

console.log("=== ADR-320 分级契约 ===");

// ── 1. 语法函数 ──────────────────────────────────────
check("parseAdrFilename：主编号", () => {
  const p = parseAdrFilename("ADR-042-governance.md");
  assert(!!p && p.num === 42 && p.sub === null, JSON.stringify(p));
});
check("parseAdrFilename：子编号挂靠", () => {
  const p = parseAdrFilename("ADR-319-d2-slice.md");
  assert(!!p && p.num === 319 && p.sub === 2, JSON.stringify(p));
});
check("parseAdrFilename：非 ADR 文件排除", () => {
  assert(parseAdrFilename("index.md") === null, "index.md 应为 null");
  assert(parseAdrFilename("README.md") === null, "README.md 应为 null");
  assert(parseAdrFilename("ADR-42-x.md") === null, "两位编号应拒收");
});
check("adrId：二元组拼装", () => {
  assert(adrId(42, null) === "ADR-042", adrId(42, null));
  assert(adrId(319, 2) === "ADR-319-d2", adrId(319, 2));
});
check("ADR_TITLE_RE：主/子编号标题", () => {
  assert(ADR_TITLE_RE.test("# ADR-042：治理"), "主编号标题应匹配");
  assert(ADR_TITLE_RE.test("# ADR-319-d2：切片拍板"), "子编号标题应匹配");
  const m = ADR_TITLE_RE.exec("# ADR-319-d2：切片拍板");
  assert(!!m && m[1] === "319" && m[2] === "2" && m[3] === "切片拍板", JSON.stringify(m));
});
check("maxMainNum / nextSubForParent / hasMainAdr", () => {
  const files = [
    {
      name: "ADR-319-x.md",
      relPath: "ADR-319-x.md",
      absPath: "/x/ADR-319-x.md",
      zone: "legacy" as const,
      num: 319,
      sub: null,
      id: "ADR-319",
    },
    {
      name: "ADR-319-d1-a.md",
      relPath: "decisions/ADR-319-d1-a.md",
      absPath: "/x/d/ADR-319-d1-a.md",
      zone: "decisions" as const,
      num: 319,
      sub: 1,
      id: "ADR-319-d1",
    },
  ];
  assert(maxMainNum(files) === 319, "主编号最大 319");
  assert(nextSubForParent(files, 319) === 2, "319 下一子编号应为 d2");
  assert(nextSubForParent(files, 300) === 1, "无子编号的主 ADR 应从 d1 起");
  assert(hasMainAdr(files, 319) === true, "319 主 ADR 存在");
  assert(hasMainAdr(files, 320) === false, "320 主 ADR 不存在");
});

// ── 2. 真仓三区清单 ──────────────────────────────────
const real = listAdrFiles();
check("真仓：存量体量保留（三区合计 > 300）", () => {
  assert(real.length > 300, `实际 ${real.length}`);
});
check("真仓：ADR-320 首批住民在 architecture/", () => {
  const a = real.find((f) => f.id === "ADR-320");
  assert(!!a && a.zone === "architecture" && /architecture\//.test(a.relPath), JSON.stringify(a));
});
check("真仓：存量卡仍在 legacy 区", () => {
  const l = real.find((f) => f.id === "ADR-013");
  assert(!!l && l.zone === "legacy" && !/\//.test(l.relPath), JSON.stringify(l));
});
check("真仓：decisions 区当前为空（尚无执行日志）", () => {
  assert(!real.some((f) => f.zone === "decisions"), "不应有 decisions 文件");
});

// ── 3-4. new-adr dry-run 端到端（零写入）────────────
let r = runScript(
  "new-adr.ts",
  "tiering-arch-dry",
  "--slug",
  "tiering-arch-dry",
  "--tier",
  "architecture",
  "--reason",
  "契约测试",
  "--dry-run",
);
ok(
  "dry-run：architecture 主编号延续（320→321，落 architecture/）",
  r.status === 0 && r.stdout.includes("ADR-321") && r.stdout.includes("architecture/ADR-321-"),
  `status=${r.status} stdout=${r.stdout?.slice(0, 200)}`,
);
r = runScript(
  "new-adr.ts",
  "tiering-dec-dry",
  "--slug",
  "tiering-dec-dry",
  "--tier",
  "decisions",
  "--parent",
  "319",
  "--dry-run",
);
ok(
  "dry-run：decisions 子编号挂靠（ADR-319-d1，落 decisions/）",
  r.status === 0 && r.stdout.includes("ADR-319-d1") && r.stdout.includes("decisions/ADR-319-d1-"),
  `status=${r.status} stdout=${r.stdout?.slice(0, 200)}`,
);
r = runScript("new-adr.ts", "tiering-bare-dry", "--slug", "tiering-bare-dry", "--dry-run");
ok("缺省不猜级：裸跑退出 1（fail-loud）", r.status === 1, `status=${r.status}`);

// dry-run 后真仓 decisions 区仍为空（证明零写入）
check("dry-run 零写入副作用", () => {
  assert(!listAdrFiles().some((f) => f.zone === "decisions"), "decisions 区不应产生文件");
});

// ── 5. adr-check 在分级语法下全绿 ────────────────────
r = runScript("adr-check.ts", "--json");
let summary: any = {};
try {
  summary = JSON.parse(r.stdout || "{}")._summary ?? {};
} catch {
  /* 解析失败按 0 处理，由下方断言报错 */
}
ok(
  "adr-check：登记表与磁盘一致",
  r.status === 0 && summary.issues === 0,
  `status=${r.status} issues=${summary.issues}`,
);

finish("ADR-320 分级契约全过");
