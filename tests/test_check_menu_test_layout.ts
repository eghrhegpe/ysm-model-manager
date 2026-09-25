#!/usr/bin/env node
/**
 * 契约测试：check-menu-test-layout.ts 菜单测试布局快照断言闸（ADR-311 D3）。
 *
 * 覆盖：
 *   1. R-L1 ordered-snapshot 三类形态：map id/kind → toEqual([字面量])、childIds/nodeIds
 *      helper 版；`.sort()).toEqual([...].sort())` 集合惯例豁免
 *   2. R-L2 exact-length：toHaveLength(数字) 命中；toHaveLength(0)（行为式）与
 *      toHaveLength(x.length)（规格驱动——context-menus.test 范本）豁免
 *   3. R-L3 index-access：nodes[i] / nodes![i] / getMenuNodes()[i] 命中
 *   4. 豁免机制：`// layout-assert: <理由>` 行内注记；纯注释行不报；空理由不豁免
 *   5. 规则掩码：menu/shell 与 menu/render 目录 index-access 不计（渲染器输出契约），
 *      其余规则照常；adapters/fbx 全目录排除（场景图 nodes 非菜单节点）
 *   6. diffBaseline 计数制：超线 = regression，低于 = fixed（只减不增语义）
 *   7. 全仓自检：扫描域非空 + 当前仓库命中与基线一致（rc=0，防接线后基线漂移）
 *
 * 零依赖（仅 node:assert / node:child_process / node:path）。
 * 运行：node tests/test_check_menu_test_layout.ts（经 contract-tests 的 @/ 别名注入）
 */
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  diffBaseline,
  type LayoutHit,
  scanAll,
  scanText,
} from "../scripts/check-menu-test-layout.ts";
import { check, finish } from "./_lib.mts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MENU_FILE = "frontend/src/preview-3d/caps/fake-cap.test.ts";
const SHELL_FILE = "frontend/src/preview-3d/menu/shell/fake-shell.test.ts";
const RENDER_FILE = "frontend/src/preview-3d/menu/render/fake-render.test.ts";
const FBX_FILE = "frontend/src/preview-3d/adapters/fbx/fake-fbx.test.ts";

function rules(text: string, file = MENU_FILE): LayoutHit[] {
  return scanText(file, text);
}
function hitLines(text: string, rule: string, file = MENU_FILE): number[] {
  return rules(text, file)
    .filter((h) => h.rule === rule)
    .map((h) => h.line);
}

check("R-L1 有序快照：map(id) → toEqual([字面量]) 命中", () => {
  const hit = rules(`
    expect(folder.children!.map((c) => c.id)).toEqual(["a", "b", "c"]);
  `)[0];
  assert.equal(hit?.file, MENU_FILE);
  assert.equal(hit?.line, 2);
});

check("R-L1 有序快照：map(kind) 与 childIds/nodeIds helper 版命中", () => {
  assert.equal(
    hitLines(`const x = nodes.map((n) => n.kind).toStrictEqual(["slider"]);`, "ordered-snapshot")
      .length,
    1,
  );
  assert.equal(
    hitLines(`expect(childIds(folder)).toEqual(["fog-color", "fog-mode"]);`, "ordered-snapshot")
      .length,
    1,
  );
  assert.equal(hitLines(`expect(nodeIds(nodes)).toEqual(["a"]);`, "ordered-snapshot").length, 1);
});

check("R-L1 集合惯例豁免：.sort()).toEqual([...].sort()) 与 arrayContaining 不报", () => {
  assert.deepEqual(
    hitLines(
      `expect(children.map((c) => c.id).sort()).toEqual(["b", "a"].sort());`,
      "ordered-snapshot",
    ),
    [],
  );
  assert.deepEqual(
    hitLines(
      `expect(nodes.map((n) => n.id)).toEqual(expect.arrayContaining(["a", "b"]));`,
      "ordered-snapshot",
    ),
    [],
  );
});

check("R-L2 精确长度：数字命中；0 与 x.length 规格驱动豁免", () => {
  assert.deepEqual(hitLines(`expect(nodes).toHaveLength(8);`, "exact-length"), [1]);
  assert.deepEqual(hitLines(`expect(menuShows).toHaveLength(0);`, "exact-length"), []);
  assert.deepEqual(
    hitLines(`expect(payload.items).toHaveLength(def.items.length);`, "exact-length"),
    [],
  );
  // 非菜单名词接收者不报（DOM 计数等）
  assert.deepEqual(
    hitLines(`expect(root.querySelectorAll(".x")).toHaveLength(2);`, "exact-length"),
    [],
  );
});

check("R-L3 索引：nodes[i]/nodes![i]/getMenuNodes()[i] 命中；[0] 亦计", () => {
  assert.deepEqual(
    hitLines(
      `
      const folder = nodes[1]!;
      const m = nodes![2];
      const c = cap.getMenuNodes()[1]!.children!;
      `,
      "index-access",
    ),
    [2, 3, 4],
  );
});

check("豁免注记：layout-assert: <理由> 放行；无注记或空理由仍报", () => {
  assert.deepEqual(
    hitLines(
      `expect(nodes).toHaveLength(8); // layout-assert: master toggle 置顶为产品决策`,
      "exact-length",
    ),
    [],
  );
  assert.deepEqual(
    hitLines(`expect(nodes).toHaveLength(8); // layout-assert:`, "exact-length"),
    [1],
    "空理由不豁免",
  );
});

check("纯注释行不报（文档引述断言形态是常态）", () => {
  assert.deepEqual(
    hitLines(
      `
      // 旧写法布局快照 expect(nodes).toHaveLength(8) 已被 ADR-311 集合断言替代
      expect(cap.isEnabled()).toBe(true);
      `,
      "exact-length",
    ),
    [],
  );
});

check("规则掩码：menu/shell 与 menu/render 的 index-access 不计，其余规则照常", () => {
  const shellText = `
      expect(children[0].className).toBe("slide-back");
      expect(nodes).toHaveLength(3);
    `;
  assert.deepEqual(hitLines(shellText, "index-access", SHELL_FILE), []);
  assert.equal(
    hitLines(shellText, "exact-length", SHELL_FILE).length,
    1,
    "exact-length 不受掩码影响",
  );
  assert.deepEqual(
    hitLines(`expect(card.children[0]!.className).toBe("h");`, "index-access", RENDER_FILE),
    [],
  );
});

check(
  "adapters/fbx 全目录排除（scanText 仍认文件路径由 scanAll 过滤——此处验 EXCLUDE 生效于 scanAll）",
  () => {
    const all = scanAll();
    assert.ok(
      !all.some((h: LayoutHit) => h.file.includes("adapters/fbx")),
      "fbx 测试文件不得出现在命中集（场景图 nodes 非菜单节点）",
    );
    assert.ok(!all.some((h: LayoutHit) => h.file === FBX_FILE), "夹具路径不应混入");
  },
);

check("diffBaseline 计数制：超线 regression、降线 fixed、相等无信号", () => {
  const counts: Parameters<typeof diffBaseline>[0] = { "a.ts": { "exact-length": 3 } };
  const baseline: Parameters<typeof diffBaseline>[1] = counts;
  const same = diffBaseline({ "a.ts": { "exact-length": 3 } }, baseline);
  assert.deepEqual(same, { regressions: [], fixed: [] });
  const worse = diffBaseline({ "a.ts": { "exact-length": 4 } }, baseline);
  assert.equal(worse.regressions.length, 1);
  assert.equal(worse.fixed.length, 0);
  const better = diffBaseline({ "a.ts": { "exact-length": 1 } }, baseline);
  assert.equal(better.fixed.length, 1);
  const newFile = diffBaseline({ "b.ts": { "index-access": 1 } }, baseline);
  assert.equal(newFile.regressions.length, 1, "基线外文件即回归");
});

check("全仓自检：scanAll 非空 + 当前仓库对基线 rc=0（接线后基线与代码同步，防漂移）", () => {
  const hits = scanAll();
  assert.ok(hits.length > 50, `全仓布局债命中应达量级（实际 ${hits.length}）`);
  let rc = 0;
  try {
    execFileSync(
      process.execPath,
      [path.join(ROOT, "scripts", "check-menu-test-layout.ts"), "--json"],
      {
        cwd: ROOT,
        encoding: "utf8",
      },
    );
  } catch (e) {
    rc = (e as { status?: number }).status ?? 1;
  }
  assert.equal(rc, 0, "当前命中应全部在基线内（rc=0）；若刚收敛过债务请跑 --update 收紧");
});

finish("check-menu-test-layout 契约测试");
