#!/usr/bin/env node
/**
 * test_changed_scope.ts — 变更域过滤共享层契约测试（scripts/_lib/changed-scope.ts）。
 *
 * 锁三个扫描器（check-complexity / check-params / check-type-safety）接门禁前的
 * 增量裁剪契约——它是「存量债不淹没本次变更」的唯一实现点，错了会同时影响三者：
 *   - parseChangedFiles：换行分隔列表 → 集合；反斜杠归一化；空/非字符串 → null。
 *   - inChangedScope：未启用过滤（null）恒 true；命中/未命中；反斜杠输入归一化。
 *   - parseGitNameOnly：`git diff --name-only` 输出 → 数组；**空输出 → null**。
 *   - resolveChangedScope：三路优先级（--files 优先 → --changed → 全库）与
 *     **fail-closed 不变量**——`--files` 空列表必须报 error（不许静默退回全库），
 *     `--changed` 自动解析失败时必须报 error（同 gate-parse 第 4 条纪律）。
 *   - parseNameOnlySet / resolveStagedScope（2026-09-15 补）：`--staged` = 本次提交文件集。
 *     空输出 = **合法空集**（与 parseGitNameOnly 的 null 语义刻意相反：此处 git 的 rc 与空
 *     stdout 可区分，只有 rc≠0 才 fail-closed）——钩子继承 GIT_INDEX_FILE，故 pre-commit
 *     内 `git diff --cached` 天然只含本次提交文件，临时索引裁剪自动生效。
 *   - partitionByUnstaged / resolveUnstagedFiles：含未暂存编辑（磁盘 ≠ 提交内容）的文件
 *     必须被门禁跳过——扫描器读磁盘，而行号位移会被 --baseline 判成「新增」（误伤根治点）。
 *
 * resolveLocalChanged 依赖本机 git 状态（CI 浅克隆 / 无远端时不可用），故只断言
 * 「形状」与「不变量」，不断言具体文件集——避免把环境差异固化成红。
 * ⚠️ 但「非 null 时不应为空数组」不是环境巧合，而是**构造性保证**：空 diff 场景真实
 * 存在于 CI（push 之后 origin/main 已推进到本次提交 → merge-base = HEAD → diff 必空），
 * 若空结果退化成 `[]`，则 (a) 本测试红、(b) resolveChangedScope 产出**空 scope** →
 * 三扫描器扫 0 文件恒绿（假绿）。故由 parseGitNameOnly 空输出 → null 钉死。
 *
 * 运行：node tests/test_changed_scope.ts（失败 exit 1；契约 runner 收集）。
 */
import assert from "node:assert/strict";
import {
  inChangedScope,
  parseChangedFiles,
  parseGitNameOnly,
  parseNameOnlySet,
  partitionByUnstaged,
  resolveChangedScope,
  resolveLocalChanged,
  resolveStagedScope,
  resolveUnstagedFiles,
} from "../scripts/_lib/changed-scope.ts";

// ─── 1) parseChangedFiles：换行列表 → 集合 ────────────────
{
  const s = parseChangedFiles("frontend/src/a.ts\nfrontend/src/b.ts");
  assert.ok(s instanceof Set, "非空列表应返回 Set");
  assert.equal(s!.size, 2, "两行 → 两个元素");
  assert.ok(s!.has("frontend/src/a.ts"), "应含首行路径");

  // 反斜杠（Windows 调用方）归一化为正斜杠，与 pre-push-gate 的 --files 口径一致
  const w = parseChangedFiles("frontend\\src\\a.ts");
  assert.ok(w!.has("frontend/src/a.ts"), "反斜杠路径应归一化为正斜杠");

  // 空行 / 空白项剔除，不产生空字符串键
  const padded = parseChangedFiles("\n  frontend/src/a.ts  \n\n");
  assert.equal(padded!.size, 1, "空白行应被剔除");
  assert.ok(padded!.has("frontend/src/a.ts"), "首尾空白应 trim");
}

// ─── 2) parseChangedFiles：空 / 非字符串 → null ──────────
{
  assert.equal(parseChangedFiles(""), null, "空串 → null（缺省）");
  assert.equal(parseChangedFiles("\n\n"), null, "全空白行 → null");
  assert.equal(parseChangedFiles(null), null, "null → null");
  assert.equal(parseChangedFiles(undefined), null, "undefined → null");
  assert.equal(parseChangedFiles(123), null, "非字符串 → null");
}

// ─── 3) inChangedScope：未启用过滤恒 true ───────────────
{
  const scope = parseChangedFiles("frontend/src/a.ts")!;
  assert.equal(inChangedScope("frontend/src/a.ts", scope), true, "命中");
  assert.equal(inChangedScope("frontend/src/b.ts", scope), false, "未命中");
  assert.equal(inChangedScope("frontend\\src\\a.ts", scope), true, "反斜杠输入应归一化后命中");
  assert.equal(inChangedScope("frontend/src/z.ts", null), true, "scope=null 恒 true（全库）");
  assert.equal(inChangedScope("frontend/src/z.ts", undefined), true, "scope=undefined 恒 true");
}

// ─── 4) resolveChangedScope：三路优先级 ─────────────────
{
  // ① --files 优先（门禁/CI 侧），此时忽略 --changed
  const r1 = resolveChangedScope("frontend/src/a.ts", true);
  assert.ok(r1.scope instanceof Set && r1.scope!.has("frontend/src/a.ts"), "--files 命中即用");
  assert.equal(r1.error, undefined, "合法 --files 不应报错");

  // ② 两 flag 皆缺 → 全库（向后兼容，既有调用零行为变更）
  const r2 = resolveChangedScope(null, false);
  assert.equal(r2.scope, null, "缺省 → scope=null（全库）");
  assert.equal(r2.error, undefined, "缺省不算错误");
}

// ─── 5) resolveChangedScope：fail-closed 不变量 ─────────
{
  // --files 给了但为空 → 调用方 bug，必须报错而非静默退回全库
  const empty = resolveChangedScope("", false);
  assert.equal(empty.scope, null, "空 --files 不产生 scope");
  assert.ok(empty.error, "空 --files 必须报 error（否则「传了但没内容」= 假绿）");

  // --changed 自动解析：要么拿到 scope，要么拿到 error——绝不「无 scope 且无 error」
  // （后者会让调用方静默退回全库扫描，存量债淹没本次变更）
  const auto = resolveChangedScope(null, true);
  const okShape = auto.scope instanceof Set && auto.error === undefined;
  const failShape = auto.scope === null && typeof auto.error === "string";
  assert.ok(okShape || failShape, "--changed 必须给出 scope 或 error 之一（fail-closed 不变量）");
}

// ─── 6) resolveLocalChanged：形状（不断言具体文件集）──────
// 非 null 一定是**非空**数组：空 diff（CI push 后 merge-base=HEAD）必须走 null 分支，
// 否则既是本断言的红、也是 --changed 空 scope 恒绿的根。纯函数侧由第 7 组钉死。
{
  const list = resolveLocalChanged();
  if (list !== null) {
    assert.ok(Array.isArray(list), "非 null 时必为数组");
    assert.ok(list.length > 0, "非 null 时不应为空数组（空 diff 必须落 null → fail-closed）");
    assert.ok(
      list.every((f) => typeof f === "string" && f.length > 0 && !f.includes("\\")),
      "全部为非空正斜杠相对路径",
    );
  }
}

// ─── 7) parseGitNameOnly：空输出 → null（2026-09-15 修 CI 空 diff 假绿）──
// git diff --name-only 的 stdout 有两种「空」：真空串、仅换行。二者都必须 → null
// （= 无有效变更域 → 调用方 fail-closed），绝不可返回 []（空 scope = 扫 0 文件恒绿）。
{
  assert.equal(parseGitNameOnly(""), null, "空串 → null（空 diff 不得成空域）");
  assert.equal(parseGitNameOnly("\n"), null, "仅换行 → null");
  assert.equal(parseGitNameOnly("\n\n  \n"), null, "全空白行 → null");

  // 用 deepEqual 钉住**精确形状**：尾换行不得产生空项、反斜杠须归一化
  assert.deepEqual(
    parseGitNameOnly("frontend/src/a.ts\n"),
    ["frontend/src/a.ts"],
    "单行（含尾换行）→ 单元素数组，无空项",
  );
  assert.deepEqual(
    parseGitNameOnly("frontend/src/a.ts\ngo/recycle/recycle.go"),
    ["frontend/src/a.ts", "go/recycle/recycle.go"],
    "两行 → 两元素",
  );
  assert.deepEqual(
    parseGitNameOnly("frontend\\src\\a.ts"),
    ["frontend/src/a.ts"],
    "反斜杠输出归一化为正斜杠",
  );
}

// ─── 8) parseNameOnlySet：空输出 → 空集（与 parseGitNameOnly 的 null 语义刻意相反）──
// `--staged` 的空结果只有一个含义：本次提交不含该域文件 = 合法空域。若仿 parseGitNameOnly
// 返回 null，调用方会跌回「全库」分支——存量债 + 并行会话未提交的脏文件全部涌入，正是本闸
// 2026-09-15 前的实际病症（一次不含前端文件的 docs 提交被 21 条行号位移幻影 exit 1 阻断）。
{
  assert.equal(parseNameOnlySet("").size, 0, "空串 → 空集（不得为 null）");
  assert.equal(parseNameOnlySet("\n\n  \n").size, 0, "全空白行 → 空集");
  assert.deepEqual(
    [...parseNameOnlySet("frontend/src/a.ts\nfrontend/css/b.css\n")],
    ["frontend/src/a.ts", "frontend/css/b.css"],
    "尾换行不产生空项，顺序保持",
  );
  assert.ok(parseNameOnlySet("frontend\\src\\a.ts").has("frontend/src/a.ts"), "反斜杠归一化");
}

// ─── 9) partitionByUnstaged：磁盘≠提交的守卫二分（纯函数）──
{
  const files = ["a.ts", "b.ts", "c.ts"];
  const { clean, skipped } = partitionByUnstaged(files, new Set(["b.ts"]));
  assert.deepEqual(clean, ["a.ts", "c.ts"], "干净文件保序保留");
  assert.deepEqual(skipped, ["b.ts"], "含未暂存编辑的文件被跳过");

  const none = partitionByUnstaged(files, new Set());
  assert.deepEqual(none.clean, files, "无未暂存编辑 → 全 clean");
  assert.deepEqual(none.skipped, [], "无未暂存编辑 → 无 skipped");

  const all = partitionByUnstaged(files, new Set(files));
  assert.deepEqual(all.clean, [], "全脏 → clean 空（调用方须据此报「本闸未判定」，不得静默绿灯）");
  assert.equal(all.skipped.length, 3, "全脏 → 3 条 skipped");

  const w = partitionByUnstaged(["frontend\\src\\a.ts"], new Set(["frontend/src/a.ts"]));
  assert.deepEqual(w.skipped, ["frontend\\src\\a.ts"], "反斜杠输入与正斜杠集合可配对");
  assert.deepEqual(partitionByUnstaged([], new Set(["a.ts"])), { clean: [], skipped: [] }, "空输入 → 双空");
}

// ─── 10) resolveStagedScope / resolveUnstagedFiles：形状与 fail-closed 边界 ──
// 依赖本机 git 状态，故只断言不变量（空域语义由第 8 组在纯函数侧钉死）。
{
  const st = resolveStagedScope();
  if (st.error === undefined) {
    assert.ok(st.scope instanceof Set, "--staged 无 error 时 scope 恒为 Set（空集 = 合法空域，不得为 null）");
  }
  assert.ok(
    st.error === undefined || (st.scope === null && typeof st.error === "string"),
    "--staged 要么给 scope、要么给 error（git 失败才 fail-closed）",
  );

  const un = resolveUnstagedFiles();
  assert.ok(un === null || un instanceof Set, "unstaged 只能是 Set 或 null（null = git 失败，调用方自决）");
}

console.log("✅ test_changed_scope.ts 全部通过（10 组契约断言）");
