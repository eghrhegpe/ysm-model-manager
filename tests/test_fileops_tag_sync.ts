#!/usr/bin/env node
/**
 * 契约测试：fileops 写绑定的标签键「跟随 + 清理」契约（2026-10-11 锐评收口）。
 *
 * 历史病灶（go-tags 卡）：RelocateKeys 迁移只补了「迁移半侧」——
 *   RemoveDir / DeleteResourcePack 失效扫描缓存却不清标签键，孤儿键单调累积，
 *   且**同名重建会复活旧标签**；此前 app 层无任何接线级测试、write-surface-gate 的
 *   satisfy 只有 scan/pair-or-clear 两档，relocate/prune 不在契约内（第 5 个改名入口
 *   漏接线无人红）。
 *
 * 本测试用两枚派生闸（复用 scripts/_lib/write-surface-gate.ts 的导出面派生引擎）：
 *   - rekey：改仓库键的写者（RenameDir/RenameFile/MoveModelFile/CopyModelFile）
 *     调用点必须走 `a.relocateTags(...)`
 *   - prune：删除的写者（RemoveDir/DeleteModelFile）调用点必须走 `a.pruneTags(...)`
 * 新增一个 fileops 写函数被 app 层调用而没归类 → 对应闸当场红。
 *
 * 额外钉死 helper 内部：relocateTags 必须真接 `getTagsStore().RelocateKeys(`、
 * pruneTags 必须真接 `getTagsStore().PruneKeys(`（否则外层走 helper 也是空转）。
 *
 * 启禁（ToggleModelEnable/ToggleEnable）本测试已实证**不 relocate**（
 * internal/app/app_files_toggle_test.go|TestToggleEnable_TagRoundTripPreservesBasePath）：
 * 它只是给同一基准路径加/摘 .disabled 后缀，标签键停在规范路径上，禁用期间 ListByTag
 * 仍能查到、启回后原样复原；真去 relocate 反而会把标签搬到 .disabled 上、启回时变
 * 成新的基准路径孤儿（反向病）。故此处两枚闸均豁免，reason 写清设计原因而非记账。
 * 唯一余口（已补）：禁用态下删除会把规范路径键留成孤儿——DeleteResourcePack 现补清
 * StripDisableSuffix 后的 base path（internal/app/app_prune_disabled_test.go 两例守护）。
 *
 * 运行：node tests/test_fileops_tag_sync.ts（或经 _lib/contract-tests.ts 统一入口）。
 * 退出码：0 全绿；非 0 断言失败。
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runWriteGate } from "../scripts/_lib/write-surface-gate.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// go/fileops 导出面中的只读/纯计算/不产条目类（与 scan 契约测试同口径，两侧一致防漂移）。
const READONLY = new Set([
  "CheckNoSymlinkInPath", // 只读守卫：逐组件 Lstat 查 symlink，不落盘（与 scan 契约测试同口径）
  "CreateDir", // 建空目录：不产模型条目、不改扫描结果语义；新建也无既有标签键可迁移
  "ExtractPreviewTexture", // 只读提取
  "FindPreviewImage", // 只读查找
  "GetPackInfo", // 只读解析
  "IsFileBanned", // 只读判定
  "MoveCopyTarget", // 纯路径计算（plan，不动盘）
  "RenameTarget", // 纯路径计算（plan，不动盘）
]);

const TAG_DEBT = "启禁不 relocateTags（刻意设计，非债务）：只是给同一基准路径加/摘 .disabled，" +
  "标签键停在规范路径上往返后复原；relocate 反而制造反向孤儿。见 app_files_toggle_test.go|TestToggleEnable_TagRoundTripPreservesBasePath";

// ========== 闸一：rekey（改名/移动/复制必须跟随标签键）==========
const rekeyExempt = [
  {
    file: "app_files.go",
    fn: "RemoveDir",
    call: "RemoveDir",
    reason: "删除路径：标签键清理由 prune 闸覆盖，rekey 不适用",
  },
  {
    file: "resource_bindings.go",
    fn: "DeleteResourcePack",
    call: "DeleteModelFile",
    reason: "删除路径：标签键清理由 prune 闸覆盖，rekey 不适用",
  },
  {
    file: "app_files.go",
    fn: "importModelFolderAs",
    call: "WriteModelFolder",
    reason: "新建文件夹：不产既有标签键，无孤儿可迁移",
  },
  {
    file: "app_files.go",
    fn: "ToggleModelEnable",
    call: "ToggleModelEnable",
    reason: TAG_DEBT,
  },
  {
    file: "app_files.go",
    fn: "ToggleEnable",
    call: "ToggleModelEnable",
    reason: TAG_DEBT,
  },
];

const rekeyGate = runWriteGate({
  root: ROOT,
  appDir: "internal/app",
  minSites: 4,
  packages: [{ dir: "go/fileops", alias: "fileops", satisfy: "rekey", readonlyFns: READONLY }],
  exemptSites: rekeyExempt,
});

assert.ok(
  rekeyGate.checked >= 4,
  `受审（非只读非豁免）调用点应 ≥4（写族基线：RenameDir+RenameFile+Move+Copy），` +
    `实际 ${rekeyGate.checked}——派生模块或导出面解析失效即空转。`,
);

assert.deepStrictEqual(
  rekeyGate.violations,
  [],
  "改仓库键的 fileops 写者必须走 a.relocateTags——否则标签键成孤儿，" +
    "web/桌面 rekeyWebModelGroup 同语义断裂。\n" +
    rekeyGate.violations.map((v) => `  ${v}`).join("\n"),
);

// ========== 闸二：prune（删除必须清理标签键）==========
const pruneExempt = [
  {
    file: "app_files.go",
    fn: "RenameDir",
    call: "RenameDir",
    reason: "改名路径：标签键跟随由 rekey 闸覆盖，prune 不适用",
  },
  {
    file: "app_files.go",
    fn: "RenameFile",
    call: "RenameFile",
    reason: "改名路径：标签键跟随由 rekey 闸覆盖，prune 不适用",
  },
  {
    file: "app_files.go",
    fn: "MoveModelFile",
    call: "MoveModelFile",
    reason: "移动路径：标签键跟随由 rekey 闸覆盖，prune 不适用",
  },
  {
    file: "app_files.go",
    fn: "CopyModelFile",
    call: "CopyModelFile",
    reason: "复制路径：标签键跟随由 rekey 闸覆盖，prune 不适用",
  },
  {
    file: "app_files.go",
    fn: "importModelFolderAs",
    call: "WriteModelFolder",
    reason: "新建文件夹：无既有标签键可清理",
  },
  {
    file: "app_files.go",
    fn: "ToggleModelEnable",
    call: "ToggleModelEnable",
    reason: TAG_DEBT,
  },
  {
    file: "app_files.go",
    fn: "ToggleEnable",
    call: "ToggleModelEnable",
    reason: TAG_DEBT,
  },
];

const pruneGate = runWriteGate({
  root: ROOT,
  appDir: "internal/app",
  minSites: 2,
  packages: [{ dir: "go/fileops", alias: "fileops", satisfy: "prune", readonlyFns: READONLY }],
  exemptSites: pruneExempt,
});

assert.ok(
  pruneGate.checked >= 2,
  `受审调用点应 ≥2（删除写族基线：RemoveDir+DeleteModelFile），实际 ${pruneGate.checked}。`,
);

assert.deepStrictEqual(
  pruneGate.violations,
  [],
  "删除的 fileops 写者必须走 a.pruneTags——否则孤儿键累积、同名重建复活旧标签。\n" +
    pruneGate.violations.map((v) => `  ${v}`).join("\n"),
);

// ========== helper 内部必须真接 Store（外层走 helper 也可能是空转）==========
const appFilesSrc = fs.readFileSync(path.join(ROOT, "internal/app/app_files.go"), "utf8");

function bodyOf(src: string, name: string): string {
  const start = src.indexOf(`func (a *App) ${name}(`);
  assert.ok(start >= 0, `未找到 app helper ${name}（被改名？闸的 token 已失效）`);
  const brace = src.indexOf("{", start);
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(brace, i + 1);
    }
  }
  throw new Error(`未闭合的 ${name} 函数体`);
}

const relocateBody = bodyOf(appFilesSrc, "relocateTags");
const pruneBody = bodyOf(appFilesSrc, "pruneTags");

assert.ok(
  relocateBody.includes("getTagsStore().RelocateKeys("),
  "relocateTags 必须真接 Store.RelocateKeys——否则 app 层各写点走了 helper 也是空转",
);
assert.ok(
  pruneBody.includes("getTagsStore().PruneKeys("),
  "pruneTags 必须真接 Store.PruneKeys——否则删除半侧仍是空转",
);

console.log(
  `[test_fileops_tag_sync] OK — rekey ${rekeyGate.sites} 调用点 / ${rekeyGate.checked} 写点、` +
    `prune ${pruneGate.sites} 调用点 / ${pruneGate.checked} 写点全部有标签键归宿`,
);