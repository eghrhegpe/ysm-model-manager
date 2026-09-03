#!/usr/bin/env node
/**
 * 契约测试：event-graph.mjs（Bus 事件契约守卫）。
 *
 * 背景：bus.ts 的 BusEvents 类型表只对 .ts 调用方生效；frontend/*.html 内联脚本经
 * window.bus 绕过全部类型检查。历史实证漂移：index.html 内联 `emit("nav:change")`
 * 全项目无监听、`loading:*` 幽灵监听——旧版扫描正则被可选链 `?.` 致盲长期漏检。
 * 本测试锁定守卫行为：
 *   1. 未知事件名（.ts 与 html 内联）必须报 undeclared；
 *   2. 非 void 事件 emit 缺第二参数必须报 missing_payload；
 *   3. void 事件 emit 多传 payload 报 void_with_payload；
 *   4. VOID_EVENTS 清单与 `: void` 标记漂移必须报 voidDrift；
 *   5. 注释里的调用不误报；可选链调用不漏报；
 *   6. 真实仓库当前零硬错误。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = path.join(ROOT, 'scripts', 'event-graph.ts');

let failed = 0;
const ok = (cond, msg) => {
  if (cond) console.log(`  OK: ${msg}`);
  else { failed++; console.error(`  FAIL: ${msg}`); }
};

/** 在临时目录搭 fixture 并以 --strict --json 跑守卫 */
function runOnFixture(files) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'event-graph-'));
  const fe = path.join(tmp, 'frontend');
  fs.mkdirSync(path.join(fe, 'src'), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const fp = path.join(fe, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content);
  }
  const r = spawnSync(process.execPath, [GUARD, '--root', tmp, '--strict', '--json'], { encoding: 'utf-8' });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* stderr 携带失败信息 */ }
  return { status: r.status, json, err: r.stderr };
}

const BUS_TS = `export interface BusEvents {
  "a:void-event": void;
  "b:typed": { x: string };
}
const VOID_EVENTS = ["a:void-event"] as const;
`;

// ── 1. fixture：各类违例与正确用法 ────────────────────────
console.log('[1] fixture 违例检测');
{
  const { status, json, err } = runOnFixture({
    'src/bus.ts': BUS_TS,
    'src/views/widget.ts': [
      `import { bus } from "../bus.ts";`,
      `bus.emit("b:typed"); // 非 void 缺 payload`,
      `window.bus?.emit("c:unknown", {}); // 可选链 + 未知事件`,
      `bus.emit("a:void-event", { extra: 1 }); // void 多传`,
      `bus.on("zzz", () => {}); // on 侧未知事件`,
      `bus.emit("b:typed", { x: "ok" });`,
      `bus.emit("a:void-event");`,
      `// bus.emit("ghost", {}); 注释不报`,
    ].join('\n'),
    'index.html': [
      `<html><body>`,
      `<script src="src/app-modules.ts"></script>`,
      `<script>window.bus?.emit("b:typed");</script>`, // html 盲区缺参（可选链）
      `<script>window.bus?.on("b:typed", () => {});</script>`, // 合法
      `</body></html>`,
    ].join('\n'),
  });
  ok(status === 1 && json !== null, `--strict 下违例阻断且输出 JSON（exit=${status}）${json ? '' : ' stderr=' + err.slice(0, 200)}`);
  const s = json?._summary ?? {};
  const arityType = (t, ev) => (s.arityIssues ?? []).some((a) => a.type === t && a.event === ev);
  ok((s.undeclared ?? []).includes('c:unknown'), '可选链 emit 未知事件名 → undeclared');
  ok((s.undeclared ?? []).includes('zzz'), 'on 侧未知事件名 → undeclared');
  ok(arityType('missing_payload', 'b:typed'), 'ts 非 void emit 缺参 → missing_payload');
  ok(arityType('void_with_payload', 'a:void-event'), 'void 事件多传 payload');
  ok((s.arityIssues ?? []).some((a) => a.type === 'missing_payload' && a.file.includes('index.html')), 'html 内联可选链缺参也被抓');
  ok(!(s.undeclared ?? []).includes('ghost') && !(s.arityIssues ?? []).some((a) => a.event === 'ghost'), '注释内调用不误报');
}

// ── 1b. 跨行调用点发现 ───────────────────────────────────
// 历史盲区：CALL_PARENT_RE 不允许尾随 `(`，`bus.on(` 换行写事件名的跨行订阅恒漏检
// （实证：sync.ts 的 sync:download:missing 被误报孤儿发射）。跨行 emit 同理使缺参检查失明。
console.log('[1b] 跨行 on / 跨行 emit');
{
  const { status, json } = runOnFixture({
    'src/bus.ts': BUS_TS,
    'src/views/sync.ts': [
      `import { bus } from "../bus.ts";`,
      `const unsubs = [`,
      `  bus.on(`,
      `    "a:void-event",`,
      `    () => {},`,
      `  ),`,
      `];`,
      `bus.emit(`,
      `  "b:typed",`,
      `); // 跨行非 void 缺 payload`,
      `bus.emit(`,
      `  "a:void-event",`,
      `  { extra: 1 },`,
      `); // 跨行 void 多传`,
    ].join('\n'),
  });
  const s = json?._summary ?? {};
  ok((json?.events?.['a:void-event']?.on?.length ?? 0) === 1,
    '跨行 bus.on( 订阅被记录（不再误报孤儿发射）');
  ok(status === 1 && (s.arityIssues ?? []).some((a) => a.type === 'missing_payload' && a.event === 'b:typed'),
    '跨行 emit 缺参 → missing_payload');
  ok((s.arityIssues ?? []).some((a) => a.type === 'void_with_payload' && a.event === 'a:void-event'),
    '跨行 void 多传 → void_with_payload');
}

// ── 1c. 实参段中的正则字面量 ──────────────────────────────
// 历史盲区：回调体 .replace(/"/g, ...) 的裸引号被 extractArgs 误当字符串边界，
// 括号配对失衡 → 整条订阅丢失（实证：init-pages.ts 的 package:selected）。
console.log('[1c] 正则字面量不干扰实参提取');
{
  const { json } = runOnFixture({
    'src/bus.ts': BUS_TS,
    'src/views/pkg.ts': [
      `import { bus } from "../bus.ts";`,
      `bus.on("b:typed", (pkg) => {`,
      `  el.innerHTML = '<div a="' + String(pkg.x).replace(/"/g, "&quot;") + '">';`,
      `});`,
    ].join('\n'),
  });
  ok((json?.events?.['b:typed']?.on?.length ?? 0) === 1,
    '回调体含正则字面量的订阅仍被记录');
}

// ── 2. VOID_EVENTS 清单与 BusEvents void 标记漂移 ─────────
console.log('[2] VOID_EVENTS 漂移检测');
{
  const { status, json } = runOnFixture({
    'src/bus.ts': BUS_TS.replace('["a:void-event"]', '[]'),
    'src/views/x.ts': '',
  });
  ok(status === 1 && (json?._summary?.voidDrift ?? []).some((v) => v.event === 'a:void-event'),
    'VOID_EVENTS 漏登记 → voidDrift 且 strict 阻断');
}

// ── 2b. 调用点所属函数（fn）提取 ─────────────────────────
// 2026-09-03 增强：调用详情表/JSON 记录带所属函数名（事件图定位可读性）。
// 覆盖：function 声明 / 方法简写 / 箭头赋值 / 匿名回调向上取最近具名宿主 /
//       嵌套具名函数防误报 / 模块顶层 / 字符串内花括号免疫。
console.log('[2b] fn 所属函数提取');
{
  const { json } = runOnFixture({
    'src/bus.ts': BUS_TS,
    'src/views/fn.ts': [
      `import { bus } from "../bus.ts";`,
      `function topLevel() { bus.emit("b:typed", { x: "a" }); }`,
      `const obj = { method(): void { bus.on("a:void-event", () => {}); } };`,
      `function ctrl() {`,
      `  if (isViewerMode()) { bus.emit("a:void-event"); }`, // 控制流块头不得误取名 if
      `  try { pump(); } catch (e) { bus.emit("a:void-event"); }`, // catch 块头不得误取名 catch
      `}`,
      `async function hdl({ a, b }: SyncPayload, cb: () => void): Promise<void> {`, // 解构参数 } 不截断回卷
      `  if (flag.busy) { bus.emit("a:void-event"); }`,
      `}`,
      `function outer() {`,
      `  const inner = () => { bus.emit("a:void-event"); };`,
      `  function nested() { noop(); } bus.emit("b:typed", { x: "n" });`,
      `}`,
      `const s = "} { 假括号"; // 字符串花括号不得干扰`,
      `bus.on("b:typed", (p) => {}); // 模块顶层订阅`,
    ].join('\n'),
  });
  const ev = json?.events ?? {};
  const fnOf = (recs) => recs?.[0]?.fn;
  ok(fnOf(ev['b:typed']?.emit) === 'topLevel', `function 声明内 emit → fn=topLevel（实为 ${fnOf(ev['b:typed']?.emit)}）`);
  ok(fnOf(ev['a:void-event']?.on) === 'method', `方法简写内 on → fn=method（实为 ${fnOf(ev['a:void-event']?.on)}）`);
  ok((ev['a:void-event']?.emit ?? []).some((r) => r.fn === 'inner'), '箭头赋值内 emit → fn=inner');
  ok((ev['b:typed']?.emit ?? []).some((r) => r.fn === 'outer'), '嵌套具名函数不误报（应归 outer 而非 nested）');
  ok((ev['a:void-event']?.emit ?? []).filter((r) => r.fn === 'ctrl').length === 2, 'if/catch 控制流块内调用归外层 ctrl 而非 if/catch 关键字');
  ok((ev['a:void-event']?.emit ?? []).some((r) => r.fn === 'hdl'), '解构参数跨行函数头内调用归 hdl（解构 } 不截断回卷）');
  ok((ev['b:typed']?.on ?? []).some((r) => r.fn === '(顶层)'), '模块顶层调用 → fn=(顶层)');
}

// ── 3. 真实仓库零硬错误 ──────────────────────────────────
console.log('[3] 真实仓库');
{
  const r = spawnSync(process.execPath, [GUARD, '--strict', '--json'], { encoding: 'utf-8', cwd: ROOT });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* ignore */ }
  const s = json?._summary ?? {};
  const clean = r.status === 0
    && (s.undeclared ?? []).length === 0
    && (s.arityIssues ?? []).length === 0
    && (s.voidDrift ?? []).length === 0;
  ok(clean, `零硬错误（exit=${r.status}）${clean ? '' : '\n    ' + JSON.stringify({ u: s.undeclared, a: s.arityIssues, v: s.voidDrift }).slice(0, 400)}`);
}

if (failed) {
  console.error(`\nFAILED: ${failed} assertion(s)`);
  process.exit(1);
}
console.log('\nOK: bus contract guard passed');
