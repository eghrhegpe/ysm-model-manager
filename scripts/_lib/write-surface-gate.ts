#!/usr/bin/env node
/**
 * write-surface-gate.ts — 「写入口必须失效派生缓存」契约的派生引擎（两枚闸共用）。
 *
 * 立因（2026-10-10 闸审计）：旧版两枚契约闸（test_fileops_write_invalidate /
 * test_sync_write_cache_pairing）用**人工枚举的写函数清单**扫调用点——清单漏列一个
 * 写函数，它的调用点根本不进扫描（fail-open）。实证盲区三处：fileops.DeleteModelFile
 * （手动配了失效但闸看不见）、importer 族、下载族；外加结构性盲区：importer.Get 返回的
 * **接口方法值** h.Import() 根本不是 `importer.X(` 字面调用，枚举正则天然抓不到
 * （ImportByType 漏清缓存活 bug 就是这么隐身数月）。
 *
 * 翻转判定方向（fail-closed）：候选写函数集合**从被监视包的导出面自动派生**
 * （读包源码提 `^func [A-Z]`），app 层对 `pkg.X(` 的每个调用点三选一归宿：
 *   ① X ∈ READONLY 豁免表（真只读/纯计算/注册表注入——人工维护，删错即红）；
 *   ② 调用点在 EXEMPT_SITES（按 文件+所属函数+函数名 精确豁免，必须带 reason）；
 *   ③ 调用点所在函数体含该族的失效签名。
 * 新导出一个写函数并被 app 层调用而没归类 → ③ 不满足 → **当场红**。
 * 剩余边界（诚实声明）：闸只在「函数被 app 层调用」时生效——无人调用的新写函数不触发
 * （没有消费面就没有 bug 面，这是可接受的最终盲区）；h.Import 接口方法值经由其汇聚点
 * importer.Get 归类为写（Get 的调用点必须带失效签名），间接覆盖。
 *
 * 失效签名两族（satisfy）：
 *   - "scan"：scanner.InvalidateCache / InvalidatePath（级联钩子自动带下两派生缓存）
 *   - "pair-or-clear"：a.ClearScanCache()（scan+容器+geo 三层）或 instance+sync 显式配对
 *     （go/sync 不能反向依赖 go/instance，配对责任在 app 层——见 go-sync 卡不变量）
 */
import fs from "node:fs";
import path from "node:path";

/** 生产 Go 文件（排除 _test.go 与隐藏目录） */
export function productionGoFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      out.push(...productionGoFiles(abs));
      continue;
    }
    if (!e.name.endsWith(".go") || e.name.endsWith("_test.go")) continue;
    out.push(abs);
  }
  return out;
}

/** 剥离块/行注释（简化实现：不处理字符串内 //——误剥方向只会漏检不会误报） */
export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, "");
}

/** 从包目录（非测试 .go）派生导出函数名集合——候选写面的唯一事实源。 */
export function exportedFuncs(pkgDir) {
  const set = new Set();
  for (const f of fs.readdirSync(pkgDir)) {
    if (!f.endsWith(".go") || f.endsWith("_test.go")) continue;
    for (const line of fs.readFileSync(path.join(pkgDir, f), "utf8").split("\n")) {
      const m = /^func ([A-Z]\w*)\(/.exec(line);
      if (m) set.add(m[1]);
    }
  }
  return set;
}

/** 定位 idx 所属顶层函数：返回 { name, body }；找不到返回 null。 */
export function enclosingFunc(text, idx) {
  const start = text.lastIndexOf("\nfunc ", idx);
  if (start < 0) return null;
  const braceAt = text.indexOf("{", start);
  if (braceAt < 0 || braceAt > idx) return null;
  let depth = 0;
  for (let i = braceAt; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        const sig = text.slice(start, braceAt);
        const m = /func (?:\([^)]*\) )?([A-Za-z_]\w*)/.exec(sig);
        return { name: m ? m[1] : "<anon>", body: text.slice(start, i + 1) };
      }
    }
  }
  return null;
}

const SCAN_TOKENS = ["scanner.InvalidateCache", "scanner.InvalidatePath"];
const CLEAR_TOKEN = "a.ClearScanCache()";
const PAIR_TOKENS = ["instance.InvalidateSyncItemsCache", "ysmsync.InvalidateSyncScanCaches"];

/** 函数体是否满足该族失效签名。 */
export function bodySatisfies(body, satisfy) {
  if (satisfy === "scan") return SCAN_TOKENS.some((t) => body.includes(t));
  if (satisfy === "pair-or-clear")
    return body.includes(CLEAR_TOKEN) || PAIR_TOKENS.every((t) => body.includes(t));
  throw new Error(`unknown satisfy: ${satisfy}`);
}

/**
 * 跑一枚派生闸。cfg：
 *   root: 仓库根
 *   appDir: 被扫的调用方目录（相对 root）
 *   packages: [{ dir, alias, readonly: Set<string>, satisfy }]
 *     dir = 包目录（相对 root，用于派生导出面）；alias = app 层调用前缀（如 "ysmsync"）
 *     readonly = 只读/纯计算/注册类豁免（**必须覆盖全部被调用的非写导出**，漏即红）
 *   exemptSites: [{ file, fn, call, reason }]（file=basename，fn=所属函数名，call=函数名）
 *   minSites: 空转下限（调用点总数低于它 = 派生或扫描本身坏了）
 * 返回 { sites, checked, exemptHits, violations[] }
 */
export function runWriteGate(cfg) {
  const { root, appDir, packages, exemptSites = [], minSites = 1 } = cfg;
  const appAbs = path.join(root, appDir);
  const derived = packages.map((p) => ({
    ...p,
    exports: exportedFuncs(path.join(root, p.dir)),
  }));

  const violations = [];
  let sites = 0;
  let checked = 0;
  let exemptHits = 0;
  const seenExempt = new Set();

  for (const abs of productionGoFiles(appAbs)) {
    const text = stripComments(fs.readFileSync(abs, "utf8"));
    const base = path.basename(abs);
    for (const p of derived) {
      const re = new RegExp(`\\b${p.alias}\\.([A-Z]\\w*)\\s*\\(`, "g");
      for (const m of text.matchAll(re)) {
        const fn = m[1];
        if (!p.exports.has(fn)) continue; // alias 与他包同名函数误撞（如 types.X），导出面为权威
        sites++;
        if (p.readonly.has(fn) || /^(Invalidate|Register|IsValid)/.test(fn)) continue;
        const loc = enclosingFunc(text, m.index);
        if (loc === null) {
          violations.push(`${appDir}/${base}: 无法定位 ${p.alias}.${fn} 调用点所属函数`);
          continue;
        }
        const exKey = `${base}|${loc.name}|${fn}`;
        const ex = exemptSites.find((e) => `${e.file}|${e.fn}|${e.call}` === exKey);
        if (ex) {
          exemptHits++;
          seenExempt.add(exKey);
          continue;
        }
        checked++;
        if (!bodySatisfies(loc.body, p.satisfy)) {
          const line = text.slice(0, m.index).split("\n").length;
          violations.push(
            `${appDir}/${base}:${line} ${p.alias}.${fn} 调用点（函数 ${loc.name}）无失效签名且无豁免——新写面必须归类：只读进 readonly / 有意豁免进 exemptSites(带 reason) / 否则补失效`,
          );
        }
      }
    }
  }

  // 僵尸豁免反查：exemptSites 条目若不再命中任何调用点 = 被豁免的写点已消失，
  // 留着豁免表项 = 未来同位复活时静默放行。删除即绿，防豁免烂尾。
  for (const e of exemptSites) {
    const k = `${e.file}|${e.fn}|${e.call}`;
    if (!seenExempt.has(k)) {
      violations.push(`exemptSites 僵尸条目 ${k}（对应调用点已不存在，删掉它）`);
    }
  }

  if (sites < minSites) {
    violations.push(
      `调用点总数 ${sites} 低于空转下限 ${minSites}——派生/扫描本身失效（包目录或别名改动？）`,
    );
  }
  return { sites, checked, exemptHits, violations };
}
