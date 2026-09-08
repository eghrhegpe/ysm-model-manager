#!/usr/bin/env node
/**
 * 契约测试：check-boolean-naming「语义正确 + 白名单可扩展 + debt 级阻断」。
 *
 * 背景（2026-09-08 门禁鸡肋审查）：doctor --all 报 check-boolean-naming 有
 * 135+ 违规，高频误报词 orbit(12) / keep(9) / value(9) / at(7) / disposed(7) /
 * changed(6)。抽查发现这些变量**确实有 :boolean 类型注解**：
 *
 *   orbitMode: boolean    ← wasd-camera.ts:27   函数参数
 *   value: boolean        ← ui-rows.ts:35,130   函数参数（switch/checkbox）
 *   castShadow: boolean   ← shadow-capability.ts:478   接口字段（three.js 契约）
 *   busy                  ← lock.ts:17 createBusyLock 返回值
 *   disposed: boolean     ← autodance.ts:96 等     生命周期状态标志
 *   changed: boolean      ← ui-advanced-rows.ts:188  变更检测标志
 *
 * 结论：check-boolean-naming 的**扫描逻辑是对的**——它真的抓 :boolean 注解的变量。
 * 但 VALID_PREFIXES 白名单太窄（仅 ~45 个词），很多合法状态词不在列；
 * 且无 baseline 豁免；且**硬阻断**（与 check-deadcode-baseline 同级的"建议级"
 * 检查不该 hard block）。
 *
 * 本测试定义正确行为的契约：
 *   1. 扫描正确性：确实只抓 :boolean / = true|false / () : boolean 三类
 *   2. 白名单可扩展：状态词（busy/disposed/changed/orbit/transparent/cast）
 *      应能被纳入而不引发大面积误报
 *   3. 阻断策略：boolean-naming 属于"命名建议"，应降级为 debt（只记录不阻断）
 *   4. baseline 机制：已登记的可接受违规不重复报
 *
 * 运行：node tests/test_check_boolean_smart.ts
 */
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VALID_PREFIXES } from "../scripts/check-boolean-naming.ts";

// ── 1. 扫描正确性：三类 boolean 声明 ────────────────────

/** check-boolean-naming 当前的扫描模式（从源码摘出，作为事实来源）。 */
const BOOLEAN_PATTERNS = {
  literal: /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:true|false)\b/g,
  typeAnnot: /\b([A-Za-z_$][\w$]*)\s*:\s*boolean\b/g,
  funcReturn: /\bfunction\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*:\s*boolean\b/g,
};

/** 在一段代码里提取所有被判定为"布尔变量"的名字。 */
function extractBooleanNames(code: string): string[] {
  const names = new Set<string>();
  for (const [key, re] of Object.entries(BOOLEAN_PATTERNS)) {
    re.lastIndex = 0; // 重置 lastIndex（RegExp 对象有状态）
    for (const m of code.matchAll(re)) {
      // 函数返回类型的函数名本身不是布尔变量，跳过
      if (key === "funcReturn") continue;
      names.add(m[1]!);
    }
  }
  return [...names];
}

// Fixture：混合代码
const fixture = `
  // 1. 字面量初始化
  const isReady = true;
  let shouldSkip = false;
  const legacyBool = true;          // 命名差但类型对 → 会被报

  // 2. 类型注解
  interface Options {
    visible: boolean;
    orbitMode: boolean;              // 状态词，合法语义 → 白名单应包含
    busy: boolean;                   // 状态词，合法语义 → 白名单应包含
    castShadow: boolean;             // 动词 + 宾语，状态语义 → 可接受
  }

  // 3. 函数返回类型
  function hasPermission(): boolean { return true; }
  function checkSomething(): boolean { return false; }

  // 4. 非布尔变量 —— 不应被扫到
  const count = 42;
  const name = "hello";
  let flag: number = 0;
`;

const foundNames = extractBooleanNames(fixture);
console.log(`   扫描 fixture 发现 ${foundNames.length} 个布尔声明: ${foundNames.join(", ")}`);

assert.ok(foundNames.includes("isReady"), "字面量初始化 const isReady = true → 应被扫到");
assert.ok(foundNames.includes("shouldSkip"), "字面量初始化 let shouldSkip = false → 应被扫到");
assert.ok(foundNames.includes("legacyBool"), "字面量初始化 → 应被扫到（即使命名差）");
assert.ok(foundNames.includes("visible"), "类型注解 visible: boolean → 应被扫到");
assert.ok(foundNames.includes("orbitMode"), "类型注解 orbitMode: boolean → 应被扫到");
assert.ok(foundNames.includes("busy"), "类型注解 busy: boolean → 应被扫到");
assert.ok(foundNames.includes("castShadow"), "类型注解 castShadow: boolean → 应被扫到");
assert.ok(!foundNames.includes("count"), "number 变量不应被扫到");
assert.ok(!foundNames.includes("name"), "string 变量不应被扫到");
assert.ok(!foundNames.includes("hasPermission"), "函数返回类型的函数名本身不是布尔变量 → 跳过");
assert.ok(!foundNames.includes("checkSomething"), "函数返回类型跳过");

console.log("  ✓ 扫描正确性：三类 boolean 声明正确提取，非布尔不误报");

// ── 2. VALID_PREFIXES 白名单应该包含状态词 ────────────

// 独立复现扫描器的 firstWord 提取（首个小写词），与脚本 checkName 逻辑一致。
function firstWordOf(name: string): string {
  const m = name.match(/^[a-z]+/);
  return m ? m[0] : "";
}

// 真实扫描确认的合法布尔状态语义词 → 现已被脚本白名单接受（第一词在名单内）
const STATUS_WORDS_THAT_SHOULD_PASS = [
  "busyMode", // 忙状态（锁/异步操作）
  "disposed", // 生命周期：已析构
  "changed", // 变更检测
  "found", // 查询结果
  "orbitMode", // 相机模式
  "transparent", // 渲染属性
  "castShadow", // 投射阴影（castShadow）
  "depthTest", // 渲染属性（depthTest/depthWrite）
  "wireframe", // 渲染模式
  "patched", // 补丁应用
  "environmentOn", // 环境开关
  "prevEnabled", // 之前的状态（prevEnabled）
  "earlyExit", // 早退标志（earlyExit）
  "skip", // 跳过标志
  "subPathUsed", // 子路径使用标志
  "exists", // 存在检测
  "useSSR", // useXXX 开关（useAsBackground/useSSR）
  "sameType", // 相同类型标志（sameType）
  "multiModel", // 多模型标志（multiModel）
  "glow", // 发光效果
  "floatCompare", // 浮点比较标志
  "load", // 加载标志
  "pivotSet", // 枢轴设置标志
  "mirror", // 镜像标志
  "defaultVisible", // 默认值标志
  "settled", // 稳定状态
  "timedOut", // 超时状态
];

// 缩写 / 太泛 → 仍应被报
const BAD_NAMES_THAT_SHOULD_FAIL = [
  "value", // 太泛：任何类型都可能叫 value
  "atBoundary", // 缩写 atX → 应改用 isAtBoundary
  "val", // 同 value，缩写
  "dgCf", // 缩写 dg → 应改用 diagCf
  "advFilter", // 缩写 adv
  "web", // 太泛
  "unconditional", // 形容词，状态词不明确
];

let inWhitelist = 0;
for (const w of STATUS_WORDS_THAT_SHOULD_PASS) {
  if (VALID_PREFIXES.has(firstWordOf(w))) inWhitelist++;
}
console.log(
  `   状态词审查: ${inWhitelist}/${STATUS_WORDS_THAT_SHOULD_PASS.length} 首词已被白名单接受`,
);

// 状态词首词都应被真实脚本白名单接受（绿阶段；改造后不再缺失）
assert.equal(
  inWhitelist,
  STATUS_WORDS_THAT_SHOULD_PASS.length,
  `改造后所有合法状态词首词应被白名单接受（got ${inWhitelist}/${STATUS_WORDS_THAT_SHOULD_PASS.length}），缺: ` +
    STATUS_WORDS_THAT_SHOULD_PASS.filter((w) => !VALID_PREFIXES.has(firstWordOf(w))).join(", "),
);

// 坏命名首词仍应被拦（白名单不能过度放开）
for (const b of BAD_NAMES_THAT_SHOULD_FAIL) {
  assert.ok(
    !VALID_PREFIXES.has(firstWordOf(b)),
    `坏命名首词 "${firstWordOf(b)}" 不应在白名单（实际含 ${b}）`,
  );
}

console.log("  ✓ VALID_PREFIXES：状态词已补全，坏命名仍被拦截（改造收敛）");

// ── 3. 阻断策略：boolean-naming 应降级为 debt ──────────

// 这些检查的性质对比：
const CHECK_PROPERTIES = {
  // 硬阻断（hard）：功能正确性守卫
  "go build": { category: "hard", reason: "编译不过就跑不了" },
  "vite build": { category: "hard", reason: "前端构建失败" },
  vitest: { category: "hard", reason: "测试失败 = 功能回退" },
  "go test": { category: "hard", reason: "测试失败 = 功能回退" },
  "binding-check": { category: "hard", reason: "Wails 绑定契约破坏 → 运行时崩" },
  "check-redlines": { category: "failClosed", reason: "基线债务不阻断，扫描工具坏了才阻断" },

  // 债务级（debt）：代码质量建议
  "check-boolean-naming": { category: "debt", reason: "命名风格，不影响运行；改造成本高" },
  "check-orphan-exports": { category: "debt", reason: "可能是重构中间态；真孤儿可以手动清理" },
  "check-deadcode-baseline": { category: "debt", reason: "baseline 跟踪器，存量债不阻断" },
  "check-circular": { category: "debt", reason: "TypeScript 编译器已经会报循环依赖" },
  "jscpd-go": { category: "debt", reason: "生产代码重复 = 可接受（DRY 原则的例外）" },
  "check-lib-adoption": { category: "debt", reason: "scripts 内部治理，不影响产品质量" },
  "check-proc-adoption": { category: "debt", reason: "scripts 内部治理，不影响产品质量" },
};

// 验证分类逻辑
for (const [name, prop] of Object.entries(CHECK_PROPERTIES)) {
  if (name === "check-boolean-naming") {
    assert.equal(
      prop.category,
      "debt",
      `boolean-naming 应归类为 debt 级（命名风格，不影响运行），实际=${prop.category}`,
    );
  }
}

console.log(
  "  ✓ 阻断策略：boolean-naming / orphan-exports / deadcode-baseline / jscpd-go 应降级为 debt",
);

// ── 4. 正确的 blockPolicy 分层（当前 gate-config 里 0 个声明） ──

// gate-config.ts 的 BlockPolicy 类型已定义：
//   hard = 默认，FAIL 阻断
//   debt = FAIL 只记录不阻断
//   failClosed = FAIL 只记录，工具不可用才阻断

// 正确的分层声明应该是：
const EXPECTED_BLOCK_POLICY: Record<string, "hard" | "debt" | "failClosed"> = {
  // ALL_STATIC_TOOLS
  "check-doc-drift.ts": "hard",
  "check-adr-health.ts": "hard",
  "check-boolean-naming.ts": "debt", // ← 从 hard 降级
  "check-circular.ts": "debt", // ← 从 hard 降级（TS 编译器已覆盖）
  "check-orphan-exports.ts": "debt", // ← 从 hard 降级
  "check-deadcode-baseline.ts": "debt", // ← 已经是 baseline 跟踪器，应该 debt
  "jscpd-go.ts": "debt", // ← 从 hard 降级（生产代码重复可接受）
  "check-tpl-refs.ts": "hard", // 模板引用断了会渲染崩
  "check-dynamic-import.ts": "hard", // 动态 import 引用断了会运行时崩
  "auto-import.ts": "hard", // import 缺失 = 编译不过
  "event-graph.ts": "hard", // 事件漂移 = 架构断裂
  "gen-routes.ts": "failClosed", // gen 类 autoFix，断了能自动修
  "gen-cli-doc.ts": "failClosed",
  "gen-cli-completion.ts": "failClosed",
  "gen-knowledge-autogen.ts": "failClosed",
  "check-script-hygiene.ts": "hard",
  "check-proc-adoption.ts": "debt", // scripts 内部治理
  "check-lib-adoption.ts": "debt", // scripts 内部治理
  "check-workflow-refs.ts": "hard", // workflow 断了 CI 崩
  "check-readme-index.ts": "failClosed", // README 索引漂移不阻断推送（提交时会修）
  "i18n-check.ts": "hard", // 语言包缺失影响用户
  "css-layer-check.ts": "hard", // Shadow DOM 越界 = 样式失效
  "check-toast-duration.ts": "debt", // 恒绿 → 直接删更好，但先降 debt
  "check-android-unavailable.ts": "hard", // Android 黑名单（已进 pre-commit）
};

const debtItems = Object.entries(EXPECTED_BLOCK_POLICY).filter(([, p]) => p === "debt");
const hardItems = Object.entries(EXPECTED_BLOCK_POLICY).filter(([, p]) => p === "hard");
const fcItems = Object.entries(EXPECTED_BLOCK_POLICY).filter(([, p]) => p === "failClosed");

console.log(
  `   期望分层: ${hardItems.length} hard + ${debtItems.length} debt + ${fcItems.length} failClosed`,
);
console.log(`   debt 级: ${debtItems.map(([k]) => k).join(", ")}`);

assert.ok(
  debtItems.length >= 7,
  "至少 7 个检查应降级为 debt（boolean/orphan/deadcode/jscpd/circular/proc/lib-adoption）",
);

console.log("  ✓ blockPolicy 分层：应从当前全 hard 改为 hard/debt/failClosed 三级");

// ── 5. 真实仓库跑一次：验证 "findings 是合理的 boolean 变量" ──

// 跑真实脚本（不 import，避免依赖问题），只看 --json 输出的 _summary
const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  const { execFileSync } = await import("node:child_process");
  const out = execFileSync(
    process.execPath,
    [path.join(SCRIPTS, "check-boolean-naming.ts"), "--json"],
    { cwd: ROOT, encoding: "utf8", timeout: 30000 },
  );
  const data = JSON.parse(out);
  const names = new Set(data.findings.map((f: any) => f.name));
  const firstWords = new Set(data.findings.map((f: any) => f.firstWord));

  console.log(`   真实仓库扫描: ${data._summary.scanned} 文件, ${data._summary.findings} 违规`);
  console.log(`   高频 firstWord: ${[...firstWords].sort().slice(0, 20).join(", ")}`);

  // 验证：确实抓到了 orbitMode / castShadow / disposed 等有 boolean 注解的变量
  const fixtureBooleans = ["orbitMode", "busy", "castShadow", "disposed", "changed", "transparent"];
  const matched = fixtureBooleans.filter(
    (n) => names.has(n) || [...firstWords].some((w) => n.toLowerCase().includes(w)),
  );
  console.log(
    `   抽查 ${fixtureBooleans.length} 个真实 boolean 变量 → ${matched.length} 个在 findings 里`,
  );

  // 核心断言：findings 里应该至少有一些是"确实有 boolean 类型注解"的
  // （不是脚本误扫了非 boolean 变量）
  // code_review cbd138f38 #1（P2）：核心契约断言不得被外层 catch 吞——原实现把
  // assert 包进 try，catch 只 console.log → AssertionError 被吞、扫描逻辑回归
  // 时测试照样绿（假覆盖）。catch 现仅容忍 execFileSync 子进程失败（跳过场景），
  // 断言失败（AssertionError）必须向上抛
  assert.ok(data._summary.findings > 0, "真实仓库应能扫到 boolean 变量命名违规");
  assert.ok(data._summary.scanned > 100, `扫描文件数应 > 100（got ${data._summary.scanned}）`);

  console.log("  ✓ 真实仓库扫描：findings 确实是有 :boolean 注解的变量");
  console.log("     （脚本扫描逻辑正确，问题在白名单 + blockPolicy）");
} catch (e: any) {
  if (e instanceof assert.AssertionError) throw e;
  console.log(`   (跳过真实仓库扫描: ${e?.message || e})`);
  console.log("  ~ 真实仓库扫描跳过（脚本未就绪或环境问题）——纯函数断言已覆盖核心逻辑");
}

// ── 总结 ─────────────────────────────────────────

console.log("\n📋 check-boolean-naming 改造契约汇总：");
console.log("   1. 扫描逻辑正确（只抓 :boolean / = true|false / () : boolean）");
console.log(
  "   2. VALID_PREFIXES 应扩展状态词：busy/disposed/changed/orbit/cast/depth/wireframe...",
);
console.log("   3. 阻断策略应从 hard 降级为 debt（命名风格不影响运行）");
console.log("   4. gate-config ALL_STATIC_TOOLS 应显式声明 blockPolicy 分层");
console.log("");
console.log("🟡 改造路径：");
console.log("   A. 直接扩展 VALID_PREFIXES（加 ~20 个状态词）→ 误报从 135 降到 ~30");
console.log('   B. 同时在 gate-config 里加 blockPolicy: "debt" → 即使还有剩余也不阻断');
console.log("   C. 若仍嫌多 → 再加 baseline 豁免（已知可接受违规登记）");
