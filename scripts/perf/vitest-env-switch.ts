#!/usr/bin/env node
/**
 * perf/vitest-env-switch.ts — 纯逻辑测试文件环境标注切换工具。
 * 为纯逻辑测试文件添加 @vitest-environment node 标注。
 * 这些文件已确认无 DOM 依赖（document/window/localStorage/createElement/querySelector 等），
 * 切换后省去 happy-dom 环境重建开销（~1.2s/文件）。
 *
 * 用法：node scripts/perf/vitest-env-switch.ts [--check]
 *   --check  只校验清单条目全部存在且均已标注，不写盘（供契约测试 / CI 使用）
 *
 * 依赖：node:fs / node:path / _lib/scan-files.ts（零外部依赖）
 *
 * 退出码：0 成功；1 失败（文件缺失/写入错误/清单腐化）。
 *
 * 设计意图：性能工具——给已确认无 DOM 依赖的纯逻辑测试文件批量加
 * @vitest-environment node 标注，省去 happy-dom 环境重建开销（~1.2s/文件）。
 *
 * 清单纪律（2026-10-11 收口）：清单是「已切换文件快照」而非「一次性执行草稿」——
 *   - 条目必须真实存在：文件迁移/改名后须同步更新（曾腐化 9 条死路：voxel-parse 真删、
 *     context-menus/instance-ops 迁 features/、perception ×6 迁 adapters/shared/、
 *     dnd-collector 拆分为 dnd/import-dnd + pack-dnd 后不再单文件）；
 *   - 不存在即 fail-closed（exit 1 点名），不再 SKIP 静默吞死路；
 *   - 契约测试 tests/vitest-env-switch.ts 锁「清单条目全存在」不变量。
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "../_lib/scan-files.ts";

const FRONTEND = path.join(ROOT, "frontend", "src");

export const files = [
  // backend — 纯逻辑（NBT 解析/zip 提取/IDB 日志/web worker 编排）
  "parsers/extract.test.ts",
  "parsers/nbt-parse.test.ts",
  "backend/web-stats.test.ts",
  "backend/web-store.logs.test.ts",
  "workers/coi-sw.test.ts",
  // features — 纯逻辑
  "features/context-menu/context-menus.test.ts",
  "features/pack-ops/instance-ops.test.ts",
  // preview-3d — 纯逻辑（骨骼语义/MMD 材质/解析/感知/能力）
  "preview-3d/bone/semantic-bones.test.ts",
  "preview-3d/infra/semantic-morphs.test.ts",
  "preview-3d/bone/mmd-bones.test.ts",
  "preview-3d/materials/mmd-materials.test.ts",
  "preview-3d/bone/bone-tools.test.ts",
  "preview-3d/model/parse-java-model.test.ts",
  "preview-3d/adapters/shared/perception/autodance.test.ts",
  "preview-3d/adapters/shared/perception/beat-detector.test.ts",
  "preview-3d/adapters/shared/perception/blink.test.ts",
  "preview-3d/adapters/shared/perception/breath.test.ts",
  "preview-3d/adapters/shared/perception/gaze.test.ts",
  "preview-3d/adapters/shared/perception/lipsync.test.ts",
  "preview-3d/caps/ground-capability.test.ts",
  "preview-3d/caps/light-capability.test.ts",
];

const annotation = "// @vitest-environment node\n";

/** 校验清单条目全部真实存在（fail-closed：死路即点名报错，防静默腐化）。 */
export function checkListEntries(): { missing: string[]; ok: boolean } {
  const missing: string[] = [];
  for (const rel of files) {
    const fp = path.join(FRONTEND, rel);
    if (!fs.existsSync(fp)) missing.push(rel);
  }
  return { missing, ok: missing.length === 0 };
}

/** 校验清单条目全部已标注 node（fail-closed：漏标即点名，防切换未完成却已登记）。 */
export function checkListAnnotated(): { unannotated: string[]; ok: boolean } {
  const unannotated: string[] = [];
  for (const rel of files) {
    const fp = path.join(FRONTEND, rel);
    if (!fs.existsSync(fp)) continue; // 存在性由 checkListEntries 负责
    const content = fs.readFileSync(fp, "utf8");
    if (!content.startsWith(annotation)) unannotated.push(rel);
  }
  return { unannotated, ok: unannotated.length === 0 };
}

const checkMode = process.argv.includes("--check");
if (checkMode) {
  const ent = checkListEntries();
  if (!ent.ok) {
    console.error(`[vitest-env-switch] 清单含 ${ent.missing.length} 条死路（文件不存在）：`);
    for (const m of ent.missing) console.error(`  - ${m}`);
    console.error("  修复：文件迁移/改名后同步清单，或从清单删除真删条目。");
    process.exit(1);
  }
  const ann = checkListAnnotated();
  if (!ann.ok) {
    console.error(
      `[vitest-env-switch] ${ann.unannotated.length} 个文件未标注 node（已登记但切换未完成）：`,
    );
    for (const u of ann.unannotated) console.error(`  - ${u}`);
    console.error("  修复：确认纯逻辑后加标注，或从清单撤除。");
    process.exit(1);
  }
  console.log(`[vitest-env-switch] ✅ 清单 ${files.length} 条全部存在且已标注`);
  process.exit(0);
}

// 主流程守卫：仅作为脚本执行时运行（契约测试 import 纯函数不触发写盘副作用）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let ok = 0;
  let skip = 0;
  for (const rel of files) {
    const fp = path.join(FRONTEND, rel);
    if (!fs.existsSync(fp)) {
      console.warn(`[SKIP] 不存在: ${rel}`);
      skip++;
      continue;
    }
    const content = fs.readFileSync(fp, "utf8");
    if (content.startsWith(annotation)) {
      console.log(`[SKIP] 已有标注: ${rel}`);
      skip++;
      continue;
    }
    // 已有其他环境标注（如 happy-dom）→ 不覆盖
    if (/^\/\/ @vitest-environment /.test(content)) {
      console.warn(`[SKIP] 已有其他环境标注: ${rel}`);
      skip++;
      continue;
    }
    fs.writeFileSync(fp, annotation + content);
    console.log(`[OK] 添加标注: ${rel}`);
    ok++;
  }

  console.log(`\n完成: ${ok} 个添加, ${skip} 个跳过`);
}
