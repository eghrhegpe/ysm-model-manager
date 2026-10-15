#!/usr/bin/env node
/**
 * 契约测试：带哈希扫描入口的消费者分类闸（派生 fail-closed，锐评 2026-10-16）。
 *
 * 背景：ModelEntry.Hash 只服务 go/sync 内容匹配（D2′-a / ADR-269），其余只读消费方
 * 走带哈希入口 = 冷路径替同步付「全库逐文件读全量字节算 SHA256」的税。2026-10-15
 * 止血 P0-1 把树切浏览投影（ScanEntriesBrowse，无哈希）后，SearchModels / 头像链 /
 * CLI scan·verify·flow 仍留哈希入口——「逐调用点迁移」的方法天然漏器官（本闸的立项
 * 动因）。修法不是再人工过一遍调用点，而是让漏归类当场红：
 *
 * 口径：扫 internal/app + go/cli 的 .go（排除 _test.go），带哈希 seam 的每个
 * **调用点（.Name(）或函数值旁挂（.Name 非调用）**三选一归宿：
 *   ① 所在函数体消费 `.Hash`（真实哈希消费者，自动过关）；
 *   ② 所在函数 = seam 定义自身或其委托薄壳（SEAM_DEFS，包内委托不算消费方）；
 *   ③ LEDGER 精确豁免（文件 + 函数 + 形态 + seam + 期望命中数 + reason）——
 *      僵尸条目反查（命中数≠期望即红，防归类漂移与烂尾豁免）。
 * 新增未归类的哈希入口调用/旁挂 → violations 非空，当场红。
 *
 * 运行：node tests/test_hash_entry_consumers.ts（或经 scripts/contract-tests.ts 统一入口）。
 * 退出码：0 全绿；非 0 断言失败。
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 带哈希扫描 seam（app 层绑定 + 内部委托；ForBrowse/BrowseWithHit/Lite 为无哈希投影，不在列）。
const SEAMS = [
	"ScanModelEntries",
	"ScanModelEntriesWithLabel",
	"ScanModelEntriesFiltered",
	"scanModelEntriesWithHit",
	"scanModelEntries",
];

// seam 定义/薄壳自身——其体内的委托调用不算「消费方」（防闸把实现细节当消费者误报）。
const SEAM_DEFS = new Set([...SEAMS, "ScanModelEntriesForBrowse", "scanModelEntriesBrowseWithHit"]);

/**
 * 精确豁免账（新增条目必须带 reason；关闭迁移后应删条目，僵尸反查兜底）。
 */
const LEDGER: {
	file: string;
	fn: string;
	kind: "call" | "pass";
	seam: string;
	count: number;
	reason: string;
}[] = [
	{
		file: "app.go",
		fn: "ServiceStartup",
		kind: "pass",
		seam: "scanModelEntries",
		count: 1,
		reason:
			"watcher.New 的 ScanFunc——watcher 变更同步段调 SyncToggleStatus（go/sync collectToggleRepoIndex 读 e.Hash 做内容级启禁判定），真实哈希消费者，必须带哈希条目。",
	},
	{
		file: "app_config.go",
		fn: "restartWatcher",
		kind: "pass",
		seam: "scanModelEntries",
		count: 1,
		reason: "同 NewApp——watcher 重建链同款注入（两条装配路径同契约，勿合并掩盖差异）。",
	},
	{
		file: "app_install_import.go",
		fn: "SyncCustomToRepo",
		kind: "pass",
		seam: "ScanModelEntries",
		count: 1,
		reason:
			"ysmsync.SyncCustomToRepo 的 scanFn——repoHashes[e.Hash] 内容级收编判定（go/sync/sync_push.go），真实哈希消费者。",
	},
	{
		file: "app_install_instance.go",
		fn: "SyncModelToggleStatus",
		kind: "pass",
		seam: "ScanModelEntries",
		count: 1,
		reason: "ysmsync.SyncToggleStatus——collectToggleRepoIndex 读 e.Hash 做启禁同步判定。",
	},
	{
		file: "app_install_instance.go",
		fn: "SyncModelToggleStatusForType",
		kind: "pass",
		seam: "ScanModelEntries",
		count: 1,
		reason: "同 SyncModelToggleStatus——逐实例循环路径同款 SyncToggleStatus 注入。",
	},
	{
		file: "app_install_instance.go",
		fn: "relinkDir",
		kind: "pass",
		seam: "ScanModelEntries",
		count: 1,
		reason:
			"ysmsync.RelinkDir——buildRelinkRepoIndex(scanFn(filesRoot)) 按 e.Hash 匹配重链接源（ADR-342 四件套）。",
	},
	{
		file: "app_install_instance.go",
		fn: "SyncResources",
		kind: "pass",
		seam: "scanModelEntries",
		count: 1,
		reason:
			"SyncResourcesWithConfig 的 scanFn 旁挂哈希进 collectScanHashes（D2′-a / ADR-269 内容级 diff），真实哈希消费者。",
	},
	{
		file: "model.go",
		fn: "runList",
		kind: "call",
		seam: "ScanModelEntries",
		count: 1,
		reason:
			"`list --format json` 全量序列化 ModelEntry 作为导出交付物——Hash 是输出契约的一部分（切浏览投影 = 契约字段消失，导出侧消费算数）。",
	},
	{
		file: "model.go",
		fn: "runBenchmark",
		kind: "call",
		seam: "ScanModelEntries",
		count: 2,
		reason:
			"B1 被测对象即「带哈希入口的冷扫成本」（同步链真实支付路径的基准），B4 消费同一条目清单做稳定单模型分析——换投影则基准失去意义。",
	},
];

const SCAN_DIRS = ["internal/app", "go/cli"];

type Site = { file: string; fn: string; kind: "call" | "pass"; seam: string; line: number };

function listGoFiles(dir: string): string[] {
	const out: string[] = [];
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) out.push(...listGoFiles(p));
		else if (e.name.endsWith(".go") && !e.name.endsWith("_test.go")) out.push(p);
	}
	return out;
}

const FUNC_RE = /^func\s+(?:\([^)]*\)\s*)?(\w+)\s*\(/;

function collectSites(file: string): Site[] {
	const lines = fs.readFileSync(file, "utf8").split("\n");
	const sites: Site[] = [];
	let curFn = "<top>";
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		const fm = FUNC_RE.exec(raw);
		if (fm) {
			curFn = fm[1];
			continue; // 定义行本身不含调用点
		}
		const trimmed = raw.trimStart();
		if (trimmed.startsWith("//")) continue; // 行注释里的 seam 提及不是调用
		for (const seam of SEAMS) {
			const esc = seam.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			// 调用点：.seam(（ForBrowse/BrowseWithHit 等更长的名字天然不匹配——
			// 正则要求 seam 之后紧跟 "("，"…EntriesForBrowse(" 不成立）。
			for (const m of raw.matchAll(new RegExp(`\\.${esc}\\(`, "g"))) {
				sites.push({ file: path.basename(file), fn: curFn, kind: "call", seam, line: i + 1 });
			}
			// 函数值旁挂：.seam 后既不是 "(" 也不是标识符字符（a.scanModelEntries, 传参）。
			for (const m of raw.matchAll(new RegExp(`\\.${esc}\\b(?!\\s*\\()[^\\w]`, "g"))) {
				sites.push({ file: path.basename(file), fn: curFn, kind: "pass", seam, line: i + 1 });
			}
		}
	}
	return sites;
}

/** 所在函数体（定义行到下一个顶层 func 行）是否消费 .Hash。 */
function bodyConsumesHash(file: string, fn: string): boolean {
	const lines = fs.readFileSync(file, "utf8").split("\n");
	let start = -1;
	for (let i = 0; i < lines.length; i++) {
		const fm = FUNC_RE.exec(lines[i]);
		if (!fm) continue;
		if (fm[1] === fn) {
			start = i;
			break;
		}
	}
	if (start < 0) return false;
	for (let i = start + 1; i < lines.length; i++) {
		if (FUNC_RE.test(lines[i])) break;
		if (/\.Hash\b/.test(lines[i])) return true;
	}
	return false;
}

const allSites: Site[] = [];
for (const dir of SCAN_DIRS) {
	const abs = path.join(ROOT, dir);
	for (const f of listGoFiles(abs)) allSites.push(...collectSites(f));
}

// 全文件索引（file → abs），供体判据用
const fileAbs = new Map<string, string>();
for (const dir of SCAN_DIRS) {
	for (const f of listGoFiles(path.join(ROOT, dir))) fileAbs.set(path.basename(f), f);
}

const violations: string[] = [];
const ledgerHits = new Map<number, number>();
LEDGER.forEach(() => ledgerHits.set(ledgerHits.size, 0));

for (const site of allSites) {
	if (SEAM_DEFS.has(site.fn)) continue; // ② seam 定义/委托
	if (bodyConsumesHash(fileAbs.get(site.file) ?? "", site.fn)) continue; // ① 真实哈希消费
	const li = LEDGER.findIndex(
		(l) => l.file === site.file && l.fn === site.fn && l.kind === site.kind && l.seam === site.seam,
	);
	if (li >= 0) {
		ledgerHits.set(li, (ledgerHits.get(li) ?? 0) + 1);
		continue;
	}
	violations.push(
		`${site.file}|${site.fn}:${site.line} ${site.kind} "${site.seam}"（带哈希入口未归类——` +
			`不消费 Hash 请改浏览投影/Lite 入口；确需哈希请入 LEDGER 并写明 reason）`,
	);
}

assert.deepStrictEqual(
	violations,
	[],
	"带哈希扫描入口的每个消费点必须有归宿（①消费 .Hash ②seam 定义 ③LEDGER 豁免）——" +
		"无哈希消费方走哈希入口 = 冷路径全库 SHA256 税（锐评 2026-10-16 立项）。\n" +
		violations.map((v) => `  ${v}`).join("\n"),
);

for (let i = 0; i < LEDGER.length; i++) {
	const l = LEDGER[i];
	const hits = ledgerHits.get(i) ?? 0;
	assert.strictEqual(
		hits,
		l.count,
		`豁免条目 ${l.file}|${l.fn} ${l.kind} "${l.seam}" 期望命中 ${l.count}，实际 ${hits}——` +
			`漂移（消费点被改而未销账）或僵尸豁免（点位已迁走，LEDGER 条目该删）。`,
	);
}

assert.ok(
	allSites.length >= 5,
	`受审 seam 位点应 ≥5（现网 3 旁挂 + 3 调用），实际 ${allSites.length}——seam 清单或扫描目录漂移，闸空转。`,
);

console.log(
	`[test_hash_entry_consumers] OK — 派生 fail-closed：${allSites.length} 个带哈希 seam 位点，` +
		`${LEDGER.length} 条精确豁免全命中，新增位点必归类`,
);
