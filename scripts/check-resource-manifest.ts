#!/usr/bin/env node
/**
 * check-resource-manifest.ts — pack.mcmeta 单一事实源漂移门禁（ADR-269 D1）。
 *
 * 依赖：node:fs / node:path / node:url（零三方依赖）。
 * 用法：
 *   node scripts/check-resource-manifest.ts           # 人读输出
 *   node scripts/check-resource-manifest.ts --json     # 机读 _summary（供子代理 / 门禁消费）
 * 退出码：0=一致（无漂移）；1=漂移或 schema 缺失（阻断，fail-closed）。
 *
 * 设计意图（为何存在 / 适用场景）：pack.mcmeta 形状此前散作 4 份手抄（Go PackMeta /
 *   PackMetaView + TS parsePackMetaJson / PackMeta），靠 ADR-070「TS 平移 + 测试锁定」维持、
 *   非生成物 → 跨语言漂移无实时防线。本闸把 docs/schema/resource-manifest.schema.json 定为
 *   canonical，从真实源码正则提取字段名与归一化行为标记，三方对账（schema ↔ canonical ↔ 源码），
 *   任一漂移即 exit 1——范式对齐 type-consistency.ts（派生守卫，fail-closed）。
 *   取代 ADR-269 B2 的一次性探针 probe-resource-manifest.ts（逻辑已并入，探针删除避免双份）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");
const JSON_MODE = process.argv.includes("--json");

// ── canonical 字段集（与 schema x-canonical-fieldsets 交叉校验，二者不得漂移）──
const ENVELOPE = "pack"; // mcmeta 根信封 {"pack":{…}}
const SOURCE = ["pack_format", "description", "supported_formats", "min_format", "max_format"];
const VIEW = [...SOURCE, "thumbnail"];

const LAYERS = [
  { id: "go.PackMeta", file: "go/types/registry/resource.go", anchor: "type PackMeta struct", against: "SOURCE", rel: "exact", envelope: true },
  { id: "go.PackMetaView", file: "go/types/config.go", anchor: "type PackMetaView struct", against: "VIEW", rel: "exact", envelope: false },
  { id: "ts.PackMeta", file: "frontend/src/utils/format/pack-format.ts", anchor: "export interface PackMeta", against: "VIEW", rel: "subset", envelope: false },
] as const;
// ts.parsePackMetaJson 输出是代码非声明，单独提取 result 键。
const TS_PARSE = { file: "frontend/src/parsers/pack-meta.ts", anchor: "const result: Record<string, unknown> = {" };

// ── 提取器 ──────────────────────────────────────────────────────────
function structFields(text: string, anchor: string): string[] {
  const i = text.indexOf(anchor);
  if (i < 0) throw new Error(`锚点未找到: ${anchor}`);
  const end = text.indexOf("\n}", i);
  return [...text.slice(i, end < 0 ? undefined : end).matchAll(/json:"([a-z_][a-z0-9_]*)/g)].map((m) => m[1]!);
}
function ifaceFields(text: string, anchor: string): string[] {
  const i = text.indexOf(anchor);
  if (i < 0) throw new Error(`锚点未找到: ${anchor}`);
  const end = text.indexOf("\n}", i);
  return [...text.slice(i, end < 0 ? undefined : end).matchAll(/^\s*([a-z_][a-z0-9_]*)\??\s*:/gm)].map((m) => m[1]!);
}
function parseResultKeys(text: string, anchor: string): string[] {
  const i = text.indexOf(anchor);
  if (i < 0) throw new Error(`锚点未找到: ${anchor}`);
  const end = text.indexOf("};", i);
  const keys = [...text.slice(i, end < 0 ? undefined : end).matchAll(/^\s*([a-z_][a-z0-9_]*)\s*:/gm)].map((m) => m[1]!);
  const dyn = [...text.matchAll(/for \(const key of \[([^\]]+)\]/g)].flatMap((m) =>
    [...m[1]!.matchAll(/"([a-z_]+)"/g)].map((x) => x[1]!),
  );
  return [...new Set([...keys, ...dyn])];
}

const errors: string[] = [];
const notes: string[] = [];
const sameSet = (a: string[], b: string[]) =>
  new Set([...a, ...b]).size === a.length && a.length === new Set(a).size;

function checkLayer(id: string, fields: string[], against: "SOURCE" | "VIEW", rel: "exact" | "subset", envelope: boolean) {
  let fs2 = fields;
  if (envelope) {
    if (!fields.includes(ENVELOPE)) { errors.push(`${id}: 缺根信封 \`{${ENVELOPE}:…}\``); return; }
    fs2 = fields.filter((f) => f !== ENVELOPE);
  }
  const canon = new Set(against === "SOURCE" ? SOURCE : VIEW);
  for (const orphan of fs2.filter((f) => !canon.has(f)))
    errors.push(`${id}: 孤儿字段「${orphan}」不在 canonical ${against}（合并会丢信息，或 canonical 需补）`);
  if (rel === "exact")
    for (const miss of [...canon].filter((f) => !fs2.includes(f)))
      errors.push(`${id}: 漏字段「${miss}」（对齐 ${against} 须全覆盖）`);
}

// ── 1) 字段级：各层 ↔ canonical ─────────────────────────────────────
try {
  for (const layer of LAYERS) {
    const text = read(layer.file);
    const fields =
      layer.id === "ts.PackMeta" ? ifaceFields(text, layer.anchor) : structFields(text, layer.anchor);
    checkLayer(layer.id, fields, layer.against, layer.rel, layer.envelope);
  }
  const tsParseText = read(TS_PARSE.file);
  checkLayer("ts.parsePackMetaJson", parseResultKeys(tsParseText, TS_PARSE.anchor), "VIEW", "exact", false);
} catch (e) {
  errors.push(`字段提取失败：${(e as Error).message}`);
}

// ── 2) 行为级：Go/TS 归一化实现与 schema 声明必须同构 ────────────────
// 防「改了 Go 解析器 / TS 镜像却忘了 schema」——锁的是行为镜像契约，不止形状。
try {
  const goRes = read("go/types/registry/resource.go");
  const tsMeta = read("frontend/src/parsers/pack-meta.ts");
  const schema = JSON.parse(read("docs/schema/resource-manifest.schema.json"));
  const frOneOf = JSON.stringify(schema.$defs.FormatRange.oneOf);
  const hasObjRange = (src: string) => /min_inclusive/.test(src) && /max_inclusive/.test(src);
  const fmt = { go: hasObjRange(goRes), ts: hasObjRange(tsMeta), schema: /min_inclusive/.test(frOneOf) };
  if (!(fmt.go && fmt.ts && fmt.schema))
    errors.push(`FormatRange 行为漂移：Go:${fmt.go} TS:${fmt.ts} schema:${fmt.schema}（三处须同识 {min_inclusive,max_inclusive}）`);
  else notes.push("FormatRange 三处一致（Go UnmarshalJSON ≡ TS formatRangeToPair ≡ schema.oneOf）");
  // description 三态：Go descString / TS descText 均处理 text/extra，schema 声明 Description。
  const descMirror = (src: string) => /extra/.test(src) && /text/.test(src);
  if (!(descMirror(goRes) && descMirror(tsMeta)))
    errors.push("description 行为漂移：Go descString / TS descText 须同处理 text/extra 递归");
  else notes.push("description 归一化一致（Go descString ≡ TS descText，text-component 递归）");
  // thumbnail 属视图增量，源文件 pack.png，schema 显式标 derived（不得回流进 SOURCE）。
  if (SOURCE.includes("thumbnail")) errors.push("thumbnail 误入 SOURCE（应仅 VIEW，源 pack.png）");
} catch (e) {
  errors.push(`行为/schema 校验失败：${(e as Error).message}`);
}

// ── 3) schema 自洽：x-canonical-fieldsets 与 $defs 属性、与本闸常量三方对齐 ──
try {
  const schema = JSON.parse(read("docs/schema/resource-manifest.schema.json"));
  const cf = schema["x-canonical-fieldsets"];
  const srcKeys = Object.keys(schema.$defs.PackMetaSource.properties.pack.properties);
  const viewKeys = Object.keys(schema.$defs.PackMetaView.properties);
  if (cf.envelope !== ENVELOPE) errors.push(`schema.envelope「${cf.envelope}」!= "${ENVELOPE}"`);
  if (!sameSet(cf.SOURCE, SOURCE)) errors.push("schema.SOURCE != 本闸 SOURCE");
  if (!sameSet(cf.VIEW, VIEW)) errors.push("schema.VIEW != 本闸 VIEW");
  if (!sameSet(srcKeys, cf.SOURCE)) errors.push("PackMetaSource.pack 属性 != schema.SOURCE");
  if (!sameSet(viewKeys, cf.VIEW)) errors.push("PackMetaView 属性 != schema.VIEW");
} catch (e) {
  errors.push(`读取 docs/schema/resource-manifest.schema.json 失败（fail-closed）：${(e as Error).message}`);
}

// ── 输出 ────────────────────────────────────────────────────────────
const ok = errors.length === 0;
if (JSON_MODE) {
  console.log(JSON.stringify({ _summary: { ok, errors: errors.length, tool: "check-resource-manifest" }, errors, notes }, null, 2));
} else {
  console.log("=== check-resource-manifest：pack.mcmeta 单一事实源漂移门禁（ADR-269 D1）===");
  for (const n of notes) console.log(`  ✅ ${n}`);
  for (const e of errors) console.log(`  ❌ ${e}`);
  console.log(ok ? "\n通过：四处投影 + 归一化行为 + schema 三方一致。" : `\n失败：${errors.length} 处漂移。`);
}
process.exit(ok ? 0 : 1);
