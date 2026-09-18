#!/usr/bin/env node
/**
 * probe-resource-manifest.ts — ADR-269 D1 最小探针（未接线，一次性取证用）。
 *
 * 目的：在投入「mcmeta 四份手抄 → 单一 resource-manifest schema」的全面改造前，
 * 用真实源码字段对账，证伪/证实「四处形状能无损合并成一份」。
 *
 * 断言（可证伪）：
 *   对每个真实定义，正则提取其字段名 → 与候选 canonical 比对：
 *     - 无孤儿：该层不得出现 canonical 之外的字段（否则合并会丢信息，D1 不成立）
 *     - 全覆盖：SOURCE / VIEW 的每个字段都得被对应层承载（否则 canonical 漏字段）
 *   类型分歧（FormatRange→[min,max]、raw-desc→text、mcmeta 无 thumbnail）
 *   属「归一化/视图增量」，非信息损失，逐条登记为 normalization。
 *
 * 零依赖（node:fs）。退出码：0=探针通过（D1 可行），1=发现孤儿/漏字段（需修订 canonical）。
 *
 * 用法：
 *   node scripts/probe-resource-manifest.ts        # 跑一次对账，看结论 + 退出码
 *
 * 设计意图（为何存在 / 适用场景）：ADR-269 D1（mcmeta 四份手抄 → 单一 resource-manifest
 *   schema）落地前的**一次性证伪探针**——不接线、不进 CI 门禁，仅在立项前从真实源码提取
 *   字段名，实证四处形状确为同一 canonical 的无损投影。探针本身即 D1 决策的活证据；
 *   若未来某层新增字段破坏无损性，重跑即 exit 1 报警（临时守护，用完可归档）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");

// ── 候选 canonical schema（本次探针要证明「够用」的那一份）──────────────
// mcmeta 盘上真实结构是 {"pack": {…fields}}——`pack` 是根信封，非数据字段。
// canonical 必须建模这个信封（Go PackMeta 与 TS parsePackMetaJson 均以 .pack 取内层）。
const ENVELOPE = "pack";
// SOURCE = pack.mcmeta 信封内真实存在的字段（解析输入形状）。
const SOURCE = ["pack_format", "description", "supported_formats", "min_format", "max_format"];
// VIEW = 归一化后发给前端的形状 = SOURCE + thumbnail（源自 pack.png，非 mcmeta）。
const VIEW = [...SOURCE, "thumbnail"];

// 各层与 canonical 的关系：exact=须与集合完全相等；subset=子集（可再生，无损）。
// envelope=true 表示该层源码里显式带 `pack` 信封字段（提取出后归位、不计入孤儿）。
const LAYERS = [
  { id: "go.PackMeta", role: "mcmeta 原始结构体", file: "go/types/registry/resource.go", against: "SOURCE", rel: "exact", envelope: true },
  { id: "go.PackMetaView", role: "ReadPackMeta 返回视图", file: "go/types/config.go", against: "VIEW", rel: "exact", envelope: false },
  { id: "ts.parsePackMetaJson", role: "web-fs 解析输出", file: "frontend/src/parsers/pack-meta.ts", against: "VIEW", rel: "exact", envelope: false },
  { id: "ts.PackMeta", role: "版本区间映射消费者", file: "frontend/src/utils/format/pack-format.ts", against: "VIEW", rel: "subset", envelope: false },
] as const;

// ── 真实源码字段提取（各层锚点不同，分别正则）─────────────────────────
function extractGoStructFields(text: string, anchor: string): string[] {
  const i = text.indexOf(anchor);
  if (i < 0) throw new Error(`锚点未找到: ${anchor}`);
  const end = text.indexOf("\n}", i);
  const block = text.slice(i, end < 0 ? undefined : end);
  return [...block.matchAll(/json:"([a-z_][a-z0-9_]*)/g)].map((m) => m[1]!);
}

function extractTsInterfaceFields(text: string, anchor: string): string[] {
  const i = text.indexOf(anchor);
  if (i < 0) throw new Error(`锚点未找到: ${anchor}`);
  const end = text.indexOf("\n}", i);
  const block = text.slice(i, end < 0 ? undefined : end);
  // 形如 `pack_format?: number;` / `description: string;`
  return [...block.matchAll(/^\s*([a-z_][a-z0-9_]*)\??\s*:/gm)].map((m) => m[1]!);
}

function extractTsParseResultKeys(text: string, anchor: string): string[] {
  const i = text.indexOf(anchor);
  if (i < 0) throw new Error(`锚点未找到: ${anchor}`);
  const end = text.indexOf("};", i);
  const block = text.slice(i, end < 0 ? undefined : end);
  const keys = [...block.matchAll(/^\s*([a-z_][a-z0-9_]*)\s*:/gm)].map((m) => m[1]!);
  // 解析输出还动态写入 result[key]（supported_formats/min_format/max_format），补上
  const dyn = [...text.matchAll(/for \(const key of \[([^\]]+)\]/g)].flatMap((m) =>
    [...m[1]!.matchAll(/"([a-z_]+)"/g)].map((x) => x[1]!),
  );
  return [...new Set([...keys, ...dyn])];
}

function extractForLayer(layer: (typeof LAYERS)[number]): string[] {
  const text = read(layer.file);
  if (layer.id === "go.PackMeta")
    return extractGoStructFields(text, "type PackMeta struct");
  if (layer.id === "go.PackMetaView")
    return extractGoStructFields(text, "type PackMetaView struct");
  if (layer.id === "ts.PackMeta")
    return extractTsInterfaceFields(text, "export interface PackMeta");
  return extractTsParseResultKeys(text, "const result: Record<string, unknown> = {");
}

// ── 对账 ────────────────────────────────────────────────────────────
const CANON: Record<string, string[]> = { SOURCE, VIEW };
let failures = 0;

console.log("=== ADR-269 D1 探针：mcmeta 四形状 vs 候选 canonical 无损对账 ===\n");
console.log(`canonical SOURCE = [${SOURCE.join(", ")}]`);
console.log(`canonical VIEW   = [${VIEW.join(", ")}]  (SOURCE + thumbnail:pack.png)\n`);

for (const layer of LAYERS) {
  let fields: string[];
  try {
    fields = extractForLayer(layer);
  } catch (e) {
    console.log(`❌ ${layer.id} 提取失败：${(e as Error).message}`);
    failures++;
    continue;
  }
  const canon = new Set(CANON[layer.against]);
  // 信封归位：带 envelope 的层，`pack` 是根包裹而非数据字段——从字段集摘出，单独断言存在。
  let envelopeNote = "";
  let fields2 = fields;
  if (layer.envelope) {
    if (!fields.includes(ENVELOPE)) {
      console.log(`❌ ${layer.id} 应含根信封 \`{${ENVELOPE}: {…}}\` 却未提取到\n`);
      failures++;
      continue;
    }
    fields2 = fields.filter((f) => f !== ENVELOPE);
    envelopeNote = `  信封={${ENVELOPE}}`;
  }
  const found = new Set(fields2);
  const orphans = fields2.filter((f) => !canon.has(f)); // 该层有、canonical 无 → 信息损失风险
  const missing =
    layer.rel === "exact" ? [...canon].filter((f) => !found.has(f)) : []; // 该层须承载却有缺
  const subsetExtra =
    layer.rel === "subset" ? [...canon].filter((f) => !found.has(f)) : []; // 子集未覆盖（允许）

  const ok = orphans.length === 0 && missing.length === 0;
  if (!ok) failures++;
  console.log(
    `${ok ? "✅" : "❌"} ${layer.id}  [${layer.role}]  → 对齐 ${layer.against} (${layer.rel})${envelopeNote}`,
  );
  console.log(`     提取字段: [${fields2.join(", ")}]`);
  if (orphans.length) console.log(`     ⚠ 孤儿(canonical 缺): [${orphans.join(", ")}]`);
  if (missing.length) console.log(`     ⚠ 漏字段(该层缺): [${missing.join(", ")}]`);
  if (subsetExtra.length) console.log(`     · 子集未覆盖(可再生，无损): [${subsetExtra.join(", ")}]`);
  console.log("");
}

// 归一化登记：类型分歧不是字段损失，显式列出以免对账器误判。
console.log("--- 类型归一化（非信息损失，D1 由生成器统一实现）---");
console.log("  description : SOURCE=JSON text component → VIEW=string（Go Desc()/TS descText 同构）");
console.log("  format 族   : SOURCE=int|[n]|[n,n]|{min_inclusive,max_inclusive} → VIEW=[min,max]");
console.log("                （Go FormatRange.UnmarshalJSON ≡ TS formatRangeToPair，行为镜像）");
console.log("  thumbnail   : 仅 VIEW 有，源文件 pack.png（非 mcmeta）——canonical 显式标 derived");
console.log("");

console.log(
  failures === 0
    ? "=== 探针通过：四处形状确为同一 canonical 的无损投影，D1 可行 ==="
    : `=== 探针失败：${failures} 处不符，需修订 canonical 或承认 D1 非无损 ===`,
);
process.exit(failures === 0 ? 0 : 1);
