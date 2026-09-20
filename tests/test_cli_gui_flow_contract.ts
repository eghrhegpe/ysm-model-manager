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
 *  2. Go 侧 gui-flow 结构化字段名齐备（前端消费已退役，只钉 Go 载荷形状）
 *  3. Go 侧 single-bench 结构化字段名齐备（含 identity 身份块与基准判决），且前端载荷接口同名同义
 *  4. 前端**不得**回退到文本正则解析（防「文案当 API」范式回流）
 *  5. 基准判决字段双端锚定，且前端**真的传**基准参数（只声明接口不传参 = 功能不可达）
 *  6. 目标集三旋钮（ADR-262 D3 修订：`--target` × `--order` × `--max-models`）双端锚定：
 *     selector/order 取值域 + 载荷字段 + 「排序依据必须可见」（size_source / footprint_bytes），
 *     并**反向断言**旧契约（all_types / top_largest / syncPerfCountLabel）已消失——残留即回归
 *  7. 扫描引擎对照（scan-bench，ADR-262 D3）：载荷字段名 + 4 个「未参与原因」token 双端锚定，
 *     且前端**以 used 为渲染分叉依据**（未采集不得渲染成 0.00ms）
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
// perf-gui-flow.ts 已随 gui-flow 面板下线（a1e26419d，ADR-278：UI 层拆除、Go 命令保留）；
// 前端消费契约退役，Go 侧载荷字段（GUI_FIELDS 上方）继续钉住 CLI 形状。
const singleTs = readOrDie("frontend/src/views/app-content/diagnostics/perf-single-bench.ts");
/** 反回退断言只看**代码**：注释里为说明历史缺陷会引用旧正则/旧锚点原文 */
const singleCode = stripComments(singleTs);

// ── 1) 命令白名单契约（前端 cli-allowlist 单一事实源）────────────
const PERF_COMMANDS = [
  "gui-flow",
  "single-bench",
  "perf-log",
  "concurrent-bench",
  "scan-bench",
  "benchmark",
];
for (const cmd of PERF_COMMANDS) {
  must(
    allowlist.includes(`"${cmd}"`),
    `CLI 命令 ${cmd} 未在前端 cli-allowlist 白名单（CLI_ALLOWLIST）`,
  );
}

// ── 2) gui-flow 结构化载荷契约（只钉 Go json tag 形状）───────────────
// Go: guiFlowStageItem / guiFlowStructured 的 json tag。前端消费已随 gui-flow 面板
// 下线退役（a1e26419d），无前端 GuiFlowStage 接口可对齐；载荷供 CLI 终端 / gui-flow-gate。
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
// 三旋钮在并发载荷里是**顶层字段**（该载荷无 spec 包装）：Go tag 与前端读取位置双向锚定。
// 「扁平 → spec 包装」是最容易被顺手统一掉的东西，而统一它必须同时改两端契约，故钉住。
for (const field of ["target", "order", "size_source", "rtype"]) {
  must(
    hasJSONTag(concGo, field),
    `并发基准载荷缺少顶层 json:${field}（三旋钮回显 / 请求类型，见 bench_concurrent_json.go）`,
  );
  must(
    stripComments(concTs).includes(`payload.${field}`),
    `并发基准前端未消费顶层 ${field}（perf-concurrent.ts）`,
  );
}
must(
  !stripComments(concTs).includes("payload.spec"),
  "并发基准前端不得读 payload.spec（该载荷是扁平的，没有 spec 包装）",
);
// rtype 回显的必须是**请求事实**（Go 顶层），不许从入选样本 `models[0].rtype` 反推：
// 空集时推不出来，且类型判定的事实源只有 Go / `resource_types.json` 单点。
must(
  !stripComments(concTs).includes("[0]?.rtype"),
  "并发基准前端不得从 models[0].rtype 反推目标类型（前端不臆断类型）",
);
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

// ── 3.6) D-7：基准不可用要给结构化原因，且每个 token 都有三语 i18n 落点 ──────────
// 立因：这些原因此前只以中文散文出现在 error 串里（含本机绝对路径与 --save-baseline 口令），
// GUI 原样上屏 → 英文/日文界面冒出未翻译中文 + 泄露用户机器路径。
for (const field of ['"error"', '"detail"']) {
  must(
    hasJSONTag(baselineGo, field.replaceAll('"', "")),
    `基准块缺少字段 json:${field}（go/cli/bench_baseline.go）`,
  );
}
const BASELINE_ERR_TOKENS = ["missing", "unreadable", "invalid", "slot_unavailable"];
const BASELINE_ERR_I18N_KEYS = [
  "perfBaselineErrMissing",
  "perfBaselineErrSavedNote",
  "perfBaselineErrUnreadable",
  "perfBaselineErrInvalid",
  "perfBaselineErrSlotUnavailable",
  "perfBaselineErrUnknown",
];
for (const token of BASELINE_ERR_TOKENS) {
  must(baselineGo.includes(`"${token}"`), `Go 基准不可用 token 缺 ${token}（bench_baseline.go）`);
  must(singleTs.includes(token), `前端基准不可用映射缺 ${token}（perf-single-bench.ts）`);
}
for (const key of BASELINE_ERR_I18N_KEYS) {
  // 三语都要有：漏一个语种就回落到「显示 key 名」或未翻译中文
  for (const lang of ["zh-CN", "en", "ja"]) {
    must(
      readOrDie(`frontend/src/locales/${lang}.ts`).includes(`"diagnostics.${key}"`),
      `基准不可用文案缺 ${lang} 落点（diagnostics.${key}）`,
    );
  }
  must(
    singleTs.includes(`diagnostics.${key}`),
    `基准不可用文案 ${key} 未在 perf-single-bench.ts 的映射里使用（加了键却没接线）`,
  );
}

// ── 3.7) 目标集三旋钮（ADR-262 D3 修订）：selector × order × 取样上限 ──────────
// 立因：旧面把「选谁 / 排序 / 取几条」三个**正交维度**压进 4 个互斥 flag，代价最终由界面支付——
// 一个数字控件承载两种含义（每类上限 / 前 N 大），标签只能跟着模式改义（`syncPerfCountLabel` 即该账单）。
// 修订后跨命令同名同义，故本节锚在**新** tag 上，并反向断言旧 tag / 旧函数**已不存在**。
const matrixTs = readOrDie("frontend/src/views/app-content/diagnostics/perf-matrix-render.ts");
const matrixCode = stripComments(matrixTs);
const targetsGo = readOrDie("go/cli/perf_targets.go");
const targetSetGo = readOrDie("go/cli/perf_target_set.go");
const perfTplTs = readOrDie("frontend/src/views/app-content/tpl.ts");
must(
  targetsGo.includes('perfSizeSourceDirTotal = "dir_total"'),
  '体量口径 token 常量失守（go/cli/perf_targets.go 的 perfSizeSourceDirTotal 应为 "dir_total"）',
);
// selector / order 的**取值域**是 Go 单点事实源：前端哨兵与 i18n 都靠它对齐
const TARGET_ORDER_CONSTS = {
  perfTargetModel: "model",
  perfTargetRtype: "rtype",
  perfTargetAll: "all",
  perfTargetRepo: "repo",
  perfOrderPath: "path",
  perfOrderSize: "size",
};
for (const [constName, value] of Object.entries(TARGET_ORDER_CONSTS)) {
  must(
    targetSetGo.includes(`${constName} = "${value}"`),
    `目标集取值域失守（go/cli/perf_target_set.go 的 ${constName} 应为 "${value}"）`,
  );
}
for (const field of ["target", "order", "size_source", "max_models"]) {
  must(
    hasJSONTag(concurrentGo, field),
    `目标集载荷缺少 spec 字段 json:${field}（go/cli/bench_concurrent.go 的 perfMatrixSpec）`,
  );
}
for (const field of ["target", "order", "size_source"]) {
  must(
    matrixCode.includes(field),
    `前端 PerfMatrixSpec 未声明或未消费 ${field}（perf-matrix-render.ts）`,
  );
}
must(
  hasJSONTag(concurrentGo, "footprint_bytes"),
  "载荷缺少 models[].footprint_bytes（目录式模型 size_bytes 恒 0，无它则 order=size 的排名依据不可见）",
);
must(
  matrixCode.includes("footprint_bytes"),
  "前端 PerfMatrixModel 未声明或未渲染 footprint_bytes（perf-matrix-render.ts）",
);
must(
  matrixCode.includes("dir_total"),
  "前端未把体量口径 token dir_total 映射成可读人话（口径不可读 = 不可复核）",
);
// 旧契约残留即回归：两个字段已删、两个 flag 不得再出现在组装点、改义函数必须消失
for (const dead of ["all_types", "top_largest"]) {
  must(
    !hasJSONTag(concurrentGo, dead),
    `载荷仍带已废弃字段 json:${dead}（旧目标集契约残留即回归，ADR-262 D3 修订）`,
  );
  must(!matrixCode.includes(dead), `前端仍声明已废弃字段 ${dead}（perf-matrix-render.ts）`);
}
for (const dead of ['"all-types"', '"top-largest"']) {
  must(!singleCode.includes(dead), `前端仍组装已废弃参数 ${dead}（perf-single-bench.ts）`);
}
must(
  !singleCode.includes("syncPerfCountLabel"),
  "前端仍存在 syncPerfCountLabel（标签随模式改义 = 一个控件两种含义，ADR-262 D3 修订已废）",
);
// 组装点断言（同基准/并发两节的教训：只查字段名子串的话，删掉组装分支断言仍绿）
must(
  /target:\s*mode\.kind/.test(singleCode),
  "前端未在参数组装点写 --target（GUI 发不出目标集 selector）",
);
must(
  /order:\s*mode\.order/.test(singleCode),
  "前端未在参数组装点写 --order（排序不可提交 = 不可复核）",
);
must(
  /"max-models":\s*mode\.maxModels/.test(singleCode),
  "前端未在参数组装点写 --max-models（GUI 发不出取样上限）",
);
must(
  /target:\s*choice\.target/.test(concTs),
  "并发基准未在组装点写 --target（两 tab 必须同一套目标集面）",
);
must(/order:\s*readPerfOrder/.test(concTs), "并发基准未在组装点写 --order");
must(
  concTs.includes("populatePerfTargetOptions"),
  "并发基准未复用同一套目标集填充函数（写第二份 ⇒ 两 tab 的目标集面必然漂移）",
);
const TARGET_SET_I18N_KEYS = [
  "perfTarget",
  "perfTargetModel",
  "perfTargetAll",
  // 「全部类型」哨兵覆盖的类型集 > 选择器列出的选项（后者已按 cliAnalyzable 过滤）——
  // 这条 hint 是那层差的唯一出口，必须三语齐备且被 perf-matrix-render 引用
  "perfTargetAllHint",
  "perfTargetRepo",
  "perfTargetRepoHint",
  "perfTargetNameRtype",
  "perfTargetSetEcho",
  "perfOrder",
  "perfOrderPath",
  "perfOrderSize",
  "perfMaxModels",
  "perfMaxModelsHint",
  "perfSizeSourceSuffix",
  "perfSizeSourceDirTotal",
  "perfSizeSourceUnknown",
  "perfModelFootprintHint",
];
// 引用侧三处：矩阵渲染 / 模板（排序选项与两个控制条）/ 并发消费
const targetSetUsages = matrixCode + stripComments(perfTplTs) + concTs;
for (const key of TARGET_SET_I18N_KEYS) {
  // 三语都要有：漏一个语种就回落到「显示 key 名」或未翻译中文
  for (const lang of ["zh-CN", "en", "ja"]) {
    must(
      readOrDie(`frontend/src/locales/${lang}.ts`).includes(`"diagnostics.${key}"`),
      `目标集文案缺 ${lang} 落点（diagnostics.${key}）`,
    );
  }
  must(
    targetSetUsages.includes(`diagnostics.${key}`),
    `目标集文案 ${key} 未被 perf-matrix-render.ts / tpl.ts / perf-concurrent.ts 引用（加了键却没接线）`,
  );
}
// 已死键不得复活（旧文案是旧契约的化石：留着它，下一个人会以为还有前 N 大模式）
for (const dead of [
  "perfRtype",
  "perfRtypeSingle",
  "perfRtypeAll",
  "perfRtypeTop",
  "perfRtypeTopHint",
  "perfTopLargestCount",
  "perfTopLargestEcho",
]) {
  for (const lang of ["zh-CN", "en", "ja"]) {
    must(
      !readOrDie(`frontend/src/locales/${lang}.ts`).includes(`"diagnostics.${dead}"`),
      `已废弃文案键复活：diagnostics.${dead}（${lang}）`,
    );
  }
}

// ── 3.7b) CLI 可分析类型（cliAnalyzable）双端锚定 ──────────────────────────────
// 立因（2026-09-21 审核）：目标集 selector 此前渲染 registry 全部 15 类，其中 13 类 CLI 无解析
// 链路（PMX/PMD/VRM/FBX/GLTF 的解析器只在前端 3D adapter）、resourcepack/shaderpack 更非模型——
// 用户选中即被 Go 判 unsupported，是「渲染出必然失败的选项」的诚实语义反面（ADR-278 §2.6）。
// 修法：可分析性事实源从 Go 硬编码 map 迁至 resource_types.json 的 cliAnalyzable 声明，
// Go（cliAnalyzable 单点）与前端（选择器过滤）同源消费。本节锁三件事，防再次漂移：
//   ① JSON 字段名是两端共用契约；② Go 的 cliAnalyzable 单点确实读该字段；③ 前端确实据它过滤。
const resourceTypesJsonTs = readOrDie("resource_types.json");
const registryGoTs = readOrDie("go/types/registry/resource.go");
must(
  registryGoTs.includes('json:"cliAnalyzable"'),
  "registry.ResourceType 缺 cliAnalyzable 字段（resource_types.json 的声明将加载不到，Go/前端双双读空）",
);
must(
  targetsGo.includes("registry.RegistryType(rtype)") && targetsGo.includes("rt.CliAnalyzable"),
  "cliAnalyzable 未从注册表读取（事实源应是 resource_types.json 声明，不是 Go 第二份表）",
);
must(
  !stripComments(targetsGo).includes("perfTypeManifest[rtype].CliAnalyzable"),
  "cliAnalyzable 仍在读已退役的 perfTypeManifest 字段（双写必然漂移，该字段已删）",
);
// stages_declared：载荷必须能区分「未声明阶段链」与「声明为 0 段」，前端据实渲染不得反推。
// 立因（2026-09-21）：`expected_stages` 的 Go 零值 0 兼作两种含义，前端曾写
// `cli_analyzable ? expected_stages : "—"` 用一个字段解释另一个字段的零值——口径分叉时
// 「—」会静默变成 0，「未采集」被渲染成「测了，是 0 段」（ADR-278 §2.6 诚实语义）。
must(
  /StagesDeclared\s+bool\s+`json:"stages_declared"`/.test(concurrentGo),
  "perfTypeSummary 缺 stages_declared 字段（前端无法区分「未声明」与「0 段」）",
);
must(
  targetsGo.includes("func stagesDeclared("),
  "缺 stagesDeclared 单点出口（两处回填各写一遍 map 存在性判断必然漂移）",
);
must(
  /s\.stages_declared\s*\?\s*s\.expected_stages/.test(matrixCode),
  "阶段列未按 stages_declared 渲染（回到用 cli_analyzable 反推零值）",
);
must(
  !/cli_analyzable\s*\?\s*s\.expected_stages/.test(matrixCode),
  "阶段列仍在用 cli_analyzable 解释 expected_stages 的零值（该反推已退役）",
);
must(
  /Object\.values\(reg\)[\s\S]{0,220}?filter\(\(t\)\s*=>\s*t\.cliAnalyzable\)/.test(matrixCode),
  "目标集选择器未按 cliAnalyzable 过滤（会再次渲染出选了必报 unsupported 的类型）",
);
// unsupported_reason：Go 发结构化原因 token，前端按 token 查三语文案（不渲染中文散文 hints）。
// 立因（2026-09-21）：Go 的 `hints` 是未 i18n 的中文散文（前端不渲染），明细区只能靠
// `len(stages)==0` 反推一句通用文案——Go 已算好的逐条原因被丢掉。token 与 size_source 同构。
must(
  // 必须查**接线**而非常量/字段名的存在：变异检查证明过，只查 `unsupportedReasonNoCLIParser`
  // 会被常量声明满足（删掉回填仍绿），只查 json tag 会被结构体声明满足。
  concurrentGo.includes("UnsupportedReason: unsupportedReasonNoCLIParser,"),
  "identityOnlyPayload 未回填 unsupported_reason（明细区拿不到逐条原因）",
);
must(
  concurrentGo.includes('json:"unsupported_reason,omitempty"'),
  "singleBenchJSON 缺 unsupported_reason token（明细区无法逐条说明未采集原因）",
);
must(
  // 必须是 token → 键的**配对**（变异检查证明过：只查 token 字面量出现在映射表附近的
  // 宽泛正则，把键改名仍绿——那等于没锁住映射）
  /UNSUPPORTED_REASON_KEYS[\s\S]{0,200}?no_cli_parser:\s*"diagnostics\.perfReasonNoCliParser"/.test(
    matrixCode,
  ),
  "前端缺 unsupported_reason → i18n 映射表（token 将无从渲染）",
);
must(
  matrixCode.includes("unsupportedReasonText("),
  "明细区未走 unsupportedReasonText（回到渲染中文散文或通用句）",
);
// 反向：中文散文 hints 不得重新进入渲染路径（未 i18n，英/日界面会冒中文）
must(
  !/esc\(\s*m\.hints/.test(matrixCode) && !/<[^>]*>\$\{[^}]*m\.hints/.test(matrixCode),
  "明细区在渲染 Go 的中文散文 hints（未 i18n，英/日界面会冒中文）",
);
must(
  resourceTypesJsonTs.includes('"cliAnalyzable": true'),
  "resource_types.json 未声明任何 cliAnalyzable 类型（YSM / maid-model 的登记面丢了）",
);

// ── 3.7c) 渲染与数据的差异：兜底 token 人话 + 哨兵覆盖面说清 ────────────────────
// 立因（2026-09-21 审核）：两处「数据诚实但渲染失真」。
//  ① `classifyForScan` 的兜底 token（container / other）永远不在 registry 里，`rtypeDisplayName`
//     原返回空串 → 载荷不发 rtype_label → 前端 `typeLabel` 的 `label ?: rtype` 与紧随的 id span
//     印出同一 token 两遍（「container container」）。人话归 Go 单点（rtypeFallbackLabels）。
//  ② 选择器已按 cliAnalyzable 过滤，但「全部类型」哨兵在 Go 侧仍扫**全类型**（不可分析条目顺延）
//     → 哨兵覆盖的类型集大于列出的选项。不说明，用户会把它读成「上面列出的这些的全部」。
must(
  registryGoTs.includes("rtypeFallbackLabels") || targetsGo.includes("rtypeFallbackLabels"),
  "Go 侧缺兜底 token 的人话标签表（rtypeFallbackLabels）——container/other 会渲染成同一 token 两遍",
);
for (const tok of ["container", "other"]) {
  must(
    // 必须成对出现且标签与 token 有别——只查 token 字面量会恒真（classifyForScan 里本就有
    // `"container"` 作为返回值），变异检查证明过：把标签改回 token 时那种写法不变红。
    new RegExp(`\"${tok}\":\\s*\"((?!${tok}\")[^\"]+)\"`).test(targetsGo),
    `兜底 token ${tok} 未在 Go 侧给出人话标签（container/other 渲染重复 token 的根因）`,
  );
}
must(
  /title:\s*t\("diagnostics\.perfTargetAllHint"\)/.test(matrixCode),
  "「全部类型」哨兵未挂覆盖面说明（它扫全类型，而选项已按 cliAnalyzable 过滤——不说清即误导）",
);

// ── 3.8) 扫描引擎对照（ADR-262 D3）：Go/Rust 对照载荷 + 未采集原因 token 双端锚定 ──
// 立因：`used=false` 时若前端把缺席的数值当 0 渲染，界面就会说「Rust 0ms」——与「拿不到就说
// 不采集」的诚实红线正好相反（0ms 会被读成「快到测不出」）。故锁三件事：载荷字段名、四个原因
// token 的字面值、渲染分叉依据；否则 Go 改 tag / 前端漏映射都能静默漂移。
const scanBenchGo = readOrDie("go/cli/scan_bench.go");
const scanBenchTs = readOrDie("frontend/src/views/app-content/diagnostics/perf-scan-bench.ts");
const scanBenchCode = stripComments(scanBenchTs);
// perfTplTs 于 §3.7 读取（同一常量复用，不重复读盘）
// 入口（按钮/testid）声明在 tpl.ts，消费在 perf-scan-bench.ts——两文件的代码合并后查引用。
// ADR-278 §2.6：scope hint 单点收进 perf.ts|initPerfMode，接线扫描面并入 facade + 同面板消费链
//（perf-single-bench.ts / perf-common.ts 与本面板同属一条 import 链，文案引用视为已接线）。
const perfFacadeTs = readOrDie("frontend/src/views/app-content/diagnostics/perf.ts");
const perfCommonTs = readOrDie("frontend/src/views/app-content/diagnostics/perf-common.ts");
const scanBenchUsages =
  scanBenchCode +
  stripComments(perfTplTs) +
  stripComments(singleTs) +
  stripComments(perfFacadeTs) +
  stripComments(perfCommonTs);

const SCAN_BENCH_FIELDS = [
  '"spec"',
  '"engines"',
  '"parity"',
  '"used"',
  '"reason"',
  '"median_ms"',
  '"p95_ms"',
  '"runs_ms"',
  '"entries"',
  '"skipped"',
  '"comparable"',
  '"match"',
  '"only_go"',
  '"only_rust"',
  '"field_diff"',
];
for (const field of SCAN_BENCH_FIELDS) {
  must(
    hasJSONTag(scanBenchGo, field.replaceAll('"', "")),
    `scan-bench 载荷缺少字段 json:${field}（go/cli/scan_bench.go）`,
  );
}
for (const field of [
  "spec",
  "engines",
  "parity",
  "used",
  "reason",
  "median_ms",
  "p95_ms",
  "runs_ms",
  "entries",
  "skipped",
  "comparable",
  "match",
  "only_go",
  "only_rust",
  "field_diff",
]) {
  must(
    scanBenchCode.includes(field),
    `前端 ScanBenchPayload 未声明或未消费 ${field}（perf-scan-bench.ts）`,
  );
}

// 四个「未参与原因」token 的常量值必须与前端映射表字面一致：token 是文案映射的判定依据，
// 改了值前端映射全落空（落到通用句），用户再也看不成「为什么没测到 Rust」。
const SCAN_BENCH_REASONS = {
  scanBenchReasonUnavailable: "unavailable",
  scanBenchReasonFellBack: "fell_back",
  scanBenchReasonCacheHit: "cache_hit",
  scanBenchReasonInterfered: "interfered",
};
for (const [constName, token] of Object.entries(SCAN_BENCH_REASONS)) {
  must(
    scanBenchGo.includes(`${constName} = "${token}"`),
    `Go 原因 token 常量失守（scan_bench.go 的 ${constName} 应为 "${token}"）`,
  );
  // 前端映射表用**无引号对象键**（house style），故按 `token:` 形态断言，而不是带引号的字面量
  must(
    scanBenchCode.includes(`${token}:`),
    `前端原因映射缺 ${token}（加了 token 却没接线，界面会落到通用句）`,
  );
}

// 组装点/渲染分叉断言（同前几节教训：只查字段名子串的话，删掉组装或分叉分支断言仍绿）
must(
  /executeCLI\(\s*"scan-bench"/.test(scanBenchCode),
  "前端未提交 scan-bench 命令（GUI 无引擎对照入口）",
);
must(
  /format:\s*"json"/.test(scanBenchCode),
  "前端未在组装点写 format=json（会退化成解析人类文案）",
);
must(
  /const measured = e\.used === true/.test(scanBenchCode),
  "前端未以 used 为渲染分叉依据（未采集的引擎会被填上数值）",
);
must(
  scanBenchCode.includes('"—"'),
  "前端未把未采集的数值列渲染成占位（缺席与 0 必须在展示层可分）",
);
must(
  /comparable !== true/.test(scanBenchCode),
  "前端未对 comparable=false 单独分支（单侧数据会被画出假 ✅/❌）",
);
must(
  /skipped/.test(scanBenchCode) && scanBenchCode.includes("perfScanBenchSkipped"),
  "前端未如实说明 skipped（缓存命中/归属不可判定的次数不得静默丢弃）",
);

const SCAN_BENCH_I18N_KEYS = [
  "perfScanBenchRun",
  "perfScanBenchHint",
  "perfScanBenchTitle",
  "perfScanBenchSpec",
  "perfScanBenchColEngine",
  "perfScanBenchColMedian",
  "perfScanBenchColP95",
  "perfScanBenchColEntries",
  "perfScanBenchColStatus",
  "perfScanBenchMeasured",
  "perfScanBenchNotMeasured",
  "perfScanBenchSamplesHint",
  "perfScanBenchSkipped",
  "perfScanBenchReasonUnavailable",
  "perfScanBenchReasonFellBack",
  "perfScanBenchReasonCacheHit",
  "perfScanBenchReasonInterfered",
  "perfScanBenchReasonUnknown",
  "perfScanBenchParity",
  "perfScanBenchParityMatch",
  "perfScanBenchParityMismatch",
  "perfScanBenchParityNotComparable",
  "perfScanBenchOnlyGo",
  "perfScanBenchOnlyRust",
  "perfScanBenchFieldDiff",
  "perfScanBenchEmpty",
];
for (const key of SCAN_BENCH_I18N_KEYS) {
  // 三语都要有：漏一个语种就回落到「显示 key 名」或未翻译中文
  for (const lang of ["zh-CN", "en", "ja"]) {
    must(
      readOrDie(`frontend/src/locales/${lang}.ts`).includes(`"diagnostics.${key}"`),
      `引擎对照文案缺 ${lang} 落点（diagnostics.${key}）`,
    );
  }
  must(
    scanBenchUsages.includes(`diagnostics.${key}`),
    `引擎对照文案 ${key} 未被 perf-scan-bench.ts / tpl.ts 引用（加了键却没接线）`,
  );
}

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
  "✅ 契约测试通过：CLI 性能命令结构化载荷字段与前端消费锚定一致（白名单 + gui-flow + single-bench + 目标集三旋钮 + 引擎对照 + 反文本解析）",
);
process.exit(0);
