#!/usr/bin/env node
/**
 * 契约测试：设置键台账（settings-key ledger）双向对账（锐评 2026-10-15 P1 ②）。
 *
 * 背景（为什么需要本台账）：应用设置分两轨持久化，历史上只有 Go 轨
 * （`ysm_config.json`）被写进备份迁移文档，前端 localStorage 轨（字体/密度/动画/
 * 默认页/键位/3D 偏好/去重配置…）从未被登记。结果是「换机只复制
 * `ysm_config.json`」的官方指引把几十项偏好留在旧机，用户按文档操作即静默丢设置，
 * 且没有任何一处代码或文档能回答「这个键存哪、谁是权威、换机会不会丢」。
 *
 * 本台账 `frontend/src/settings-keys.ts` 把三件事收成一处声明：
 *   1. 键 → 存储轨（Go 磁盘 / localStorage / IndexedDB / 会话内存）
 *   2. 权威方（磁盘权威 / 浏览器权威 / 双写同步 / 非持久）
 *   3. 换机是否随 `ysm_config.json` 迁移（备份面）
 *
 * 本测试锁台账与真实世界的**双向**一致性——单向文档必然腐，两向才成护栏：
 *   A. 台账登记的 localStorage 键必须真的出现在前端源码里（防台账凭空的死键）
 *   B. 前端源码里的 localStorage 键必须都被台账登记（防新增键漏登记——本测试的主要价值）
 *   C. Go `AppConfig` 的每个 json 字段都必须被台账登记（防磁盘轨漏登记）
 *   D. 台账自洽性：键名唯一、轨值合法、迁移口径与轨的对应关系合法
 *
 * 边界：只锁「键的集合与归属」这一层，不锁各键的读写语义（那由各模块单测守护）。
 * 「键存在」的判定用宽松口径（键字面量出现在生产源码），故不同模块共用同一
 * localStorage 键（如 `theme` 由 theme-core + settings/theme + config-write 各引一次）
 * 不算重复登记；去重按键名去重而非按出现次数。
 *
 * 依赖：node:fs / node:path（零第三方）。
 * 运行：node tests/test_settings_key_ledger.ts（或经 _lib/contract-tests.ts 统一入口）。
 * 退出码：0 全绿；非 0 断言失败。
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = path.join(ROOT, "frontend", "src");
const LEDGER_FILE = path.join(SRC_DIR, "settings-keys.ts");

/** 生产源码文件（排除测试 / setup） */
function productionFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      out.push(...productionFiles(abs));
      continue;
    }
    if (!/\.tsx?$/.test(e.name)) continue;
    if (/\.(test|spec)\.(ts|tsx)$/.test(e.name)) continue;
    if (/\.setup\.ts$/.test(e.name)) continue;
    // 台账自身不是键消费者：它的字面量是「登记名 + disk: 前缀常量」，
    // 扫进去会把自己的命名空间当成一个 localStorage 键（假红）。
    if (path.join(dir, e.name) === LEDGER_FILE) continue;
    out.push(abs);
  }
  return out;
}

const rel = (abs) => path.relative(SRC_DIR, abs).split(path.sep).join("/");

/** 剥离注释，避免文档注释里提到的键名被当成真实使用 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, "");
}

// ─── 收集前端源码里真实使用的 localStorage 键 ───
// 口径：safeGet/safeSet/safeGetJSON/safeRemove 的首参字面量 + localStorage.* 的字面量
// + `const XXX_KEY = "字面量"` 形式的键常量。键常量是最常见的持有形态（很多键只在
// 常量声明处出现一次，真正的 safeGet(someKey) 调用处是标识符不是字面量）。
// 模板字面量（反引号）形态（锐评 2026-10-16）：安全闸首参写成 `前缀${动态}` 的拼接键，
// 以「静态前缀 + *」通配形态参与对账——此口径立闸实测抓出三处漏登家族
// （sb_selectedName_* / ysm-tabs-last-* / ysm:model-visible:*），其中模型可见性是
// 用户可感知偏好，漏登即换机静默丢——本条口径把「拼接键天然隐身」的盲区收进网里。
// 函数体内拼键（visKey 形态）不强行扩口径（误报面 = 全部 backtick HTML 模板），
// 改键持有者收敛为 * 常量形态接既有口径（见 scene-registry.ts MODEL_VISIBLE_PREFIX）。
function collectLocalStorageKeys(files) {
  const found = new Map(); // key -> 首个出现的文件
  for (const abs of files) {
    const text = stripComments(fs.readFileSync(abs, "utf8"));
    const r = rel(abs);
    for (const m of text.matchAll(
      /\b(?:safeGet|safeSet|safeGetJSON|safeRemove|localStorage\.(?:getItem|setItem|removeItem))\(\s*(?:"([^"]+)"|`([^`]*)`)/g,
    )) {
      const raw = m[1] ?? m[2];
      // 模板字面量：取首个 ${ 之前的静态段作前缀，登记 <前缀>* 通配
      const dollar = raw.indexOf("${");
      const k = dollar === -1 ? raw : `${raw.slice(0, dollar)}*`;
      if (!k) continue;
      if (!found.has(k)) found.set(k, r);
    }
    for (const m of text.matchAll(
      /\b[A-Z][A-Z0-9_]*(?:_KEY|_PREFIX)\s*(?::\s*string\s*)?=\s*"([^"]+)"/g,
    )) {
      if (!found.has(m[1])) found.set(m[1], r);
    }
    // 规格表里的 storageKey 成员（worker-prefs.ts 的 `{ storageKey: "fbx-worker" }` 等）
    // ——键不是顶层常量而是对象字面量成员，前两条口径都抓不到。
    for (const m of text.matchAll(/\bstorageKey:\s*"([^"]+)"/g)) {
      if (!found.has(m[1])) found.set(m[1], r);
    }
    // 规格表里的 key 成员（settings-schema.ts 的 `TdNumericSpec { key: "td-cam-speed" }`
    // 等）——键值藏在规格对象字段里，非顶层常量。
    // 收紧条件：`key:` 所在文件必须是**存储规格持有者**（含 `_KEY` 常量声明或
    // safeGet/safeSet 消费），排除 i18n 文案表（perf-concurrent.ts 的
    // `key: "diagnostics.perfConcurrentVerdict*"` 同样是 key: 形态但那是翻译键）。
    // 判据：同文件出现过存储键常量名（/(_KEY|_PREFIX)\s*=\s*"/）或 safe* 消费。
    const isStorageSpec =
      /_KEY\s*=\s*"/.test(text) || /\b(?:safeGet|safeSet|safeGetJSON|safeRemove)\(/.test(text);
    if (isStorageSpec) {
      for (const m of text.matchAll(/^\s*key:\s*"([^"]+)"/gm)) {
        if (!/[/\-_:.]/.test(m[1])) continue;
        if (!found.has(m[1])) found.set(m[1], r);
      }
    }
    // 键前缀常量（scene-capability 的 STORAGE_PREFIX = "ysm-scene-cap-"）：前缀本身
    // 不是完整键，注册名用 `<prefix>*` 通配形态参与对账。
    for (const m of text.matchAll(/\b[A-Z][A-Z0-9_]*_PREFIX\s*(?::\s*string\s*)?=\s*"([^"]+)"/g)) {
      if (!found.has(`${m[1]}*`)) found.set(`${m[1]}*`, r);
    }
  }
  return found;
}

// ─── 收集 Go AppConfig 的 json 字段名 ───
function collectGoConfigFields() {
  const file = path.join(ROOT, "go", "types", "config.go");
  const text = fs.readFileSync(file, "utf8");
  const start = text.indexOf("type AppConfig struct {");
  assert.ok(start >= 0, "go/types/config.go 未找到 AppConfig 结构体");
  // 取结构体大括号内的内容（字段声明都带 `json:"..."` tag）
  const body = text.slice(start, text.indexOf("\n}", start));
  const fields = new Map(); // jsonName -> goField
  for (const m of body.matchAll(/^\t(\w+)\s+[\w[\]map*.]+\s+`json:"([^",]+)/gm)) {
    fields.set(m[2], m[1]);
  }
  return fields;
}

// ─── 读台账 ───
// 磁盘轨登记名带 `disk:` 前缀（theme 跨轨同名，见 settings-keys.ts 的前缀注释），
// 故断言按前缀分流：goField 取 `disk:` 条目的 goField（并与 Go 侧 json 字段比对），
// key→tier 映射仅用于非磁盘轨的键。
function readLedger() {
  assert.ok(fs.existsSync(LEDGER_FILE), `台账文件不存在：${rel(LEDGER_FILE)}`);
  const text = fs.readFileSync(LEDGER_FILE, "utf8");
  const diskPrefix = "disk:";
  const localKeys = new Map(); // localStorage key -> {tier, authority, migrates}
  const diskFields = new Set(); // goField 值
  for (const m of text.matchAll(
    /key:\s*"([^"]+)"[\s\S]{0,400}?tier:\s*"([^"]+)"[\s\S]{0,400}?authority:\s*"([^"]+)"[\s\S]{0,400}?migrates:\s*(true|false)/g,
  )) {
    const isDisk = m[1].startsWith(diskPrefix);
    if (isDisk) {
      diskFields.add(m[1].slice(diskPrefix.length));
      continue;
    }
    localKeys.set(m[1], { tier: m[2], authority: m[3], migrates: m[4] === "true" });
  }
  // 废弃字段以元组 + .map 批量登记（`["disk:ysmRoot", "YsmRoot", "…"]`），
  // 上一条逐字面量口径抓不到它们——它们也是磁盘轨登记，必须计入。
  // 只收 json 名（元组第一项去前缀）：Go 字段名（第二项）不是 json 契约的一部分，
  // 收进 diskFields 会让断言 E 把它当成幽灵字段误报（json tag 才是磁盘轨对账唯一口径）。
  for (const m of text.matchAll(/\[\s*"(disk:[^"]+)"\s*,\s*"([^"]+)"/g)) {
    diskFields.add(m[1].slice(diskPrefix.length));
  }
  return { localKeys, diskFields };
}

const VALID_TIERS = ["go-disk", "local-storage", "indexed-db", "session"];
const VALID_AUTHORITIES = ["disk-authority", "browser-authority", "dual-write", "non-persistent"];

const files = productionFiles(SRC_DIR);
const srcKeys = collectLocalStorageKeys(files);
const goFields = collectGoConfigFields();
const { localKeys, diskFields } = readLedger();

// ─── 断言 D：台账自洽性 ───
// D1. 键名不得重复登记（同名 entry 出现两次 = 两处各写一份归属，口径必然漂移）
const entryCount = new Map();
const ledgerText = fs.readFileSync(LEDGER_FILE, "utf8");
for (const m of ledgerText.matchAll(/key:\s*"([^"]+)"/g)) {
  entryCount.set(m[1], (entryCount.get(m[1]) || 0) + 1);
}
const dupKeys = [...entryCount.entries()].filter(([, n]) => n > 1).map(([k, n]) => `${k}(×${n})`);
assert.deepStrictEqual(
  dupKeys,
  [],
  `台账里同一个键登记了多次：\n  ${dupKeys.join("\n  ")}\n` +
    `一个键只登记一次；如果你要表达「同一键在两处被使用」，那是代码事实，不需要两行台账。` +
    `（磁盘轨与 localStorage 轨的同名物理键如 theme/themeAuto，用 disk: 前缀分列。）`,
);

// D2. 轨值与权威值必须合法
const badTier = [...localKeys.values()].filter((v) => !VALID_TIERS.includes(v.tier));
assert.deepStrictEqual(
  badTier.map((v) => v.tier),
  [],
  `台账存在非法 tier 值（合法：${VALID_TIERS.join(" / ")}）`,
);
const badAuthority = [...localKeys.values()].filter(
  (v) => !VALID_AUTHORITIES.includes(v.authority),
);
assert.deepStrictEqual(
  badAuthority.map((v) => v.authority),
  [],
  `台账存在非法 authority 值（合法：${VALID_AUTHORITIES.join(" / ")}）`,
);

// D3. 迁移口径必须与轨一致：只有 go-disk 轨随 ysm_config.json 迁移；
//     localStorage / IndexedDB 轨换机即丢（浏览器 profile 不随文件复制），
//     会话内存轨本就不持久。三者之外出现 migrates:true 即为错误登记。
const badMigrate = [...localKeys.entries()]
  .filter(([, v]) => v.tier !== "go-disk" && v.migrates)
  .map(([k, v]) => `${k}(tier=${v.tier}, migrates=true)`);
assert.deepStrictEqual(
  badMigrate,
  [],
  `只有 go-disk 轨随 ysm_config.json 迁移。以下键登记了 migrates=true 但不在磁盘轨：\n  ${badMigrate.join("\n  ")}`,
);

// D4. 反向口径：go-disk 轨的键（磁盘轨已由 readLedger 按 disk: 前缀分流）恒迁移，
//     这一点由「磁盘键名 = Go json 字段」的结构保证——它在 ysm_config.json 里，
//     随文件迁移。故此处只需断言 localKeys 不得自称 go-disk 轨
//     （磁盘轨登记必须走 disk: 前缀，防止磁盘字段被登记成一条 localStorage 键）。
const strayDiskTier = [...localKeys.entries()]
  .filter(([, v]) => v.tier === "go-disk")
  .map(([k]) => k);
assert.deepStrictEqual(
  strayDiskTier,
  [],
  `磁盘轨登记必须用 disk: 前缀的 key（此处这些键无前缀却声明 tier:"go-disk"）：\n  ${strayDiskTier.join("\n  ")}`,
);

// ─── 断言 B（主价值）：前端真实使用的 localStorage 键必须都被台账登记 ───
// 前缀通配（台账以 `ysm-scene-cap-*` 登记）与源码里的具体键（`ysm-scene-cap-fog` 等）
// 是「一族」关系：源码某键被登记，当且仅当存在同前缀的通配登记或精确登记。
const unregistered = [...srcKeys.entries()]
  .filter(
    ([k]) =>
      !localKeys.has(k) &&
      ![...localKeys.keys()].some((lk) => lk.endsWith("*") && k.startsWith(lk.slice(0, -1))),
  )
  .map(([k, f]) => `${k}（${f}）`);
assert.deepStrictEqual(
  unregistered,
  [],
  `以下 localStorage 键在前端源码中使用但未登记进 settings-keys.ts 台账：\n  ${unregistered.join("\n  ")}\n` +
    `新增设置键必须「写键 + 登记台账」两步走，缺一步本用例转红。\n` +
    `（若某键并非用户设置而是纯运行时缓存，请登记为 tier:"session" / authority:"non-persistent"。）`,
);

// ─── 断言 A：台账登记的 localStorage 键必须真的存在（防死键 / 防笔误） ───
// 磁盘轨（disk: 前缀条目）已在 readLedger 分流出去，此处只查 localStorage 轨。
// 前缀通配（`ysm-scene-cap-*`）以源码里的前缀常量形态
// （`STORAGE_PREFIX = "ysm-scene-cap-"`）出现，扫描口径已一并收进 srcKeys。
const phantomLocalKeys = [...localKeys.entries()]
  .filter(([k]) => {
    if (srcKeys.has(k)) return false;
    // 通配登记：源码须有同前缀的具体键（回退扫到的即前缀常量本身）
    if (k.endsWith("*")) {
      const p = k.slice(0, -1);
      return ![...srcKeys.keys()].some((sk) => sk.startsWith(p));
    }
    return true;
  })
  .map(([k, v]) => `${k}(tier=${v.tier})`);
assert.deepStrictEqual(
  phantomLocalKeys,
  [],
  `台账登记了这些键但前端源码里找不到任何使用（死键或笔误）：\n  ${phantomLocalKeys.join("\n  ")}`,
);

// ─── 断言 C：Go AppConfig 每个 json 字段都必须被台账登记 ───
const unregisteredGo = [...goFields.keys()]
  .filter((f) => !diskFields.has(f))
  .map((f) => `${f}(${goFields.get(f)})`);
assert.deepStrictEqual(
  unregisteredGo,
  [],
  `Go AppConfig 的这些 json 字段未被台账登记（tier:"go-disk"）：\n  ${unregisteredGo.join("\n  ")}\n` +
    `磁盘轨字段漏登记 = 备份文档与台账都会漏掉这项设置。`,
);

// ─── 断言 E（磁盘轨反向对账，锐评 2026-10-16）：台账 disk: 条目必须仍是 Go 现存 json 字段 ───
// 断言 C 是「Go 字段 ⊆ 台账」；本断言补另一向「台账 disk: ⊆ Go 字段」，二者合起来
// 才是双向对账——此前磁盘轨只有单向，台账挂着已删除字段的登记（幽灵条目）不会红：
// 备份文档照旧宣传一项不存在的设置，且旧导出文件导入时该字段被解析静默丢弃，无人报信。
const phantomDiskEntries = [...diskFields].filter((f) => !goFields.has(f));
assert.deepStrictEqual(
  phantomDiskEntries,
  [],
  `台账登记了这些 disk: 键但 Go AppConfig 已无对应 json 字段（幽灵条目）：\n  ${phantomDiskEntries.join("\n  ")}\n` +
    `字段删除须同步删除台账登记（与 localStorage 轨的断言 A 同理——死键/幽灵都会误导备份叙事）。`,
);

console.log(
  `[OK] test_settings_key_ledger.ts 全部断言通过（台账登记 go-disk ${diskFields.size} 字段` +
    ` + localStorage/IDB ${localKeys.size} 键；扫描生产文件 ${files.length} 个，` +
    `前端源码键 ${srcKeys.size} 个，Go 字段 ${goFields.size} 个）`,
);
