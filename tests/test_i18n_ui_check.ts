#!/usr/bin/env node
/**
 * 契约测试：i18n-ui-check.ts — 硬编码中文 UI 漂移闸（D3 补双通道判据，2026-10-12）。
 *
 * 背景（第三轮审计 D3）：原判据要求「HTML 信号」才入候选——`value: \`${n} 个\``（D2 病灶）
 * 与 `throw new Error("中文")` 均无 HTML 信号，判定层直接跳过，「全绿」是判据射程造成的
 * 假绿（「检查器承诺 > 检查器射程」）。本测试锁双通道判据的**判别力**（防空转假绿，
 * 同 test_check_layering / innerhtml-hygiene 纯核直测惯例）。切片 B-3（D1 收口）补第三通道
 * THROW_REJECT：throw/reject/TypeError 中文入射程，内部诊断靠 `// i18n-allow: 内部诊断` 台账豁免。
 *
 * 覆盖：
 *   1. 纯核直测 scanSourceText：通道一（HTML 信号）回归不劣化；通道二（UI 值字段上下文）
 *      各形态（同行对象/缩进多行/模板串）；通道三（throw/reject/TypeError 中文 + t() 豁免 +
 *      i18n-allow 内部诊断豁免）；通道四（toast/toastError 载荷，2026-10-15 补，ADR-331-d2）；
 *      豁免族（t() 包裹/label 判净#5/语言选择器/注释遮罩）；i18n-allow 行级台账（命中行/上一行/
 *      相隔两行不逃逸）
 *   2. 真仓 CLI：--json 合法 + 通道三/四生效（真仓 drift 归零）；--stric 拼错退 1（flag 白名单回归）
 *
 * 零依赖（node:assert / node:child_process / node:path / node:url）。
 * 运行：node tests/test_i18n_ui_check.ts
 */
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanSourceText } from "../scripts/i18n-ui-check.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails: string[] = [];
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log("✓", name);
  } catch (e) {
    fails.push(`${name}: ${(e as Error).message}`);
    console.error("✗", name, "-", (e as Error).message);
  }
}
const hitCount = (src: string) => scanSourceText(src).length;

/* ---------- 1. 纯核直测 ---------- */

check("通道一（原判据）回归：HTML 模板 + 中文 + 未包 t() 仍命中", () => {
  assert.equal(
    hitCount('const html = `<div class="x">加载完成</div>`; void html;'),
    1,
    "HTML 信号通道不得因双通道重构而漏报",
  );
});

check("通道二（D3 补）：UI 值字段上下文各形态命中", () => {
  // D2 病灶原型：无 HTML 信号的 value 模板串
  assert.equal(
    hitCount("const n = { id: 'x', value: `${364} 骨骼` }; void n;"),
    1,
    "同行对象 + 模板",
  );
  assert.equal(hitCount('const n = { value: "中文直书" }; void n;'), 1, "同行对象 + 双引号");
  assert.equal(
    hitCount('const nodes = [\n  {\n    id: "a",\n    value: "缩进中文",\n  },\n]; void nodes;'),
    1,
    "缩进多行对象（skeleton-fill-panel 真实形态）",
  );
});

check("通道二豁免族：不属 value 侧的中文不得命中", () => {
  assert.equal(hitCount('const n = { value: t("preview.x") }; void n;'), 0, "t() 直参已翻译");
  assert.equal(
    hitCount('const n = { value: `${t("preview.unit.boneCount", { n: 2 })}` }; void n;'),
    0,
    "模板插值剥 ${} 后无中文",
  );
  // 判净#5：label 侧静态中文 = 键缺失合法回退，明确不查
  assert.equal(hitCount('const n = { label: "环绕" }; void n;'), 0, "label 侧不查（判净#5）");
  // 通道三（D1 收口）：throw/reject 中文现入本闸射程——无 i18n-allow 台账即命中
  assert.equal(
    hitCount('function f(): void { throw new Error("资源包信息为空"); }'),
    1,
    "throw new Error(中文) 入通道三",
  );
  assert.equal(
    hitCount('function f(): Promise<void> { return Promise.reject(new Error("编码失败")); }'),
    1,
    "reject(new Error(中文)) 入通道三",
  );
  // 通道三豁免族：已包 t() 或带 `// i18n-allow: 内部诊断` 台账注均跳过
  assert.equal(
    hitCount('throw new Error(t("preview.err.fbxRead"));'),
    0,
    "t() 直参已翻译（throw 亦然）",
  );
  assert.equal(
    hitCount('throw new Error("循环引用"); // i18n-allow: 内部诊断\nvoid 0;'),
    0,
    "内部诊断 i18n-allow 台账豁免（ADR-331 §2.4）",
  );
  // 语言选择器原生名（刻意不翻）——真实形态 = 通道一的 option HTML（LANG_PICKER 豁免）
  assert.equal(
    hitCount('const html = `<option value="zh-CN">简体中文</option>`; void html;'),
    0,
    "LANG_PICKER 豁免仍生效（option 原生名不翻）",
  );
  // 注释遮罩：注释里的中文模板不得计数（mask 先行）
  assert.equal(
    hitCount('// const n = { value: "注释中文" };\nconst x = 1; void x;'),
    0,
    "注释遮罩后不计数",
  );
});

check("通道四（2026-10-15 补）：toast / toastError 载荷入册", () => {
  // 立因：这两个函数的效果就是「把文案推上屏」，但该串无 HTML 信号、非值字段赋值、
  // 非错误构造头 → 前三通道全线失明（锐评 2026-10-13 记录的「门禁覆盖缺口」）。
  // 补闸前探针实测该盲区下藏着 6 处 en/ja 用户可见硬编码中文。
  assert.equal(hitCount('toast("下载失败", TOAST_MS.normal, "error");'), 1, "toast 双引号载荷");
  assert.equal(hitCount("toast(`截图保存失败：${e}`, TOAST_MS.verbose, 'error');"), 1, "toast 模板串（剥插值后仍有中文）");
  assert.equal(hitCount('toastError(e, "组件加载失败");'), 1, "toastError 第二参载荷");
  // 真实病灶形态：中文藏在 toast 行内的 friendlyError(e, "…") 兜底参数里
  assert.equal(
    hitCount('toast(friendlyError(e, "操作失败"), TOAST_MS.normal, "error");'),
    1,
    "toast 行内 friendlyError 兜底串（存量病灶形态）",
  );
  // 豁免族：t() 直参 / i18n-allow 台账 / 非本闸射程的日志与别名调用
  assert.equal(hitCount('toast(t("downloadQueue.hint.failed"), TOAST_MS.normal, "error");'), 0, "t() 直参已翻译");
  assert.equal(
    hitCount('toast("刻意中文", TOAST_MS.normal, "info"); // i18n-allow: 产品拍板保留\nvoid 0;'),
    0,
    "i18n-allow 台账对通道四同样生效",
  );
  assert.equal(hitCount('console.warn("内部诊断中文");'), 0, "日志不是 toast，不入射程（内部诊断）");
  assert.equal(hitCount('foo.toast("中文");'), 0, "带点号前缀的别名调用不认（只认裸 toast/toastError helper）");
});

check("通道二判据为窄口径：字面量之前的行内前缀恰为 value:/text:/tooltip: 赋值头", () => {  // 契约固化（2026-10-12 仲裁）：DOM 属性赋值 `el.value = "中文"`、`el.textContent = "中文"`
  // **不入本闸射程**——判据只认对象字面量/声明式的值字段（MenuNode schema 病灶形态）。
  // DOM 赋值族属另一债面（运行时写入），扩判据前须分档防误报（D3 原文「须先分档再立闸」）。
  assert.equal(hitCount('el.value = "中文赋值"; void el;'), 0, "DOM .value 赋值不查（窄口径契约）");
  assert.equal(
    hitCount('el.textContent = "中文赋值"; void el;'),
    0,
    "DOM .textContent 不查（窄口径契约）",
  );
});

check("i18n-allow 行级台账：同行尾注 / 上一行注均豁免", () => {
  assert.equal(
    hitCount('const n = { value: "刻意中文" }; // i18n-allow: 产品拍板保留\nvoid n;'),
    0,
    "同行尾注豁免",
  );
  assert.equal(
    hitCount('// i18n-allow: 上游数据回退\nconst n = { value: "刻意中文" };\nvoid n;'),
    0,
    "上一行注豁免（±1 窗，pointer-allow 同构）",
  );
  assert.equal(
    hitCount('// i18n-allow: 相隔两行不生效\n\nconst n = { value: "刻意中文" };\nvoid n;'),
    1,
    "相隔两行的豁免注不得逃逸（窗口精确性）",
  );
});

check("行号语义：命中行 = 字面量所在行（多行文件二分反查）", () => {
  const src = 'const a = 1;\nconst b = 2;\nconst n = {\n  value: "第三处中文",\n};\nvoid n;';
  const hits = scanSourceText(src);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.line, 4, `应报第 4 行，实报 ${hits[0]!.line}`);
});

/* ---------- 2. 真仓 CLI ---------- */

check("真仓 --json：通道三命中全量归零——切片 B-4 分类处理完成，drift=0", () => {
  const out = execFileSync(
    process.execPath,
    [path.join(ROOT, "scripts", "i18n-ui-check.ts"), "--json"],
    {
      cwd: ROOT,
      encoding: "utf8",
    },
  );
  const data = JSON.parse(out);
  assert.equal(typeof data.drift, "number", "drift 应为 number");
  // 切片 B-4（ADR-331 §2.4）分类处理完成：用户可见构造点走 t()（新增 6 个 i18n 键），
  // 内部诊断构造点补 `// i18n-allow: 内部诊断` 台账豁免注——真仓 drift 应收敛到 0。
  assert.equal(data.drift, 0, `真仓应零漂移，实得 ${data.drift}`);
});

check("--strict 拼错（--stric）退 1——flag 白名单守卫不因 main 重构丢失", () => {
  try {
    execFileSync(process.execPath, [path.join(ROOT, "scripts", "i18n-ui-check.ts"), "--stric"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: "pipe",
    });
    assert.fail("未知 flag 应退 1");
  } catch (e) {
    const err = e as { status?: number };
    assert.equal(err.status, 1, "拼错 flag 必须退 1（防严格门禁静默关闭假绿）");
  }
});

if (fails.length > 0) {
  console.error(`\n${fails.length} 项失败:`);
  for (const f of fails) console.error("  -", f);
  process.exit(1);
}
console.log("\n全部通过");
