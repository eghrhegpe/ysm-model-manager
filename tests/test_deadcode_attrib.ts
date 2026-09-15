#!/usr/bin/env node
/**
 * 契约测试：scripts/_lib/deadcode-attrib.ts 死代码发现项归属单元测试。
 *
 * 覆盖：
 *   1. findingFiles：knip 键（file|type|name / 整文件 file|file|name）、jscpd 键（f1#f2）
 *   2. attributable：staged 集合含 frontend/ 前缀变体、仓库根直配、不匹配
 *   3. filterNew：混合列表只挑出归属项，非归属项进收编桶
 *   4. canWriteBaseline：写盘守卫（工具失败/解析失败禁写）
 *   5. parseBaseRef：--base > env YSM_DEADCODE_BASE，空白/缺省 → null
 *   6. resolveResponsibleFiles：显式范围优先、范围为空 → []（≠ null）、base 不可解析退回、
 *      本地三源、上游回退、全空 → null（严格模式）——用假 git 注入，零 IO
 *
 * 零依赖、纯函数、无 IO。
 */
import {
  attributable,
  canWriteBaseline,
  findingFiles,
  parseBaseRef,
  resolveResponsibleFiles,
  splitNewFindings,
} from "../scripts/_lib/deadcode-attrib.ts";

const errors = [];
function assert(cond, msg) {
  if (!cond) errors.push(msg);
}

// ── 1. findingFiles ─────────────────────────────────
assert(
  JSON.stringify(findingFiles("src/a.ts|exports|foo")) === JSON.stringify(["src/a.ts"]),
  `knip 键应取首段文件: ${JSON.stringify(findingFiles("src/a.ts|exports|foo"))}`,
);
assert(
  JSON.stringify(findingFiles("src/a.ts|file|src/a.ts")) === JSON.stringify(["src/a.ts"]),
  "knip 整文件键应取首段",
);
assert(
  JSON.stringify(findingFiles("src/a.ts#src/b.ts")) === JSON.stringify(["src/a.ts", "src/b.ts"]),
  "jscpd 键应拆出两个文件",
);
assert(JSON.stringify(findingFiles("weird-no-sep")) === JSON.stringify([]), "无分隔符键返回空数组");

// ── 2. attributable ─────────────────────────────────
const stagedFrontend = new Set(["frontend/src/utils/x.ts"]);
assert(
  attributable("src/utils/x.ts|exports|foo", stagedFrontend),
  "knip 候选补 frontend/ 前缀后应命中 staged",
);
assert(attributable("src/a.ts#src/utils/x.ts", stagedFrontend), "jscpd 任一文件命中即归属");

const stagedRoot = new Set(["docs/foo.md", "internal/app/app_files.go"]);
assert(attributable("internal/app/app_files.go|functions|Bar", stagedRoot), "Go 文件根路径直配");

const stagedNone = new Set(["frontend/src/views/app-tree/index.ts"]);
assert(
  !attributable("src/preview-3d/adapters/switch-preview.ts|exports|arrangeModelsInRow", stagedNone),
  "不在 staged 的发现项不应归属",
);
assert(
  attributable("frontend/src/views/app-tree/index.ts|exports|foo", stagedNone),
  "候选自带 frontend/ 前缀也应直配",
);

// ── 3. splitNewFindings ─────────────────────────────
const staged = new Set(["frontend/src/features/import-executor.ts"]);
const news = [
  "src/features/import-executor.ts|exports|newFn", // 归属（staged）
  "src/preview-3d/adapters/switch-preview.ts|exports|arrange", // 不归属（他人遗留）
];
const split = splitNewFindings(news, staged);
assert(split.blocking.length === 1 && split.blocking[0] === news[0], "仅归属项进阻断桶");
assert(split.absorbable.length === 1 && split.absorbable[0] === news[1], "非归属项进收编桶");

const strict = splitNewFindings(news, null);
assert(
  strict.blocking.length === 2 && strict.absorbable.length === 0,
  "责任集为 null（严格模式）时全部阻断",
);

// ── 4. canWriteBaseline（基线写盘守卫）─────────────────
// 防洗白：任一工具「未执行成功（out===null）或输出解析失败（假零发现）」
// 时禁止写盘——否则空 findings 被写盘后旧债务全部洗白。
// 正常：两工具都有发现
assert(
  canWriteBaseline(["a|exports|x"], "out", false, ["b#c"], "out", false),
  "两工具各有发现时应放行写盘",
);
// 正常：工具执行成功但零发现（合法空结果，非失败）
assert(
  canWriteBaseline([], "out", false, [], "out", false),
  "两工具执行成功零发现（解析成功）时应放行",
);
// 失败：knip 未执行成功（out===null 且无发现）
assert(!canWriteBaseline([], null, false, ["b#c"], "out", false), "knip 未执行成功时应禁止写盘");
// 失败：knip 执行了但输出解析失败（假零发现）——P2 回归点
assert(
  !canWriteBaseline([], "out", true, ["b#c"], "out", false),
  "knip 解析失败（假零发现）时应禁止写盘",
);
// 失败：jscpd 报告读取失败（假零发现）
assert(
  !canWriteBaseline(["a|exports|x"], "out", false, [], "out", true),
  "jscpd 解析失败时应禁止写盘",
);
// 失败：单工具失败即整体拒绝（对称性）
assert(!canWriteBaseline([], null, false, [], null, false), "两工具均不可信时应禁止写盘");

// ── 5. parseBaseRef（显式变更范围，ADR-244）────────────
// CI 跑在 push 之后：本地三源与未推送 diff 必然全空 → 责任集恒 null → 严格模式全阻断，
// 而 CI 传 --json 又关掉自动收编 ⇒ 结构性恒红。故 CI 必须显式给出范围。
assert(parseBaseRef([], {}) === null, "无参数无 env → null");
assert(parseBaseRef(["--json", "--update-baseline"], {}) === null, "仅其它 flag → null");
assert(parseBaseRef(["--base", "abc123"], {}) === "abc123", "--base <rev> 应取值");
assert(parseBaseRef(["--base", "  abc123  "], {}) === "abc123", "--base 值应 trim");
assert(parseBaseRef(["--base", ""], {}) === null, "--base 空值且无 env → null");
assert(
  parseBaseRef(["--base", ""], { YSM_DEADCODE_BASE: "envsha" }) === "envsha",
  "--base 空值时退回 env",
);
assert(
  parseBaseRef(["--base", "cli"], { YSM_DEADCODE_BASE: "envsha" }) === "cli",
  "CLI 优先于 env",
);
assert(parseBaseRef([], { YSM_DEADCODE_BASE: "envsha" }) === "envsha", "env 生效");
assert(parseBaseRef([], { YSM_DEADCODE_BASE: "   " }) === null, "env 全空白 → null");

// ── 6. resolveResponsibleFiles（归属裁剪输入侧）──────────
/** 假 git：按「参数拼接」查表返回 stdout（未命中 → null，模拟 git 失败）。 */
const fakeGit =
  (map: Record<string, string>) =>
  (...args: string[]) =>
    Object.hasOwn(map, args.join(" ")) ? (map[args.join(" ")] as string) : null;

// ⓪ --base 可解析 → 用范围，且**无视**本地三源（本地也脏时不得混淆归属）
{
  const notes: string[] = [];
  const r = resolveResponsibleFiles(
    fakeGit({
      "rev-parse --verify --quiet deadbeef^{commit}": "deadbeef\n",
      "diff --name-only deadbeef...HEAD": "docs/a.md\nfrontend\\src\\b.ts\n",
      "diff --cached --name-only": "should-not-be-used.ts\n",
    }),
    "deadbeef",
    notes,
  );
  assert(
    JSON.stringify(r) === JSON.stringify(["docs/a.md", "frontend/src/b.ts"]),
    `--base 生效时应按范围归属且反斜杠归一化，实际 ${JSON.stringify(r)}`,
  );
  assert(
    notes.some((n) => n.includes("deadbeef")),
    "--base 生效应留痕（责任范围 INFO）",
  );
}

// ⓪ 范围为空 → []（关键不变量）：空范围 ≠ 无从归属，不得退化成严格模式全阻断
{
  const r = resolveResponsibleFiles(
    fakeGit({
      "rev-parse --verify --quiet sha1^{commit}": "sha1\n",
      "diff --name-only sha1...HEAD": "",
    }),
    "sha1",
    [],
  );
  assert(
    Array.isArray(r) && r.length === 0,
    `空变更范围应返回空数组（非 null），实际 ${JSON.stringify(r)}`,
  );
}

// ⓪ base 不可解析（拼错 ref）→ 记 INFO 并退回本地三源，不新增失败模式
{
  const notes: string[] = [];
  const r = resolveResponsibleFiles(
    fakeGit({
      "rev-parse --verify --quiet bogus-ref^{commit}": null,
      "diff --cached --name-only": "frontend/src/x.ts\n",
    }),
    "bogus-ref",
    notes,
  );
  assert(
    JSON.stringify(r) === JSON.stringify(["frontend/src/x.ts"]),
    "base 不可解析时应退回本地三源",
  );
  assert(
    notes.some((n) => n.includes("不可解析")),
    "base 不可解析应留 INFO 痕",
  );
}

// ⓪ 全零 SHA（GitHub 新 tag/新分支 push 的 event.before）→ 试上一个可达 tag 兜底；
//    取不到（首版）→ 留 INFO 并退回本地三源（与旧行为一致）
{
  const notes: string[] = [];
  const r = resolveResponsibleFiles(
    fakeGit({
      "describe --tags --abbrev=0 HEAD^": "v1.0.0\n",
      "diff --name-only v1.0.0...HEAD": "a.ts\n",
    }),
    "000",
    notes,
  );
  assert(
    JSON.stringify(r) === JSON.stringify(["a.ts"]),
    `全零 base 应按上一个可达 tag 归属，实际 ${JSON.stringify(r)}`,
  );
}
{
  const notes: string[] = [];
  const r = resolveResponsibleFiles(
    fakeGit({
      "describe --tags --abbrev=0 HEAD^": null,
      "diff --cached --name-only": "b.ts\n",
    }),
    "000",
    notes,
  );
  assert(
    JSON.stringify(r) === JSON.stringify(["b.ts"]),
    "全零 base 无 tag 历史时应退回本地三源",
  );
  assert(
    notes.some((n) => n.includes("全零")),
    "全零 base 应留 INFO 痕",
  );
}

// ①②③ 本地三源会合并（staged + 未暂存 + 未跟踪）
{
  const r = resolveResponsibleFiles(
    fakeGit({
      "diff --cached --name-only": "a.ts\n",
      "diff --name-only": "b.ts\n",
      "ls-files --others --exclude-standard": "c.ts\n",
    }),
    null,
    [],
  );
  assert(
    JSON.stringify(r) === JSON.stringify(["a.ts", "b.ts", "c.ts"]),
    `三源应合并去重，实际 ${JSON.stringify(r)}`,
  );
}

// ④ 本地三源空 → 回退未推送提交 diff
{
  const r = resolveResponsibleFiles(
    fakeGit({
      "rev-parse --abbrev-ref --symbolic-full-name @{upstream}": "origin/main\n",
      "diff --name-only origin/main...HEAD": "go/a.go\n",
    }),
    null,
    [],
  );
  assert(JSON.stringify(r) === JSON.stringify(["go/a.go"]), "上游 diff 回退路径");
}

// ④ 全空 → null（严格模式，调用方全阻断）
{
  const r = resolveResponsibleFiles(fakeGit({}), null, []);
  assert(r === null, "无任何上下文应返回 null（严格模式）");
  const split = splitNewFindings(["src/a.ts|exports|foo"], r);
  assert(split.blocking.length === 1, "null 责任集下新增项全部阻断");
}

if (errors.length) {
  console.error(`✖ ${errors.length} 项失败:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("✅ test_deadcode_attrib 全部通过");
