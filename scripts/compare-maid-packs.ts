#!/usr/bin/env node
/**
 * compare-maid-packs.ts — 实战比对：单女仆 zip vs 多合一女仆包。
 *
 * 【当前状态：依赖缺失，暂不可运行】本脚本依赖仓库根 `_tools/` 下的
 * listzip.go（列 zip 条目 + 抽 manifest）与 maidparse.go（ParseFromZip 独立程序），
 * 但 `_tools/` 目录当前不存在（2026-08-31 核对）——运行即报
 * `listzip fail: ..._tools\listzip.go not found`。待 _tools/ 工具回归后再启用。
 *
 * 依赖：node:child_process / node:fs / node:path + 缺失的 _tools/{listzip,maidparse}.go
 *
 * 用法：node scripts/compare-maid-packs.ts
 *
 * 退出码：0（比对报告工具，不阻断）；依赖缺失时 1（当前必然失败）。
 *
 * 设计意图：用 _listzip.go 列 zip 条目 + 调 ParseFromZip（经 Go 单测）对比
 * L0 清单与 L1 枚举差异，输出 tmp/maid-report.json 供模型包结构分析。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:\/)/, "$1")), "..");
const U1 = path.join(ROOT, "upstream", "[maid-model]单女仆");
const U2 = path.join(ROOT, "upstream", "[maid-model]多合一女仆包");
const TMP_DIR = path.join(ROOT, "tmp");
const REPORT = path.join(TMP_DIR, "maid-report.json");

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// ---- Step 1: 收集所有 zip ----
const zips: any[] = [];
for (const dir of [U1, U2]) {
  for (const f of fs.readdirSync(dir)) {
    if (f.toLowerCase().endsWith(".zip")) {
      zips.push({
        category: dir.includes("多合一") ? "multi-pack" : "single-pack",
        name: f,
        abs: path.join(dir, f),
      });
    }
  }
}

// ---- Step 2: 列条目 + 抽 manifest（_listzip.go）----
const listZip = (abs) => {
  const r = spawnSync("go", ["run", path.join(ROOT, "_tools", "listzip.go"), abs], {
    cwd: ROOT,
    maxBuffer: 50 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`listzip fail: ${r.stderr.toString().slice(0, 500)}`);
  return JSON.parse(r.stdout.toString());
};

// ---- Step 3: ParseFromZip 真实解析（_tools/maidparse.go 独立程序）----
const PARSE_SRC = path.join(ROOT, "_tools", "maidparse.go");

const parseZip = (abs) => {
  const r = spawnSync("go", ["run", PARSE_SRC, abs], {
    cwd: ROOT,
    maxBuffer: 50 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`parse fail: ${r.stderr.toString().slice(0, 600)}`);
  return JSON.parse(r.stdout.toString());
};

// ---- 执行 ----
const reports: any[] = [];
for (const z of zips) {
  process.stdout.write(`解析: ${z.category}/${z.name} ...`);
  const info = listZip(z.abs);
  // 取 manifest 解析摘要（有/无 + model 数）
  // 同步 Go 端逻辑：顶层/model/model_list / pack.model / pack.model_list / chair / decor
  // 四处都找，取条目最多的那个。
  let manifestInfo = { has: false, modelCount: 0, firstFew: [] };
  if (info.manifest) {
    try {
      const m = JSON.parse(info.manifest);
      const pick = (g) => Array.isArray(g?.model) ? g.model :
                     Array.isArray(g?.model_list) ? g.model_list : [];
      const groups = [
        pick(m),
        pick(m.pack),
        pick(m.chair),
        pick(m.decor),
      ];
      let best = groups[0] || [];
      for (const g of groups.slice(1)) if (g.length > best.length) best = g;
      if (best.length > 0) {
        manifestInfo = {
          has: true,
          modelCount: best.length,
          firstFew: best.slice(0, 5).map((x) => ({
            name: x.name || x.model_id,
            model_id: x.model_id,
            model: x.model,
            texture: x.texture,
          })),
        };
      }
    } catch (_) { /* malformed → has=false */ }
  }
  const parsed = parseZip(z.abs);
  // L1 粗略估计：从 info.entries 里统计 *.geo.json / *.json 数量（排除 animation/controller/ysm/描述符）
  let l1GeoCount = 0;
  let l1PngCount = 0;
  const maidEntry = info.entries.find((e) => e.toLowerCase().endsWith("/maid_model.json"));
  const maidNs = (maidEntry ? maidEntry.toLowerCase().split("/").slice(0, -1).join("/") + "/" : "");
  for (const e of info.entries) {
    const low = e.toLowerCase();
    if (maidNs && !low.startsWith(maidNs)) continue;
    if (low.endsWith(".png") || low.endsWith(".jpg")) { l1PngCount++; continue; }
    if (!low.endsWith(".json")) continue;
    if (low.includes("ysm.json")) continue;
    if (low.endsWith("maid_model.json") || low.endsWith("maid_chair.json") || low.endsWith("maid_sound.json")) continue;
    if (low.includes("animation") || low.includes("controller")) continue;
    l1GeoCount++;
  }
  reports.push({
    category: z.category,
    name: z.name,
    abs: z.abs,
    totalEntries: info.count,
    manifest: manifestInfo,
    L1_estimate: { geoCount: l1GeoCount, pngCount: l1PngCount, maidNs },
    parse: {
      boneCount: parsed.boneCount,
      cubeCount: parsed.cubeCount,
      texCount: parsed.texCount,
      textureNames: parsed.textureNames || [],
      subModels: parsed.subModels || [],
      animCount: parsed.animCount ?? 0,
    },
    entries: info.entries, // 原始条目清单（留档，diff 用）
  });
  process.stdout.write(` OK → ${(parsed.subModels || []).length} submodels, ${parsed.boneCount || 0} bones\n`);
}

// ---- 写完整 JSON 报告 ----
fs.writeFileSync(REPORT, JSON.stringify(reports, null, 2));
console.log(`\n完整报告已写: ${path.relative(ROOT, REPORT)} (${(fs.statSync(REPORT).size/1024).toFixed(1)} KB)`);

// ---- 控制台 摘要 表 ----
const rows = [
  ["类别", "包名", "L0.model[]", "L1估算(geo/png)", "解析结果(bones/tex)", "SubModels", "L0 差异"],
];
for (const r of reports) {
  const L0n = r.manifest.has ? `${r.manifest.modelCount}✅` : "−";
  const l1 = `${r.L1_estimate.geoCount}/${r.L1_estimate.pngCount}`;
  const parse = `${r.parse.boneCount}/${r.parse.texCount}`;
  const sub = `${r.parse.subModels.length}`;
  // 差异判断：L0 有清单时，清单数 vs L1 估算数
  let diff = "−";
  if (r.manifest.has) {
    const L0 = r.manifest.modelCount;
    const L1 = r.L1_estimate.geoCount;
    const parsedN = r.parse.subModels.length;
    if (L0 === L1 && parsedN === L0) diff = "完全一致";
    else if (parsedN === L0) diff = `过滤生效(L0 ${L0} < L1估算 ${L1})`;
    else diff = `可疑! L0=${L0} L1估算=${L1} 解析=${parsedN}`;
  } else {
    diff = `L1 兜底:${r.parse.subModels.length} sub`;
  }
  rows.push([r.category, r.name.slice(0, 38), L0n, l1, parse, sub, diff]);
}
const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
for (const r of rows) {
  console.log(r.map((c, i) => String(c).padEnd(widths[i])).join(" | "));
}
