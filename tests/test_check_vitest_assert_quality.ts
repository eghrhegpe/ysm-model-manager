#!/usr/bin/env node
/**
 * 契约测试：check-vitest-assert-quality.ts 前端 vitest「失败失语」闸。
 *
 * 覆盖：
 *   1. 主判据 compound-no-message：含顶层 && / || 的 expect 被 .toBe(true|false|Truthy|Falsy)
 *      收尾且无第二实参消息 → 命中；带消息 → 只进普查不命中
 *   2. 嵌套逻辑不算顶层（`.some(x => x.a && x.b)` 是业务短路，不是断言结构）
 *   3. 收尾形态白名单：只认布尔化 matcher；.toEqual / .toHaveLength / .toBe(3) 不命中
 *   4. 尺寸稀释（census.sizeDiluted）：进普查、不进 hits（静态不可判 → 刻意不立闸）
 *   5. 豁免：行内 `// assert-quality-allow: <理由>` 放行；空理由不放行
 *   6. 注释与字符串里的 expect( 不误判
 *   7. diffBaseline 计数制：超线 regression / 降线 fixed / 基线外文件即回归
 *   8. 全仓自检：scanAll 扫描域非空 + 当前仓库对基线 rc=0（防接线后基线漂移）
 *
 * 零依赖（仅 node:assert / node:child_process / node:path）。
 * 运行：node tests/test_check_vitest_assert_quality.ts（经 contract-tests 的 @/ 别名注入）
 */
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  diffBaseline,
  type AssertHit,
  scanAll,
  scanText,
  scanTextFull,
} from "../scripts/check-vitest-assert-quality.ts";
import { check, finish } from "./_lib.mts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const F = "frontend/src/x/fake.test.ts";

function hits(text: string): AssertHit[] {
  return scanText(F, text);
}
function lines(text: string, rule = "compound-no-message"): number[] {
  return hits(text)
    .filter((h) => h.rule === rule)
    .map((h) => h.line);
}

check("R1 复合布尔无消息 → 命中（失败输出无 diff，与裸 t.Fatal 同等失语）", () => {
  const h = hits(`expect(a && b).toBe(true);`);
  assert.equal(h.length, 1);
  assert.equal(h[0]?.rule, "compound-no-message");
  assert.equal(h[0]?.line, 1);
  assert.equal(h[0]?.file, F);
});

check("R1 三种逻辑运算符 × 四种布尔化收尾全命中", () => {
  const cases = [
    "expect(a && b).toBe(true);",
    "expect(a || b).toBe(false);",
    "expect(a && b).toBeTruthy();",
    "expect(a || b).toBeFalsy();",
    "expect(a && b).not.toBe(true);",
    "expect(a && b).not.toBeTruthy();",
  ];
  for (const c of cases) assert.equal(lines(c).length, 1, `应命中: ${c}`);
});

check("R1 带第二实参消息 → 只进普查、不命中（消息已缓解失语）", () => {
  const r = scanTextFull(F, `expect(a && b, "通道应就绪").toBe(true);`);
  assert.deepEqual(r.hits, []);
  assert.equal(r.census.compoundWithMessage, 1);
});

check("R2 嵌套逻辑不算顶层：.some(x => x.a && x.b) 的短路是业务语义", () => {
  assert.deepEqual(lines(`expect(items.some((x) => x.a && x.b)).toBe(true);`), []);
  assert.deepEqual(lines(`expect(fn(a && b)).toBe(true);`), []);
  // 顶层 + 嵌套混合仍算顶层（外层 && 在深度 0）
  assert.equal(lines(`expect(x && items.some((i) => i.a || i.b)).toBe(true);`).length, 1);
});

check("R3 收尾白名单：非布尔化 matcher 不命中（.toEqual / .toBe(3) / .toHaveLength）", () => {
  for (const c of [
    "expect(a && b).toEqual(true);",
    "expect(a && b).toBe(3);",
    "expect(a && b).toHaveLength(2);",
    "expect(a && b).toContain(1);",
  ]) {
    assert.deepEqual(lines(c), [], `不应命中: ${c}`);
  }
});

check("R4 尺寸稀释进普查不进 hits（静态不可判真伪 → 刻意不立闸）", () => {
  const r = scanTextFull(F, `expect(errors.length).toBeGreaterThan(0);`);
  assert.deepEqual(r.hits, [], "尺寸稀释不得进基线");
  assert.equal(r.census.sizeDiluted, 1);
  // .length).toBeTruthy() 是存在性判定的另一形态，同样不进 hits
  assert.deepEqual(scanTextFull(F, `expect(list.length).toBeTruthy();`).hits, []);
});

check("R5 豁免：行内 assert-quality-allow 加非空理由放行；空理由不放行", () => {
  assert.deepEqual(
    lines(`expect(a && b).toBe(true); // assert-quality-allow: A 或 B 任一即合规`),
    [],
  );
  // 多行语句：豁免注记落在语句覆盖的任一行均生效
  assert.deepEqual(
    lines(`expect(\n  a &&\n  b, // assert-quality-allow: 复合条件即被测语义\n).toBe(true);`),
    [],
  );
  // 空理由不豁免
  assert.equal(lines(`expect(a && b).toBe(true); // assert-quality-allow:`).length, 1);
});

check("R6 注释与字符串里的 expect( 不误判", () => {
  assert.deepEqual(lines("// expect(a && b).toBe(true);"), []);
  assert.deepEqual(lines("/* expect(a && b).toBe(true); */"), []);
  assert.deepEqual(lines(`const s = "expect(a && b).toBe(true);";`), []);
  assert.deepEqual(lines(`const t = \`expect(a && b).toBe(true);\`;`), []);
  // 标识符/成员访问前缀不算 expect 调用
  assert.deepEqual(lines("myExpect(a && b).toBe(true);"), []);
  assert.deepEqual(lines("obj.expect(a && b).toBe(true);"), []);
});

check("R7 diffBaseline 计数制：超线 regression、降线 fixed、基线外文件即回归", () => {
  const baseline: Parameters<typeof diffBaseline>[1] = { "a.ts": { "compound-no-message": 2 } };
  assert.deepEqual(diffBaseline({ "a.ts": { "compound-no-message": 2 } }, baseline), {
    regressions: [],
    fixed: [],
  });
  assert.equal(diffBaseline({ "a.ts": { "compound-no-message": 3 } }, baseline).regressions.length, 1);
  assert.equal(diffBaseline({ "a.ts": { "compound-no-message": 1 } }, baseline).fixed.length, 1);
  assert.equal(diffBaseline({ "a.ts": { "compound-no-message": 0 } }, baseline).fixed.length, 1);
  assert.equal(
    diffBaseline({ "b.ts": { "compound-no-message": 1 } }, baseline).regressions.length,
    1,
    "基线外文件即回归",
  );
});

check("R8 全仓自检：扫描域非空 + 当前仓库对基线 rc=0（接线后防漂移）", () => {
  const all = scanAll();
  assert.ok(all.scannedFiles > 0, "扫描域 frontend/src 下应有 *.test.ts——0 文件即扫描失效");
  let rc = 0;
  try {
    execFileSync(
      process.execPath,
      [path.join(ROOT, "scripts", "check-vitest-assert-quality.ts"), "--json"],
      { cwd: ROOT, encoding: "utf8" },
    );
  } catch (e) {
    rc = (e as { status?: number }).status ?? 1;
  }
  assert.equal(rc, 0, "当前命中应全部在基线内（rc=0）；若刚收敛过债务请跑 --update 收紧");
});

finish("check-vitest-assert-quality 契约测试");
