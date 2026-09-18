#!/usr/bin/env node
/**
 * 契约测试：CLI 性能命令**结构化载荷** ↔ 前端消费 契约锚定。
 *
 * 2026-09-17 改写（ADR-262 D1）：本文件此前锚定的是 **人类可读文案模板**
 * （`"[%d] %s (%.2fms)"` / `"总耗时: %.2fms"`）与前端解析这些文案的正则——
 * 即「把人类文案当 API」。单模型基准与加载链路模拟现均消费结构化 `resp.data`
 * （`--format json` + ADR-200 D5 sidecar），文本正则解析已删除，故契约改为锁
 * **JSON 字段名双端一致**，并反向断言前端**不得**再出现对阶段/总耗时的文本正则解析。
 *
 * 纯静态、读源码 + 字符串断言、零副作用、零 Go 编译，可进每次 push 门禁。
 *
 * 断言四件事：
 *  1. 性能命令（gui-flow / single-bench / perf-log / concurrent-bench / benchmark）在前端白名单内
 *  2. Go 侧 gui-flow 结构化字段名齐备，且前端 GuiFlowStage/GuiFlowStructured 同名同义
 *  3. Go 侧 single-bench 结构化字段名齐备（含 identity 身份块与基准判决），且前端载荷接口同名同义
 *  4. 前端**不得**回退到文本正则解析（防「文案当 API」范式回流）
 *  5. 基准判决字段双端锚定，且前端**真的传**基准参数（只声明接口不传参 = 功能不可达）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const errors = [];
function must(cond, msg) {
  if (!cond) errors.push(msg);
}

/** 硬性前置：文件必须存在，否则直接失败并打印可读信息。 */
function readOrDie(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    errors.push(`MISSING: ${rel}`);
    return "";
  }
  return fs.readFileSync(p, "utf8");
}

/**
 * Go 源码里是否存在指定 json tag 字段名。
 * 尾随字符必须落在 `"` / `,`（omitempty 等选项）上——避免 `json:"note"` 误命中 `json:"note_other"`。
 */
function hasJSONTag(src, name) {
  return new RegExp(`json:"${name}[,"]`).test(src);
}
/**
 * 剥离 TS 注释后再做「反回退」断言：源码注释里为了说明历史缺陷会引用旧正则/旧锚点原文，
 * 直接在全文里查子串会误伤注释（本文件自己就引用了 `/⏱️\s*总耗时.*?([\d.]+)ms/`）。
 * 断言的是**代码行为**，不是文档措辞。
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const allowlist = readOrDie("frontend/src/backend/cli-allowlist.ts");
const flowGo = readOrDie("go/cli/flow.go");
const concurrentGo = readOrDie("go/cli/bench_concurrent.go");
const identityGo = readOrDie("go/cli/perf_identity.go");
const guiTs = readOrDie("frontend/src/views/app-content/diagnostics/perf-gui-flow.ts");
const singleTs = readOrDie("frontend/src/views/app-content/diagnostics/perf-single-bench.ts");
/** 反回退断言只看**代码**：注释里为说明历史缺陷会引用旧正则/旧锚点原文 */
const singleCode = stripComments(singleTs);

// ── 1) 命令白名单契约（前端 cli-allowlist 单一事实源）────────────
const PERF_COMMANDS = ["gui-flow", "single-bench", "perf-log", "concurrent-bench", "benchmark"];
for (const cmd of PERF_COMMANDS) {
  must(
    allowlist.includes(`"${cmd}"`),
    `CLI 命令 ${cmd} 未在前端 cli-allowlist 白名单（CLI_ALLOWLIST）`,
  );
}

// ── 2) gui-flow 结构化载荷契约（Go tags ↔ 前端接口）───────────────
// Go: guiFlowStageItem / guiFlowStructured 的 json tag；前端: GuiFlowStage / GuiFlowStructured
const GUI_FIELDS = [
  '"stages"',
  '"total_ms"',
  '"failed"',
  '"kind"', // measured | estimated（ADR-262 D2）
  '"estimated_ms"',
  '"note"',
  '"runtime"', // 阶段运行归属 go|rust|wasm|js|three（ADR-262 D2）
];
for (const field of GUI_FIELDS) {
  must(
    hasJSONTag(flowGo, field.replaceAll('"', "")),
    `gui-flow 结构化载荷缺少字段 json:${field}（go/cli/flow.go）`,
  );
}
for (const field of ["total_ms", "estimated_ms", "failed", "kind", "estimated_ms", "runtime"]) {
  must(
    guiTs.includes(field),
    `前端 GuiFlowStructured/GuiFlowStage 未声明 ${field}（perf-gui-flow.ts）`,
  );
}
must(
  guiTs.includes("perf-gui-est"),
  "前端未渲染估算标记（.perf-gui-est）——估算与实测必须在展示层可区分（ADR-262 D2）",
);

// ── 3) single-bench 结构化载荷契约（含身份块）─────────────────────
// 前 9 个字段在 singleBenchJSON（bench_concurrent.go）；identity 块在 perf_identity.go。
const SB_FIELDS = [
  '"model"',
  '"iterations"',
  '"total_ms"',
  '"per_iteration_ms"', // 单次平均（与 total_ms 的累计口径分开）
  '"stages"',
  '"bottleneck"',
  '"format"',
  '"size_bytes"',
  '"identity"', // ADR-262 D2 身份块
];
for (const field of SB_FIELDS) {
  must(
    hasJSONTag(concurrentGo, field.replaceAll('"', "")),
    `single-bench 结构化载荷缺少字段 json:${field}（go/cli/bench_concurrent.go）`,
  );
}
// 阶段子结构 benchStageJSON（ADR-262 D2）：运行归属 + 样本统计（n/median_ms/p95_ms 在 benchStageStats）。
const SB_STAGE_FIELDS = ['"runtime"', '"stats"', '"n"', '"median_ms"', '"p95_ms"'];
for (const field of SB_STAGE_FIELDS) {
  must(
    hasJSONTag(concurrentGo, field.replaceAll('"', "")),
    `single-bench 阶段结构缺少字段 json:${field}（go/cli/bench_concurrent.go）`,
  );
}
for (const field of ["runtime", "stats", "median_ms", "p95_ms"]) {
  must(singleTs.includes(field), `前端 SingleBenchStage 未声明 ${field}（perf-single-bench.ts）`);
}
// 基准判决（ADR-262 D8）：判决入载荷后 GUI 才能说「哪个阶段退化、退了多少」
// （此前只在 stdout 文言与 error 字符串里 —— 背景缺陷「永远没有好还是坏的判定」）。
// 顶层 baseline 键在 bench_concurrent.go，判决结构在 bench_baseline.go。
must(
  hasJSONTag(concurrentGo, "baseline"),
  "single-bench 载荷缺少顶层 json:baseline（go/cli/bench_concurrent.go）",
);
const baselineGo = readOrDie("go/cli/bench_baseline.go");
const BL_FIELDS = [
  '"saved_to"',
  '"diff"',
  '"path"',
  '"threshold_pct"',
  '"noise_floor_ms"',
  '"verdict"',
  '"degraded"',
  '"base_ms"',
  '"now_ms"',
  '"delta_pct"',
];
for (const field of BL_FIELDS) {
  must(
    hasJSONTag(baselineGo, field.replaceAll('"', "")),
    `基准判决载荷缺少字段 json:${field}（go/cli/bench_baseline.go）`,
  );
}
for (const field of [
  "saved_to",
  "diff",
  "threshold_pct",
  "noise_floor_ms",
  "degraded",
  "base_ms",
  "now_ms",
  "delta_pct",
]) {
  must(singleTs.includes(field), `前端基准载荷接口未声明 ${field}（perf-single-bench.ts）`);
}
// GUI 必须真的能发出基准参数（只声明接口不传参 = 功能不可达，缺陷依旧）。
// ⚠️ 断言**组装点**而非字段名子串：类型声明里本来就有 `baseline?: BaselineSlot;` 与
// `"save-baseline"?: BaselineSlot;`，用 includes 匹配的话——把整个组装分支删掉，断言仍绿。
must(
  /\[\s*"save-baseline"\s*\]\s*=/.test(singleCode),
  "前端未在参数组装点写 --save-baseline（GUI 无记录基准入口，退化门禁仍然不可达）",
);
must(
  /\.baseline\s*=\s*"default"/.test(singleCode),
  '前端未在参数组装点写 --baseline = "default"（路径策略应归 Go，前端不编基准文件路径）',
);
must(
  /\.threshold\s*=/.test(singleCode),
  "前端未在参数组装点写 --threshold（退化阈值不可调 = 判据对用户不可见）",
);
const IDENTITY_FIELDS = [
  '"rtype"',
  '"rtype_source"',
  '"rtype_label"',
  '"form"',
  '"relPath"',
  '"absPath"',
];
for (const field of IDENTITY_FIELDS) {
  must(
    hasJSONTag(identityGo, field.replaceAll('"', "")),
    `身份块缺少字段 json:${field}（go/cli/perf_identity.go）`,
  );
}
for (const field of ["total_ms", "per_iteration_ms", "identity", "relPath", "rtype"]) {
  must(singleTs.includes(field), `前端 SingleBenchPayload 未声明 ${field}（perf-single-bench.ts）`);
}

// ── 4) 反回退：前端不得再用文本正则解析阶段/总耗时 ────────────────
// 范式：旧实现用 /⏱️\s*总耗时.*?([\d.]+)ms/ 解析中文文案，并把 "总计" 当解析锚点。
must(
  !singleCode.includes("总耗时"),
  "single-bench 前端出现「总耗时」文本解析痕迹——结构化出口已就位，禁止回退到文案正则（ADR-262 D1）",
);
must(
  !singleCode.includes("BENCH_TOTAL_LABEL"),
  "single-bench 前端仍存在中文标签作为解析锚点（BENCH_TOTAL_LABEL）——违反 ADR-262 D1",
);

// ── 3.5) 并发基准（ADR-262 D1/D5）：structured 出口 + GUI 消费 ────────────
// 立因：concurrent-bench 此前**只有文本**，GUI 只能正则解析中文表格（或干脆没有入口）。
const concGo = readOrDie("go/cli/bench_concurrent_json.go");
const concTs = readOrDie("frontend/src/views/app-content/diagnostics/perf-concurrent.ts");
const CONC_FIELDS = [
  '"workers"',
  '"max_models"',
  '"model_count"',
  '"models"',
  '"serial"',
  '"per_model_ms"',
  '"parallel"',
  '"speedup"',
  '"verdict"',
  '"file_read"',
  '"file_count"',
];
for (const field of CONC_FIELDS) {
  must(
    hasJSONTag(concGo, field.replaceAll('"', "")),
    `并发基准载荷缺少字段 json:${field}（go/cli/bench_concurrent_json.go）`,
  );
}
for (const field of [
  "max_models",
  "model_count",
  "per_model_ms",
  "file_read",
  "speedup",
  "verdict",
]) {
  must(concTs.includes(field), `前端并发基准接口未声明 ${field}（perf-concurrent.ts）`);
}
// 判决 token 的取值域必须两端一致：Go 给四个 token，前端只映射（不得自算阈值）
for (const token of ["excellent", "good", "fair", "none"]) {
  must(concGo.includes(`"${token}"`), `Go 判决 token 缺 ${token}（concurrentSpeedVerdict）`);
  must(concTs.includes(`"${token}"`), `前端判决映射缺 ${token}（perf-concurrent.ts）`);
}
// 组装点断言（同基准一节的教训：只查字段名子串的话，删掉组装分支断言仍绿）
must(concTs.includes('"max-models"'), "前端未把 --max-models 写进参数组装点（GUI 发不出样本上限）");
must(/format:\s*"json"/.test(concTs), "前端未在组装点写 format=json（会退化成解析人类文案）");
// 反回退：不得出现文本解析痕迹（并发基准的文本是流式报告，不是契约）
must(
  !/性能对比表|并发建议/.test(concTs),
  "并发基准前端出现文本解析痕迹——结构化出口已就位，禁止回退到文案解析（ADR-262 D1）",
);

// ── 汇总结论 ─────────────────────────────────────────────────────
if (errors.length) {
  console.error("❌ 契约测试失败（CLI 性能命令结构化载荷 ↔ 前端消费）：");
  for (const e of errors) console.error(`  - ${e}`);
  console.error(
    "  提示：契约锚点是 **JSON 字段名**（ADR-262 D1 明令禁止把人类文案当 API）；" +
      "改 Go 结构体 tag 或前端接口时必须同步本文件。",
  );
  process.exit(1);
}
console.log(
  "✅ 契约测试通过：CLI 性能命令结构化载荷字段与前端消费锚定一致（白名单 + gui-flow + single-bench + 反文本解析）",
);
process.exit(0);
