#!/usr/bin/env node
/**
 * 契约测试：binding-check.ts 对 bindings 产物形态的 fail-closed 断言。
 *
 * ADR-001 §2 红线：bindings 必须带 `-ts` 生成（产出 .ts）；漏 `-ts` 会产出 .js，
 * 且 -clean 会清掉 git 跟踪的 .ts（2026-08-05 曾致 17 个 .ts 被换为 .js）。
 * 现有防线（统一入口 / binding-check 只读 app.ts / 同步提醒 / CI 保鲜）都拦不住
 * 「app.ts 仍在、旁边多了个 .js」的形态，故由本工具对产物目录做硬断言。
 *
 * 覆盖（3 次 spawn，控制并行契约测试下的耗时——每次 spawn 都会完整读 Go 侧对账）：
 *   1. bindings 现状干净 → exit 0（回归守卫，防断言写反/误伤）
 *   2. 注入 .js/.mjs/.cjs 三探针 → exit 1 + fatal「绑定产物混入 JS 后缀」（红线主用例 + 后缀集）
 *   3. .d.ts 探针 → 不报（合法产物，防误伤）
 *
 * 零依赖（仅 node:child_process / node:fs / node:path / node:url）。
 * 运行：node tests/test_binding_check_shape.ts
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
function check(name, fn) {
  try {
    fn();
    console.log("✓", name);
  } catch (e) {
    fails.push(`${name}: ${e.message}`);
    console.error("✗", name, "-", e.message);
  }
}

function goModule() {
  const goMod = fs.readFileSync(path.join(ROOT, "go.mod"), "utf-8");
  const m = goMod.match(/^module\s+(\S+)/m);
  if (!m) throw new Error("go.mod 无 module 名");
  return m[1];
}

/** bindings 内部某包的落盘目录（生成物确定性命名：模块路径 + internal/app）。 */
function probeDir() {
  return path.join(ROOT, "frontend/bindings", goModule(), "internal/app");
}

function runBindingCheck() {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "binding-check.ts"), "--json"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    /* 解析失败留空，断言里自然报错 */
  }
  return { status: r.status, stdout: r.stdout, json };
}

/** 在 bindings 目录批量写探针文件，跑完必删（finally），防脏产物入库。 */
function withProbes(suffixes, fn) {
  const dir = probeDir();
  const targets = suffixes.map((s) => path.join(dir, `__binding_check_shape_probe__${s}`));
  fs.mkdirSync(dir, { recursive: true });
  for (const t of targets) fs.writeFileSync(t, "// binding-check shape probe\n");
  try {
    return fn(targets);
  } finally {
    for (const t of targets) fs.rmSync(t, { force: true });
    const left = targets.filter((t) => fs.existsSync(t));
    if (left.length) throw new Error(`探针未清理干净: ${left.map((t) => path.relative(ROOT, t)).join(", ")}`);
  }
}

check("bindings 现状干净（无 .js 产物）→ exit 0", () => {
  const r = runBindingCheck();
  if (r.status !== 0) throw new Error(`应 exit 0，实际 ${r.status}：${r.stdout.slice(0, 400)}`);
  if (!r.json || r.json._summary.issues !== 0)
    throw new Error(`应 issues 0，实际 ${r.json && r.json._summary && r.json._summary.issues}`);
});

check(".js / .mjs / .cjs 探针 → exit 1 + fatal「绑定产物混入 JS 后缀」", () => {
  const names = [".js", ".mjs", ".cjs"];
  withProbes(names, () => {
    const r = runBindingCheck();
    if (r.status !== 1) throw new Error(`应 exit 1，实际 ${r.status}`);
    const flagged = (r.json?.issues ?? []).filter((i) => /绑定产物混入 JS 后缀/.test(i.message || ""));
    if (flagged.length !== names.length)
      throw new Error(`应命中 ${names.length} 个 fatal issue，实际 ${flagged.length}`);
    for (const n of names) {
      if (!flagged.some((i) => i.message.includes(`__binding_check_shape_probe__${n}`)))
        throw new Error(`探针 ${n} 未被点名`);
    }
  });
});

check(".d.ts 探针不报（合法产物，防误伤）", () => {
  withProbes([".d.ts"], () => {
    const r = runBindingCheck();
    if (r.status !== 0) throw new Error(`.d.ts 应 exit 0，实际 ${r.status}`);
    const hit = (r.json?.issues ?? []).find((i) => /绑定产物混入 JS 后缀/.test(i.message || ""));
    if (hit) throw new Error(".d.ts 被误判为 JS 产物");
  });
});

if (fails.length) {
  console.error(`\n❌ ${fails.length} 个用例失败：`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\n✅ 全部用例通过");
