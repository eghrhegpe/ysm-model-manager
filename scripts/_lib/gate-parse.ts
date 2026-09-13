/**
 * gate-parse.ts — pre-push-gate 工具输出统一解析共享层。
 *
 * 设计意图：pre-push-gate.ts 曾内联 11 处 `JSON.parse` + `_summary` 判定
 * （runTools / runScopedDocDrift / 5 个域检查各自手写一套 try/parse/ok），
 * 判定口径一旦漂移，「fail 时可靠错误信息」的承诺就塌了——一个工具用
 * _summary.ok、另一个用 errors、第三个退回 rc，门禁结论不可复现。
 * 本模块把「解析工具输出 → 判定 ok → 提取 note/tail」收敛为单一实现，
 * 并锁死优先级契约（见文件头契约测试 tests/test_gate_parse_output.ts）：
 *
 *   1. _summary.ok 为 boolean → 以它为准（最高优先级）
 *   2. 否则 _summary.errors 为 number → errors===0 判定
 *   3. 否则退回 rc===0（非 JSON 输出 / 无结构化契约）
 *   4. 解析失败时 note 必须明示「非 JSON 回退」，不许静默假绿
 *   5. 仅 FAIL 时提取 warns_list 为 tail 摘要（PASS 不需要详情）
 *   6. _summary.degraded===true 时 note 追加 degraded 标记——「扫描跳过」不得与
 *      「扫描通过」在门禁摘要里同形
 *
 * 生产端配套：第 1/2/5 条的字段由扫描器写入 _summary。三个「档位扫描器」
 * （check-complexity / check-params / check-type-safety）此前把 ok 放顶层、_summary
 * 内无 ok/errors，被第 1 条的 `_summary || parsed` 短路后读不到 → 判定恒退回 rc，
 * 而它们 rc 恒 0（情报型）→ 静默假绿。统一改用 buildScanVerdict() 生产判定字段。
 *
 * 依赖：零依赖（纯函数，node:assert 级别可测）。
 *
 * 用法：
 *   const { ok, note, tail } = parseToolOutput(out, rc, tool?);      // 消费端（门禁）
 *   const s = buildScanVerdict(errors, warnLines);                   // 生产端（扫描器）
 *
 * 退出码：本模块无独立 CLI（被 pre-push-gate.ts import）。
 */
export interface ParsedToolOutput {
  ok: boolean;
  note: string;
  tail: string;
}

/** 计数键识别：输出里这些键的数值会聚合进 note（供 AI/人快速看量级）。 */
const COUNT_KEY = /count|total|errors|issues|warns|violations|orphan|missing|flagged/;

/**
 * 解析工具输出并判定 ok（纯函数）。
 * @param out  工具 stdout/stderr 合并输出（可能是 JSON，也可能是纯文本）
 * @param rc   工具退出码
 * @param tool 工具名（可选，解析失败时写入 note 便于定位）
 */
export function parseToolOutput(out: string, rc: number, tool?: string): ParsedToolOutput {
  let ok = rc === 0;
  let note = "";
  let tail = "";
  try {
    const parsed = JSON.parse(out);
    const s = parsed._summary || parsed;
    if (typeof s.ok === "boolean") ok = s.ok;
    else if (typeof s.errors === "number") ok = s.errors === 0;
    // 有结构化计数时填充 note（替代空 OK 的假绿）
    const cnt = Object.entries(s)
      .filter(([k, v]) => COUNT_KEY.test(k) && typeof v === "number")
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    if (cnt) note = cnt;
    // 降级运行（ts-morph / go 工具链缺失等）：ok 仍可为 true（仓库约定 degraded≠红灯，
    // 见 gate-config 的 check-android-unavailable 注释），但必须在 note 里留痕——
    // 否则「扫描跳过」与「扫描通过」在门禁摘要里同形（静默假绿）。
    if (s.degraded === true) note = note ? `${note} degraded` : "degraded(降级运行)";
    // 仅 FAIL 时提取 warns_list 摘要——缩进 JSON 的数组内容在 tail 截断下不可见
    if (!ok && Array.isArray(s.warns_list) && s.warns_list.length) {
      tail = `warns_list:\n${s.warns_list.map((w: string) => `  - ${w}`).join("\n")}`;
    }
  } catch {
    // 非 JSON 输出，退回 rc 判定；必须明示回退，不许静默假绿
    if (!ok) note = note || `${tool ? `${tool} ` : ""}输出解析失败（非 JSON），退回 rc 判定`;
  }
  return { ok, note, tail };
}

/**
 * 提取 JSON 输出的 _summary（纯函数）。域检查块专用：
 * 它们解析后要拿 _summary 的字段拼自定义 note（如 check-layering 的
 * zero_tolerance/regressions），语义与 parseToolOutput 的 ok 判定不同，
 * 不强行合并。解析失败 / 无 _summary 键 → null（调用方按 fail-closed 处理）。
 * 返回 any 而非精确类型：域检查块的字段名各不同（count/baseline/ok/regressions…），
 * 收紧为 Record<string, unknown> 会让属性访问全部 TS2339；调用方负责判 null。
 */
export function tryParseSummary(out: string): any | null {
  try {
    const parsed = JSON.parse(out) as { _summary?: any };
    return parsed._summary ?? null;
  } catch {
    return null;
  }
}

/**
 * 解析整对象 JSON（纯函数）。特殊块专用：需要顶层非 _summary 字段的调用方
 * （如 check-redlines 的 results 数组）直接取整对象。解析失败 → null。
 */
export function tryParseJson(out: string): unknown | null {
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

/**
 * 扫描器 `_summary` 判定字段的生产端构造器（与 parseToolOutput 配对，见文件头第 1/2/5 条）。
 *
 * 把「违规数 → ok/errors/warns_list」的写入口径收敛到单点，供三个档位扫描器复用；
 * 契约由 tests/test_gate_parse_output.ts 以「生产 → 消费」往返断言锁死。
 *
 * @param errors 违规计数（>0 即 FAIL；口径由各扫描器定义，见其文件头）
 * @param lines  违规明细单行文本（FAIL 时按 WARNS_TOP_N 截断；PASS 时不写字段，保持载荷精简）
 */
export function buildScanVerdict(
  errors: number,
  lines: readonly string[],
): { ok: boolean; errors: number; warns_list?: string[] } {
  return errors > 0
    ? { ok: false, errors, warns_list: lines.slice(0, WARNS_TOP_N) }
    : { ok: true, errors: 0 };
}

/**
 * FAIL 明细进门禁 tail 的条数上限。门禁 tail 阅读窗口约 12~25 行（record 的 tail 回退
 * 取原始输出尾 12 行），20 条 + 首行 `warns_list:` 恰好落在窗口内，再多会被截掉。
 */
export const WARNS_TOP_N = 20;
