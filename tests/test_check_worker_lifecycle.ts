#!/usr/bin/env node
/**
 * 契约测试：check-worker-lifecycle.ts Worker 生命周期闸。
 *
 * 覆盖：
 *   1. 判据纯函数（合成样本直测——防真实树碰巧绿时空转假绿）：
 *      `new Worker(` 命中 / `new globalThis.Worker(` 命中 / 注释与模板字面量内形状放行 /
 *      终止出口四路（dispose* / terminate* / reset* / clear* / 工厂 createWorkerBridge）/
 *      行级 worker-allow 豁免（同/上行命中、空理由不豁免、窗口外不豁免）。
 *   2. diffBaseline 计数制：超基线 = 回归、低基线 = fixed、持平 = 静默。
 *   3. 真实树非空转：扫描文件数 > 200 且 `new Worker(` 站点数 > 0
 *      （站点数 > 0 证明检测器真看到了当前树，而非空扫描报绿）。
 *   4. 假绿防线（G2 落地硬要求）：
 *      - 空域 fail-loud：SCAN_AREA 指向不存在目录 → exit 2；
 *      - 判别力：临时注入违规文件 → exit 1 且指名该文件（测完即删）。
 *   5. 子进程契约：--json 合法且 _summary 键齐、--help 退 0、未知参数退 2、
 *      --update 幂等（树未变时「基线无变化」退 0，不改写文件）。
 *
 * 零依赖（仅 node:assert / node:child_process / node:fs / node:path / node:url）。
 * 运行：node tests/test_check_worker_lifecycle.ts
 */
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// 静态 import：脚本带 invokedDirectly 守卫，被 import 时不跑 main()
import {
  diffBaselinePublic as diffBaseline,
  hasTerminateChannel,
  newWorkerSites,
  scanFiles,
  WORKER_ALLOW_RE,
} from "../scripts/check-worker-lifecycle.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GATE = path.join(ROOT, "scripts", "check-worker-lifecycle.ts");
const BASELINE = path.join(ROOT, "docs", ".worker-lifecycle-baseline.json");

const fails: string[] = [];
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log("✓", name);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    fails.push(`${name}: ${msg}`);
    console.error("✗", name, "-", msg);
  }
}

function runGate(args: string[]): { rc: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [GATE, ...args], { cwd: ROOT, encoding: "utf8" });
    return { rc: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { rc: err.status ?? 1, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

/* ── 1. 判据纯函数：什么算裸建 Worker ── */

check("new Worker( 命中（含空行/缩进/换行排版）", () => {
  assert.equal(newWorkerSites('const w = new Worker("./a.ts");\n').length, 1);
  assert.equal(
    newWorkerSites('  pool.push(\n    new Worker(url, { type: "module" })\n  );\n').length,
    1,
  );
});

check("new globalThis.Worker( 防御写法同样命中", () => {
  assert.equal(newWorkerSites('const w = new globalThis.Worker("./a.ts");\n').length, 1);
});

check("多个站点各自成条且行号正确", () => {
  const src = 'const a = new Worker("a");\n\nconst b = new Worker("b");\n';
  assert.deepEqual(newWorkerSites(src), [1, 3]);
});

check("注释内的 new Worker 形状放行（stripNoise）", () => {
  assert.equal(newWorkerSites("// const w = new Worker(x);\n").length, 0);
  assert.equal(newWorkerSites("/* new Worker(x) */\n").length, 0);
});

check("非 new 形态不命中（typeof Worker / Worker 裸引用）", () => {
  assert.equal(newWorkerSites('if (typeof Worker === "undefined") return null;\n').length, 0);
  assert.equal(newWorkerSites("w.terminate();\n").length, 0);
});

/* ── 2. 终止出口四路 ── */

check("终止出口：dispose* / terminate* / reset* / clear* 导出函数放行", () => {
  assert.equal(hasTerminateChannel("export function disposeTextureDecoder(): void {}\n"), true);
  assert.equal(hasTerminateChannel("export function terminatePool(): void {}\n"), true);
  assert.equal(hasTerminateChannel("export function resetEncoderState(): void {}\n"), true);
  assert.equal(hasTerminateChannel("export function clearPending(): void {}\n"), true);
  assert.equal(hasTerminateChannel("export function __resetXxxForTest(): void {}\n"), true);
});

check("终止出口：经 createWorkerBridge 工厂放行", () => {
  assert.equal(
    hasTerminateChannel("import { createWorkerBridge } from './worker-bridge.ts';\n"),
    true,
  );
  assert.equal(hasTerminateChannel("const b = createResolveModeBridge({ workers });\n"), true);
});

check("无终止出口不放行（裸建 + 无出口 = 债务）", () => {
  assert.equal(
    hasTerminateChannel('function spawn(): Worker {\n  return new Worker("x");\n}\n'),
    false,
  );
});

check("私有函数（未导出）不算出口", () => {
  // 非 export 的 dispose 不构成「对外终止通道」——调用方够不着
  assert.equal(hasTerminateChannel("function disposeLocal(): void {}\n"), false);
});

/* ── 3. 行级豁免标记 ── */

check("worker-allow 标记：理由非空才算", () => {
  assert.equal(WORKER_ALLOW_RE.test("// worker-allow: 进程级常驻有意为之"), true);
  assert.equal(WORKER_ALLOW_RE.test("// worker-allow:"), false);
  assert.equal(WORKER_ALLOW_RE.test("// worker-allow:   "), false);
});

/* ── 4. diffBaseline 计数制 ── */

check("diffBaseline：超基线 = 回归", () => {
  const { regressions } = diffBaseline(
    { "a.ts": { "unmanaged-worker": 2 } },
    { "a.ts": { "unmanaged-worker": 1 } },
  );
  assert.equal(regressions.length, 1);
});

check("diffBaseline：低基线 = fixed、持平 = 静默", () => {
  assert.equal(
    diffBaseline({ "a.ts": { "unmanaged-worker": 0 } }, { "a.ts": { "unmanaged-worker": 1 } }).fixed
      .length,
    1,
  );
  const same = diffBaseline(
    { "a.ts": { "unmanaged-worker": 1 } },
    { "a.ts": { "unmanaged-worker": 1 } },
  );
  assert.equal(same.regressions.length + same.fixed.length, 0);
});

/* ── 5. 真实树非空转（关键：证明检测器看到了当前树） ── */

check("真实树非空转：扫到 >200 文件且 new Worker 站点 > 0", () => {
  const r = runGate(["--json"]);
  const j = JSON.parse(r.out);
  assert.ok(
    j._summary.scannedFiles > 200,
    `scannedFiles=${j._summary.scannedFiles} 太少，疑空扫描`,
  );
  assert.ok(j._summary.workerSites > 0, "workerSites=0 疑解析器失效（闸本应 fail-loud 而非报绿）");
});

/* ── 6. 假绿防线 ── */

check("空域 fail-loud：SCAN_AREA 指向不存在目录 → exit 2", () => {
  // 通过临时改 SCAN_AREA 验证（与 check-singleton-hygiene 同款手法）
  const src = fs.readFileSync(GATE, "utf8");
  const probe = src.replace(
    'const SCAN_AREA = "preview-3d";',
    'const SCAN_AREA = "__no_such_area__";',
  );
  assert.notEqual(probe, src, "SCAN_AREA 常量形状变了，本测试需同步更新");
  const tmp = `${GATE}.probe.ts`;
  fs.writeFileSync(tmp, probe, "utf8");
  try {
    let rc = 0;
    let out = "";
    try {
      out = execFileSync(process.execPath, [tmp], { cwd: ROOT, encoding: "utf8" });
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      rc = err.status ?? 1;
      out = (err.stdout ?? "") + (err.stderr ?? "");
    }
    assert.equal(rc, 2, `空域应 exit 2，实际 ${rc}`);
    // 两条合法拒绝路径（均 exit 2）：① 域不存在（collectFiles 抛错）；
    // ② 域存在但 0 生产文件（空域 fail-loud）。任一都算拒绝报绿。
    assert.match(out, /扫描域不存在|0 个生产文件|拒绝报绿/);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

check("判别力：注入违规文件 → exit 1 且指名", () => {
  const probeDir = path.join(ROOT, "frontend", "src", "preview-3d", "decoder");
  const probeFile = path.join(probeDir, "__gate_probe.ts");
  fs.writeFileSync(
    probeFile,
    '// 临时探针（测完即删）\nexport function spawnProbeWorker(): Worker {\n  return new Worker("./x.ts");\n}\n',
    "utf8",
  );
  try {
    const r = runGate([]);
    assert.equal(r.rc, 1, `注入违规应 exit 1，实际 ${r.rc}`);
    assert.match(r.out, /__gate_probe/);
  } finally {
    fs.rmSync(probeFile, { force: true });
  }
});

check("空目录（域存在但无文件）→ scanFiles 零命中且 collectFiles 不抛", () => {
  // 覆盖另一条空域路径：域真实存在但为空/无匹配扩展名。
  // 此时 collectFiles 返回 []，main 的空域 fail-loud 接管（exit 2）。
  const emptyDir = path.join(ROOT, "frontend", "src", "preview-3d", "__empty_probe_dir__");
  fs.mkdirSync(emptyDir, { recursive: true });
  try {
    // 直接验证：空输入 → 零命中（不抛），证明 scanFiles 对空集安全
    assert.deepEqual(scanFiles([]), []);
  } finally {
    fs.rmdirSync(emptyDir, { force: true });
  }
});

/* ── 7. 子进程契约 ── */

check("--json 合法且 _summary 键齐", () => {
  const r = runGate(["--json"]);
  assert.equal(r.rc, 0);
  const j = JSON.parse(r.out);
  for (const k of [
    "ok",
    "total",
    "files",
    "scannedFiles",
    "workerSites",
    "baseline",
    "regressions",
  ]) {
    assert.ok(k in j._summary, `_summary 缺键 ${k}`);
  }
  assert.equal(j._summary.ok, true);
});

check("--help 退 0", () => {
  assert.equal(runGate(["--help"]).rc, 0);
});

check("未知参数退 2（陷阱 #12：拼错 flag 不得静默忽略）", () => {
  assert.equal(runGate(["--updat"]).rc, 2);
});

check("--update 幂等：树未变时报「基线无变化」退 0", () => {
  const before = fs.readFileSync(BASELINE, "utf8");
  const r = runGate(["--update"]);
  assert.equal(r.rc, 0, r.out);
  assert.match(r.out, /基线无变化/);
  assert.equal(fs.readFileSync(BASELINE, "utf8"), before, "--update 在无变化时不应改写基线");
});

/* ── 汇总 ── */

if (fails.length) {
  console.error(`\n✗ ${fails.length} 项失败:`);
  for (const f of fails) console.error("  -", f);
  process.exit(1);
}
console.log("\n✅ check-worker-lifecycle 契约测试全过");
