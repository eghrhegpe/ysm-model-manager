// 一次性：清理 creators.json 中的双重编码（mojibake）污染条目。
// 逻辑对齐 Go repairMojibake：码位全 ≤0xFF 且含 ≥0x80 且重建字节为合法 UTF-8 → 判为双重编码。
// --apply 才写盘（写前先备份当前态）；默认 dry-run 只做分类统计。
const fs = require("fs");
const path = require("path");
const f = process.argv[2];
const APPLY = process.argv.includes("--apply");

const strict = new TextDecoder("utf-8", { fatal: true });
function isMojibake(s) {
  if (typeof s !== "string" || s.length === 0) return false;
  let high = false;
  const bytes = [];
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c > 0xff) return false; // 含真多字节 → 非双重编码产物
    if (c >= 0x80) high = true;
    bytes.push(c);
  }
  if (!high) return false; // 纯 ASCII → 合法
  try {
    strict.decode(new Uint8Array(bytes));
  } catch {
    return false; // 重建字节非合法 UTF-8 → 真 Latin-1，不误伤
  }
  return true;
}
function repair(s) {
  if (typeof s !== "string" || !isMojibake(s)) return s;
  const bytes = [];
  for (const ch of s) bytes.push(ch.codePointAt(0));
  return strict.decode(new Uint8Array(bytes));
}

const list = JSON.parse(fs.readFileSync(f, "utf8"));
let nameMoji = 0; // name 乱码 → 整条是污染副本，删
let fieldOnlyMoji = 0; // name 干净但 desc/type/role 乱码 → 逐字段还原，保留
const fieldOnlySamples = [];
for (const e of list) {
  if (isMojibake(e.name)) {
    nameMoji++;
    continue;
  }
  if (isMojibake(e.desc) || isMojibake(e.type) || isMojibake(e.role)) {
    fieldOnlyMoji++;
    if (fieldOnlySamples.length < 8) fieldOnlySamples.push(e.name);
  }
}
console.log(`total=${list.length} nameMoji(删)=${nameMoji} fieldOnlyMoji(还原)=${fieldOnlyMoji}`);
console.log("fieldOnly样本:", fieldOnlySamples.join(" / ") || "(无)");

if (!APPLY) {
  console.log("DRY-RUN 未写盘。加 --apply 执行。");
  process.exit(0);
}

// 写盘：删 name 乱码条目；对 name 干净但字段乱码的条目逐字段还原
const kept = [];
let repaired = 0;
for (const e of list) {
  if (isMojibake(e.name)) continue; // 丢弃整条污染副本
  const before = `${e.desc}|${e.type}|${e.role}`;
  e.desc = repair(e.desc);
  e.type = repair(e.type);
  e.role = repair(e.role);
  if (`${e.desc}|${e.type}|${e.role}` !== before) repaired++;
  kept.push(e);
}

// 备份当前脏态（时间戳，与 app BackupWorkshopCreators 命名区分）
const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);
const bak = f + "." + ts + ".pre-mojibake-cleanup.bak";
fs.copyFileSync(f, bak);

// 原子写：tmp → rename（对齐 fsutil.WriteFileAtomic 语义）
const tmp = f + ".cleanup.tmp";
fs.writeFileSync(tmp, JSON.stringify(kept, null, 2) + "\n", "utf8");
fs.renameSync(tmp, f);

console.log(`APPLIED: kept=${kept.length} dropped=${nameMoji} fieldRepaired=${repaired} bak=${path.basename(bak)}`);
