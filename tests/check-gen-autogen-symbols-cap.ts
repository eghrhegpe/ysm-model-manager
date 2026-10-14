#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { finish, ok, runScript } from "./_lib.mts";

// gen-knowledge-autogen「broad_claim 巨兽卡符号封顶」契约（ADR-338-d2，2026-10-14）。
// 背景：auto_fields.symbols_with_lines 全仓零信息消费者（5.14 头注实证），目录级宽认领卡
// （model3d 1100 条）每次检索命中都全价吞下 frontmatter。封顶 = broad_claim: true 卡只写
// 前 99 条 + 尾部标记 `- symbols_total: N`；普通卡与冻结卡不受影响。
// 标记行同时是旗标新鲜度的机器信号：5.14/5.17 计数含标记行（99+1=100 ≥ 阈值）→ 豁免不漂；
// 卡真被收窄后 gen 写全量无标记 → 5.17 提示移除旗标（闭环自愈，drift 零改动）。
// 隔离策略：临时卡目录 + --kc-dir；源侧用 frontend/src/utils/dom/（导出符号数 >99 的
// 真实目录，具体值以普通卡全量态为准动态断言——阈值边缘数会随源码演化漂移，勿硬编码）。

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ysm-symcap-"));
const CARD_BROAD = "zzz-symcap-broad.md";
const CARD_PLAIN = "zzz-symcap-plain.md";
const CARD_FROZEN = "zzz-symcap-frozen.md";
const DIR_SOURCE = "frontend/src/utils/dom/"; // >99 导出符号，真实触发封顶
const CAP = 99; // 与 gen 的 SYMBOLS_CAP_KEEP 对齐

function writeCard(name: string, extraHead: string[]) {
  fs.writeFileSync(
    path.join(TMP_DIR, name),
    [
      "---",
      `kind: ${name.replace(/\.md$/, "")}`,
      `name: 封顶契约临时卡 ${name}`,
      "tier: leaf",
      "category: utils",
      ...extraHead,
      "source_files:",
      `  - ${DIR_SOURCE}`,
      "use_when:",
      "  - 封顶契约",
      "---",
      "",
      `# 封顶契约临时卡 ${name}`,
      "",
    ].join("\r\n"),
    "utf8",
  );
}

/** 解析卡的 symbols_with_lines 块：返回 { 符号条目数, 标记值(无则 null) }。 */
function readBlock(name: string): { n: number; total: number | null } {
  const text = fs.readFileSync(path.join(TMP_DIR, name), "utf8");
  const items: string[] = [];
  let inSym = false;
  for (const l of text.split(/\r?\n/)) {
    if (/^\s+symbols_with_lines:/.test(l)) {
      inSym = true;
      continue;
    }
    if (!inSym) continue;
    const m = l.match(/^    - (.+)$/);
    if (m) items.push(m[1]!);
    else if (!/^\s/.test(l)) break;
  }
  const marker = items.find((s) => s.startsWith("symbols_total:"));
  return {
    n: items.filter((s) => !s.startsWith("symbols_total:")).length,
    total: marker ? Number(marker.split(":")[1]!.trim()) : null,
  };
}

console.log("=== gen-knowledge-autogen broad_claim 符号封顶契约 ===");

try {
  writeCard(CARD_BROAD, ["broad_claim: true"]);
  writeCard(CARD_PLAIN, []);

  // 1. broad_claim 卡封顶：99 条 + 标记 = 全量数（全量数以普通卡动态为准，勿硬编码）
  let r = runScript("gen-knowledge-autogen.ts", "--kc-dir", TMP_DIR);
  ok("gen 执行退出 0", r.status === 0, `stderr=${r.stderr?.slice(0, 150)}`);
  const plain1 = readBlock(CARD_PLAIN);
  ok("前置：普通卡全量态 >99 且无标记", plain1.n > CAP && plain1.total === null, `n=${plain1.n} total=${plain1.total}`);
  const broad1 = readBlock(CARD_BROAD);
  ok(`broad_claim 封顶：符号条目恰 ${CAP}`, broad1.n === CAP, `实际 ${broad1.n}`);
  ok("broad_claim 封顶：标记值 = 全量数", broad1.total === plain1.n, `标记=${broad1.total} 全量=${plain1.n}`);
  {
    // 标记行 = 块末条目：symbols_with_lines 块内最后一个 `- ` 行即标记
    const bt = fs.readFileSync(path.join(TMP_DIR, CARD_BROAD), "utf8");
    const block = bt.split(/\r?\n/);
    const start = block.findIndex((l) => /^\s+symbols_with_lines:/.test(l));
    let last = start;
    for (let i = start + 1; i < block.length; i++) {
      if (/^ {4}- /.test(block[i]!)) last = i;
      else if (!/^\s/.test(block[i]!) || block[i]!.trim() === "") break;
    }
    ok("标记行是块末条目", /^ {4}- symbols_total: \d+$/.test(block[last]!), `末行=${block[last]}`);
  }

  // 2. 幂等：再跑不重复重写；--check 零漂移（比对域含标记）
  runScript("gen-knowledge-autogen.ts", "--kc-dir", TMP_DIR);
  const broad2 = readBlock(CARD_BROAD);
  ok("重跑幂等（仍 99+同标记）", broad2.n === CAP && broad2.total === broad1.total, `n=${broad2.n} total=${broad2.total}`);
  r = runScript("gen-knowledge-autogen.ts", "--check", "--kc-dir", TMP_DIR);
  ok("封顶态 --check 退出 0（幂等成立）", r.status === 0, `stderr=${r.stderr?.slice(0, 200)}`);

  // 3. 全量数变化必须被 --check 检出——封顶标记不得成为漂移遮蔽死角。
  //    安全等价法（不碰真实源码树，防并行会话竞态）：把封顶卡的标记值人为改错
  //    （= 模拟源码侧符号增删导致全量数变化的检出面），--check 须点名标记漂移，
  //    gen 重写后标记回归真实全量值——标记参与比对域即为证明。
  {
    const bt = fs.readFileSync(path.join(TMP_DIR, CARD_BROAD), "utf8");
    fs.writeFileSync(path.join(TMP_DIR, CARD_BROAD), bt.replace(/symbols_total: (\d+)/, "symbols_total: $1-wrong"), "utf8");
    r = runScript("gen-knowledge-autogen.ts", "--check", "--kc-dir", TMP_DIR);
    ok("标记值失真 → --check 报漂移退出 1", r.status === 1, `status=${r.status}`);
    ok(
      "漂移内容是标记（symbols_total 进 added/removed 判决）",
      (r.stderr || "").includes("symbols_total"),
      `stderr=${r.stderr?.slice(0, 200)}`,
    );
    runScript("gen-knowledge-autogen.ts", "--kc-dir", TMP_DIR);
    const broad3 = readBlock(CARD_BROAD);
    ok("gen 重写后标记回归全量值（条目仍 99）", broad3.total === plain1.n && broad3.n === CAP, `n=${broad3.n} total=${broad3.total}`);
  }

  // 4. 冻结卡（affected:false + broad_claim）：标记伪条目不得被误判「已删符号」——
  //    否则每轮 removed 假漂移永动。写法：以封顶态为底手工转冻结，--check 应零漂移。
  const capped = fs.readFileSync(path.join(TMP_DIR, CARD_BROAD), "utf8");
  fs.writeFileSync(
    path.join(TMP_DIR, CARD_FROZEN),
    capped
      .replace("kind: zzz-symcap-broad", "kind: zzz-symcap-frozen")
      .replace("name: 封顶契约临时卡 zzz-symcap-broad", "name: 封顶契约临时卡 zzz-symcap-frozen")
      .replace("# 封顶契约临时卡 zzz-symcap-broad", "# 封顶契约临时卡 zzz-symcap-frozen")
      .replace("tier: leaf", "tier: leaf\naffected: false"),
    "utf8",
  );
  r = runScript("gen-knowledge-autogen.ts", "--check", "--kc-dir", TMP_DIR);
  ok(
    "冻结卡标记行不被误判为残留符号（--check 不点冻结卡名）",
    !(r.stderr || "").includes(CARD_FROZEN),
    `stderr=${r.stderr?.slice(0, 200)}`,
  );

  // 5. 与 5.14/5.17 闭环（drift 零改动的成立前提）：封顶态块行数 = 99+1 = 100 ≥ 阈值
  //    → broad_claim 旗标保持新鲜（5.17 不叫 stale）；卡真收窄后全量无标记、计数 <100
  //    → 5.17 提示移除旗标。此处验计数口径与 drift countDerivedSymbols 一致。
  const cappedText = fs.readFileSync(path.join(TMP_DIR, CARD_BROAD), "utf8");
  const counted = (cappedText.match(/^ {4,}-\s+/gm) || []).length;
  ok(`封顶态 drift 计数 = 100（99+标记 ≥ 阈值，旗标豁免不漂）`, counted === CAP + 1, `实际 ${counted}`);
} finally {
  if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true, force: true });
}

finish("gen-knowledge-autogen broad_claim 符号封顶契约全过");
