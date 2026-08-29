#!/usr/bin/env node
/**
 * gui-flow-gate.mjs — 独立性能集成门禁（B-1「真跑」层）。
 *
 * 补充说明（与静态契约对比）：
 *  - tests/test_cli_gui_flow_contract.mjs 只做「格式/白名单静态契约」，快速、进每次 push 门禁；
 *  - 本脚本**真跑** go/cli 的 gui-flow，验证后端加载链健康（配置→扫描→分析→缓存→数据→渲染预估），
 *    是「CLI 作为 GUI 无头验证替身」的核心体现——CLI 跑通 ≈ Go 后端加载链 OK。
 *
 * ⚠️ 副作用须知：
 *   go/cli/registry.go DispatchCommand 在 files-root 非空时会调 saveConfigFn 落盘用户配置
 *   （APPDATA/ysm_config.json，写入该 files-root 为默认仓库）。**推荐在 CI/无真实用户环境执行**；
 *   本地执行会改写本机用户默认仓库路径，跑完如需还原请另存原配置。gui-flow 各阶段本身只读，无其他副作用。
 *
 * 用法：
 *   node scripts/gui-flow-gate.mjs                      # 默认 files-root=tests/fixtures/ysm/01_taisho_maid
 *   node scripts/gui-flow-gate.mjs --files-root <dir>   # 指定模型仓库
 *   node scripts/gui-flow-gate.mjs --threshold-ms 30000 # 收紧总耗时阈值
 *   node scripts/gui-flow-gate.mjs --model <path>       # 指定要分析的模型（默认自动选第一个）
 *   node scripts/gui-flow-gate.mjs --verbose            # 打印原始输出与解析明细
 * 退出码：0=通过，1=失败。
 * 依赖：node:child_process / node:path / scripts/_lib/scan-files.mjs（零外部依赖）。
 * 设计意图：把 CLI 当 GUI 的「无头验证替身」——真跑 gui-flow 验证 Go 后端加载链健康
 *           （配置→扫描→分析→缓存→数据→渲染预估）。与 tests/test_cli_gui_flow_contract.mjs
 *           的静态契约互补：静态层进每次 push 门禁，本门禁做真跑集成验证，CI/手动可选触发。
 */
import path from 'node:path';
import { getRoot } from './_lib/scan-files.mjs';
import { parseArgs } from './_lib/parse-args.mjs';
import { run } from './_lib/proc.mjs';

const ROOT = getRoot();

// ── 参数解析（共享层 _lib/parse-args.mjs）────────────────────────
// 原内联解析的未知参数 exit 2 语义由 unknown 白名单拦截保留；
// thresholdMs 原为 parseInt 数字，这里显式 Number() 还原。
const parsed = parseArgs(process.argv.slice(2), {
  bools: ['verbose', 'require-model'],
  strings: ['files-root', 'model', 'threshold-ms'],
  defaults: {
    'files-root': path.join('tests', 'fixtures', 'ysm', '01_taisho_maid'),
    model: '',
    'threshold-ms': '60000',
  },
});
if (parsed.unknown.length) {
  console.error(`[FAIL] 未知参数: ${parsed.unknown.join(' ')}`);
  process.exit(2);
}
const opts = {
  filesRoot: parsed['files-root'],
  model: parsed.model,
  thresholdMs: Number(parsed['threshold-ms']),
  verbose: parsed.verbose,
  requireModel: parsed['require-model'],
};

const FILES_ROOT = path.resolve(ROOT, opts.filesRoot);

let raw = '';
const args = ['run', '.', '--cli', '--files-root', FILES_ROOT, 'gui-flow', '--json'];
if (opts.model) args.push('--model', opts.model);
const gr = run('go', args, { cwd: ROOT, timeout: 120000, mergeStderr: false });
// 退出码非 0：程序自身 JSON 响应在 out（stdout 被捕获而非丢失），stderr 多为 watcher/编译噪音
// mergeStderr:false 保证失败时 out 仍仅 stdout，JSON 不被噪音污染（code review P2）
// 不能直接失败——gui-flow 有阶段失败时 Go 返回 status:error + exit 1，JSON 仍可解析定位失败阶段
raw = gr.out.trim();

if (!raw) {
  console.error('[FAIL] gui-flow 无 stdout 输出（go run 编译/运行失败），请查看上方 go 的错误输出');
  process.exit(1);
}
if (opts.verbose) console.log('--- 原始 JSON stdout ---\n' + raw);

/** 从 stdout 提取 JSON（跨运行：若 stdout 混入非 JSON 行则取首个 {...} 对象） */
function extractJson(s) {
  for (const line of s.split('\n').reverse()) {
    const t = line.trim();
    if (t.startsWith('{')) { try { return JSON.parse(t); } catch { /* 继续 */ } }
  }
  try { return JSON.parse(s); } catch { return null; }
}
const resp = extractJson(raw);
if (!resp) {
  console.error('[FAIL] 无法解析 gui-flow --json 响应');
  process.exit(1);
}

const out = resp?.data?.output || '';
const lines = out.split('\n');

// 阶段行：✅ [n] 名称 (x.xxms)（对齐 Go printFlowReport）
const stageRe = /^([✅❌])\s*\[\d+\]\s*(.+?)\s*\(([\d.]+)ms\)$/;
const totalRe = /⏱️\s*总耗时:\s*([\d.]+)ms/;

const seen = new Map(); // name → {ok, ms}
let failedLine = '';
for (const l of lines) {
  const m = l.trim().match(stageRe);
  if (m) {
    seen.set(m[2].trim(), { ok: m[1] === '✅', ms: parseFloat(m[3]) });
    if (m[1] === '❌' && !failedLine) failedLine = l.trim();
  }
}
const totalMatch = lines.map((l) => l.trim()).find((l) => totalRe.test(l));
const totalMs = totalMatch ? parseFloat(totalMatch.match(totalRe)[1]) : null;

if (opts.verbose) {
  console.log('--- 解析的阶段 ---');
  for (const [name, v] of seen) console.log(`  ${v.ok ? '✅' : '❌'} ${name} ${v.ms.toFixed(2)}ms`);
  console.log(`  总耗时: ${totalMs ?? 'N/A'}ms`);
}

// ── 必绿阶段：配置加载 + 模型扫描（IO 链路健康，任何输入都须通过） ──
const boom = [];
for (const name of ['① 配置加载', '② 模型扫描']) {
  const v = seen.get(name);
  if (!v) boom.push(`缺少必绿阶段「${name}」`);
  else if (!v.ok) boom.push(`必绿阶段「${name}」失败: ${failedLine}`);
}

// 判定是否有「可分析模型输入」：从 ② 扫描描述提取 YAML/YSM 计数。
// scanner 把「模型清单/每模型子目录」识别为模型入口；目录顶层无 .ysm/.yml/ysm.json 入口时
// YAML/YSM 为 0（测试 fixtures 即此布局）→ 属「无模型输入」，gui-flow ③ 自动选模型失败。
const scanStats = (out.match(/YAML:\s*\d+\.?\d*\s*,\s*YSM:\s*\d+/) || [''])[0];
let hasModel = false;
if (scanStats) {
  const yamlCount = parseInt(scanStats.match(/YAML:\s*(\d+)/)[1], 10);
  const ysmCount = parseInt(scanStats.match(/YSM:\s*(\d+)/)[1], 10);
  hasModel = yamlCount > 0 || ysmCount > 0;
}

if (hasModel || opts.requireModel) {
  // 有模型（或强校验）：③ 及后续阶段 + 总耗时阈值 = B-1 完整加载链验证
  const modelStage = seen.get('③ 模型分析');
  if (!modelStage) boom.push(`缺少关键阶段「③ 模型分析」（有模型输入却未生成）`);
  else if (!modelStage.ok) boom.push(`关键阶段「③ 模型分析」失败: ${failedLine}`);
  for (const name of ['④ 纹理缓存', '⑤ 数据准备']) {
    const v = seen.get(name);
    if (!v) boom.push(`缺少阶段「${name}」`);
  }
  if (totalMs !== null && opts.thresholdMs && totalMs > Number(opts.thresholdMs)) {
    boom.push(`总耗时 ${totalMs.toFixed(0)}ms 超过阈值 ${opts.thresholdMs}ms`);
  }
} else {
  const modelStage = seen.get('③ 模型分析');
  const note = modelStage
    ? `③ 已生成（${modelStage.ok ? '成功' : '失败：' + failedLine}）`
    : '③ 未生成';
  console.log(`[提示] 未检测到可分析模型输入（YAML/YSM 计数为 0）——跳过 ③ 分析/后续阶段与总耗时的强验证，${note}`);
  console.log('        如需完整验证加载链，请传入含真实模型清单的 --files-root 并加 --require-model');
}

if (boom.length) {
  console.error(`❌ gui-flow-gate 失败（files-root=${opts.filesRoot}）：`);
  for (const e of boom) console.error(`  - ${e}`);
  process.exit(1);
}
const mode = hasModel || opts.requireModel ? '完整加载链验证' : '基础链路（无模型输入，降级）';
console.log(
  `✅ gui-flow-gate 通过（${mode}）：${seen.size} 个阶段，总耗时 ${totalMs?.toFixed(0) ?? 'N/A'}ms，必绿阶段（配置+扫描）全绿`,
);
process.exit(0);