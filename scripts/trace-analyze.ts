#!/usr/bin/env node
/**
 * trace-analyze.ts — Chrome DevTools trace 性能瓶颈分析。
 *
 * 定位：前端性能诊断工具（手动按需运行：录制 DevTools trace → 分析瓶颈）。
 * 2026-09 孤儿审计确认保留：无 CI 挂载（输入是人工录制的 trace 文件，无法自动化），
 * 性能回归由 perf-gate / gui-flow-gate 承担，本脚本负责「现场诊断」环节，不属死代码。
 *
 * 设计意图：DevTools 录制的 JSON trace 动辄 10 万+ 事件，手读不现实。
 * 本工具解析 trace，输出：
 *   1. 全 trace Top N 最长事件（按 dur 排序）；
 *   2. 按 name+cat 聚合的耗时排行（定位"哪类事件"最吃时间）；
 *   3. 各线程累计 dur 饼图（定位"哪个线程"是瓶颈）；
 *   4. 指定线程（默认 CrRendererMain）的事件明细；
 *   5. Worker 线程聚合；
 *   6. 最忙时间片（事件密度热力）。
 *
 * 典型用法：
 *   node scripts/trace-analyze.ts <trace.json>                    # 默认文本报告
 *   node scripts/trace-analyze.ts <trace.json> --json             # JSON（供子代理/CI 消费）
 *   node scripts/trace-analyze.ts <trace.json> --top 50           # 加长 Top 列表
 *   node scripts/trace-analyze.ts <trace.json> --pid 39456 --tid 13360  # 指定线程明细
 *   node scripts/trace-analyze.ts <a.json> <b.json>               # 双 trace 对比模式
 *
 * 依赖：零依赖（node:fs / node:path）。
 *
 * 退出码：0 成功；缺参 / 文件不存在 / JSON 解析失败 → 2。
 */

import fs from 'node:fs';
import path from 'node:path';

// ── 参数解析 ──
const ARGS = process.argv.slice(2);
const files: string[] = [];
let jsonOut = false;
let topN = 30;
let filterPid: number | null = null;
let filterTid: number | null = null;

for (let i = 0; i < ARGS.length; i++) {
  const a = ARGS[i];
  if (a === '--json') { jsonOut = true; }
  else if (a === '--top') { topN = parseInt(ARGS[++i], 10) || 30; }
  else if (a === '--pid') { filterPid = parseInt(ARGS[++i], 10); }
  else if (a === '--tid') { filterTid = parseInt(ARGS[++i], 10); }
  else if (a === '--help' || a === '-h') {
    console.log(`用法：node scripts/trace-analyze.ts <trace.json> [trace2.json] [选项]
  --json          输出 JSON（供子代理/CI 消费）
  --top N         Top N 事件数（默认 30）
  --pid <pid>     指定线程明细的 pid
  --tid <tid>     指定线程明细的 tid
  -h, --help      帮助`);
    process.exit(0);
  }
  else if (!a.startsWith('-')) { files.push(a); }
  else { console.warn(`[trace-analyze] 忽略未知选项 "${a}"`); }
}

if (files.length === 0) {
  console.error('错误：缺少 trace 文件路径。用法：node scripts/trace-analyze.ts <trace.json>');
  process.exit(2);
}

// ── 解析 trace ──
function loadTrace(p: string) {
  const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
  if (!fs.existsSync(abs)) {
    console.error(`错误：文件不存在 — ${abs}`);
    process.exit(2);
  }
  const raw = fs.readFileSync(abs, 'utf8');
  let j;
  try { j = JSON.parse(raw); } catch (e) {
    console.error(`错误：JSON 解析失败 — ${(e as Error).message}`);
    process.exit(2);
  }
  return { meta: j.metadata || {}, evs: j.traceEvents || [], path: abs };
}

// ── 分析核心 ──
function analyze(label: string, trace: any) {
  const { evs } = trace;
  const threads = new Map();
  const procs = new Map();

  for (const e of evs) {
    if (e.ph !== 'M') continue;
    if (e.name === 'thread_name') threads.set(`${e.pid}:${e.tid}`, e.args?.name || '?');
    else if (e.name === 'process_name') procs.set(e.pid, e.args?.name || '?');
  }

  // 收集 duration 事件
  const durEvents: { name: any; cat: any; pid: any; tid: any; ts: any; dur: any; args: any }[] = [];
  const pendingB = new Map();

  for (const e of evs) {
    if (e.ph === 'X' && e.dur) {
      durEvents.push({
        name: e.name, cat: e.cat || '', pid: e.pid, tid: e.tid,
        ts: e.ts, dur: e.dur, args: e.args,
      });
    } else if (e.ph === 'B') {
      const key = `${e.pid}:${e.tid}:${e.name}:${e.cat}`;
      pendingB.set(key, { ts: e.ts, name: e.name, cat: e.cat || '', pid: e.pid, tid: e.tid, args: e.args });
    } else if (e.ph === 'E') {
      const key = `${e.pid}:${e.tid}:${e.name}:${e.cat}`;
      const b = pendingB.get(key);
      if (b) {
        durEvents.push({
          name: b.name, cat: b.cat, pid: b.pid, tid: b.tid,
          ts: b.ts, dur: e.ts - b.ts, args: b.args,
        });
        pendingB.delete(key);
      }
    }
  }

  // 时间范围
  const tsList = durEvents.map(e => e.ts).filter(t => t > 0);
  const tsMin = tsList.length ? Math.min(...tsList) : 0;
  const tsMax = tsList.length ? Math.max(...tsList) : 0;
  const spanSec = (tsMax - tsMin) / 1e6;

  // Top N 最长事件
  const top = [...durEvents].sort((a, b) => b.dur - a.dur).slice(0, topN);

  // 按 name+cat 聚合
  const byName = new Map();
  for (const e of durEvents) {
    const k = `${e.name}||${e.cat}`;
    if (!byName.has(k)) byName.set(k, { name: e.name, cat: e.cat, count: 0, totalDur: 0, maxDur: 0 });
    const a = byName.get(k);
    a.count++;
    a.totalDur += e.dur;
    a.maxDur = Math.max(a.maxDur, e.dur);
  }
  const topAgg = [...byName.values()].sort((a, b) => b.totalDur - a.totalDur).slice(0, topN);

  // 按线程聚合
  const byThread = new Map();
  for (const e of durEvents) {
    const k = `${e.pid}:${e.tid}`;
    if (!byThread.has(k)) {
      byThread.set(k, {
        pid: e.pid, tid: e.tid,
        name: threads.get(k) || '?',
        proc: procs.get(e.pid) || '?',
        totalDur: 0, count: 0,
      });
    }
    const a = byThread.get(k);
    a.totalDur += e.dur;
    a.count++;
  }
  const totalAllDur = [...byThread.values()].reduce((s, a) => s + a.totalDur, 0);
  const topThreads = [...byThread.values()]
    .map(a => ({ ...a, pct: totalAllDur ? a.totalDur / totalAllDur : 0 }))
    .sort((a, b) => b.totalDur - a.totalDur);

  // 指定线程事件明细
  const targetPid = filterPid;
  const targetTid = filterTid;
  let threadDetail: typeof durEvents | null = null;
  if (targetPid !== null && targetTid !== null) {
    threadDetail = durEvents
      .filter(e => e.pid === targetPid && e.tid === targetTid)
      .sort((a, b) => b.dur - a.dur)
      .slice(0, topN);
  }

  // Worker 线程聚合
  const workerAgg = new Map();
  for (const e of durEvents) {
    const tname = threads.get(`${e.pid}:${e.tid}`) || '';
    if (!tname.includes('Worker')) continue;
    const k = `${e.name}||${e.cat}`;
    if (!workerAgg.has(k)) workerAgg.set(k, { name: e.name, cat: e.cat, count: 0, totalDur: 0 });
    const a = workerAgg.get(k);
    a.count++;
    a.totalDur += e.dur;
  }
  const topWorkers = [...workerAgg.values()].sort((a, b) => b.totalDur - a.totalDur).slice(0, 15);

  // 最忙时间片（10ms 桶）
  const bucketMs = 10;
  const buckets = new Map();
  for (const e of durEvents) {
    if (e.dur <= 0 || e.ts < tsMin) continue;
    const bStart = Math.floor((e.ts - tsMin) / 1000 / bucketMs);
    const bEnd = Math.floor((e.ts + e.dur - tsMin) / 1000 / bucketMs);
    for (let b = bStart; b <= bEnd; b++) {
      buckets.set(b, (buckets.get(b) || 0) + 1);
    }
  }
  const topBuckets = [...buckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([b, cnt]) => ({
      startSec: (tsMin + b * bucketMs * 1000 - tsMin) / 1e6,
      endSec: (tsMin + (b + 1) * bucketMs * 1000 - tsMin) / 1e6,
      count: cnt,
    }));

  return {
    label,
    file: trace.path,
    startTime: trace.meta.startTime,
    eventCount: evs.length,
    durEventCount: durEvents.length,
    totalDurSec: durEvents.reduce((s, e) => s + e.dur, 0) / 1e6,
    spanSec,
    topEvents: top,
    byName: topAgg,
    byThread: topThreads,
    threadDetail,
    workerAgg: topWorkers,
    hotBuckets: topBuckets,
  };
}

// ── 文本报告 ──
function fmtTime(us: number) {
  if (us >= 1e6) return `${(us / 1e6).toFixed(3)}s`;
  if (us >= 1e3) return `${(us / 1e3).toFixed(2)}ms`;
  return `${us.toFixed(0)}µs`;
}

function printReport(r: any) {
  const lines: string[] = [];
  lines.push('');
  lines.push('='.repeat(70));
  lines.push(`  ${r.label}`);
  lines.push(`  file=${path.basename(r.file)}  start=${r.startTime || '?'}`);
  lines.push(`  events=${r.eventCount}  durEvents=${r.durEventCount}  span=${r.spanSec.toFixed(3)}s  totalDur=${r.totalDurSec.toFixed(3)}s`);
  lines.push('='.repeat(70));

  // Top 事件
  lines.push('');
  lines.push(`── Top ${r.topEvents.length} 最长事件 ──`);
  lines.push(`${'dur'.padEnd(12)} ${'name'.padEnd(40)} ${'cat'.padEnd(25)} ${'pid'.padEnd(6)} thread`);
  for (const e of r.topEvents) {
    const tname = r.byThread.find((t: any) => t.pid === e.pid && t.tid === e.tid)?.name || '?';
    lines.push(`${fmtTime(e.dur).padEnd(12)} ${e.name.slice(0, 40).padEnd(40)} ${(e.cat||'').slice(0,25).padEnd(25)} ${String(e.pid).padEnd(6)} ${tname}`);
  }

  // 聚合
  lines.push('');
  lines.push(`── 按 name+cat 聚合 Top ${r.byName.length} ──`);
  lines.push(`${'总dur'.padEnd(12)} ${'次数'.padEnd(6)} ${'单次max'.padEnd(12)} ${'name'.padEnd(40)} cat`);
  for (const a of r.byName) {
    lines.push(`${fmtTime(a.totalDur).padEnd(12)} ${String(a.count).padEnd(6)} ${fmtTime(a.maxDur).padEnd(12)} ${a.name.slice(0,40).padEnd(40)} ${(a.cat||'').slice(0,30)}`);
  }

  // 线程饼图
  lines.push('');
  lines.push('── 各线程累计 dur（近似 CPU 时间饼图） ──');
  lines.push(`${'占比'.padEnd(7)} ${'总dur'.padEnd(12)} ${'次数'.padEnd(6)} pid:tid  线程名`);
  for (const a of r.byThread) {
    const bar = '█'.repeat(Math.round(a.pct * 40));
    lines.push(`${((a.pct*100).toFixed(1)+'%').padEnd(7)} ${fmtTime(a.totalDur).padEnd(12)} ${String(a.count).padEnd(6)} ${a.pid}:${a.tid}  ${a.name}  ${bar}`);
  }

  // 指定线程明细
  if (r.threadDetail) {
    lines.push('');
    lines.push(`── 线程 ${r.threadDetail[0]?.pid}:${r.threadDetail[0]?.tid} 最长事件 Top ${r.threadDetail.length} ──`);
    lines.push(`${'dur'.padEnd(12)} name  cat`);
    for (const e of r.threadDetail) {
      lines.push(`${fmtTime(e.dur).padEnd(12)} ${e.name.slice(0, 60)}  ${(e.cat||'').slice(0,30)}`);
    }
  }

  // Worker
  if (r.workerAgg.length) {
    lines.push('');
    lines.push(`── Worker 线程聚合 Top ${r.workerAgg.length} ──`);
    lines.push(`${'总dur'.padEnd(12)} ${'次数'.padEnd(6)} name`);
    for (const a of r.workerAgg) {
      lines.push(`${fmtTime(a.totalDur).padEnd(12)} ${String(a.count).padEnd(6)} ${a.name.slice(0, 60)}  ${(a.cat||'').slice(0,25)}`);
    }
  }

  // 热力
  if (r.hotBuckets.length) {
    lines.push('');
    lines.push('── 最忙 10ms 时间片 Top 10（事件密度） ──');
    for (const b of r.hotBuckets) {
      lines.push(`  +${b.startSec.toFixed(3)}s ~ +${b.endSec.toFixed(3)}s  覆盖事件数: ${b.count}`);
    }
  }

  return lines.join('\n');
}

// ── 主流程 ──
if (files.length === 2) {
  // 双 trace 对比模式
  const a = analyze('Trace A', loadTrace(files[0]));
  const b = analyze('Trace B', loadTrace(files[1]));
  if (jsonOut) {
    console.log(JSON.stringify({ a, b }, null, 2));
  } else {
    console.log(printReport(a));
    console.log(printReport(b));
    // 差异摘要
    console.log('');
    console.log('='.repeat(70));
    console.log('  A vs B 差异摘要');
    console.log('='.repeat(70));
    console.log(`  A span=${a.spanSec.toFixed(3)}s  B span=${b.spanSec.toFixed(3)}s`);
    console.log(`  A totalDur=${a.totalDurSec.toFixed(3)}s  B totalDur=${b.totalDurSec.toFixed(3)}s`);
    // 线程占比差异
    const aMain = a.byThread[0];
    const bMain = b.byThread[0];
    if (aMain && bMain) {
      console.log(`  主线程占比: A=${(aMain.pct*100).toFixed(1)}%  B=${(bMain.pct*100).toFixed(1)}%`);
    }
  }
} else {
  const r = analyze('Trace', loadTrace(files[0]));
  if (jsonOut) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log(printReport(r));
  }
}

process.exit(0);
