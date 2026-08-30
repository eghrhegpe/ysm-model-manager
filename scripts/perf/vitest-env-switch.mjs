#!/usr/bin/env node
/**
 * perf/vitest-env-switch.mjs — 纯逻辑测试文件环境标注切换工具。
 * 为纯逻辑测试文件添加 @vitest-environment node 标注。
 * 这些文件已确认无 DOM 依赖（document/window/localStorage/createElement/querySelector 等），
 * 切换后省去 happy-dom 环境重建开销（~1.2s/文件）。
 *
 * 用法：node scripts/perf/vitest-env-switch.mjs
 *
 * 依赖：node:fs / node:path / _lib/scan-files.mjs（零外部依赖）
 *
 * 退出码：0 成功；1 失败（文件缺失/写入错误）。
 *
 * 设计意图：性能工具——给已确认无 DOM 依赖的纯逻辑测试文件批量加
 * @vitest-environment node 标注，省去 happy-dom 环境重建开销（~1.2s/文件）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../_lib/scan-files.mjs';

const FRONTEND = path.join(ROOT, 'frontend', 'src');

const files = [
  // backend — 纯逻辑（NBT 解析/zip 提取/IDB 日志/web worker 编排）
  'backend/extract.test.ts',
  'backend/nbt-parse.test.ts',
  'backend/voxel-parse.test.ts',
  'backend/web-stats.test.ts',
  'backend/web-store.logs.test.ts',
  'backend/coi-sw.test.ts',
  // core — 纯逻辑
  'core/context-menus.test.ts',
  'core/handlers/instance-ops.test.ts',
  // features — 纯逻辑
  'features/dnd-collector.test.ts',
  // utils/3d — 纯逻辑（骨骼语义/MMD 材质/解析/感知/能力）
  'utils/3d/semantic-bones.test.ts',
  'utils/3d/semantic-morphs.test.ts',
  'utils/3d/mmd-bones.test.ts',
  'utils/3d/mmd-materials.test.ts',
  'utils/3d/bone-tools.test.ts',
  'utils/3d/parse-java-model.test.ts',
  'utils/3d/perception/autodance.test.ts',
  'utils/3d/perception/beat-detector.test.ts',
  'utils/3d/perception/blink.test.ts',
  'utils/3d/perception/breath.test.ts',
  'utils/3d/perception/gaze.test.ts',
  'utils/3d/perception/lipsync.test.ts',
  'utils/3d/caps/ground-capability.test.ts',
  'utils/3d/caps/light-capability.test.ts',
];

const annotation = '// @vitest-environment node\n';

let ok = 0;
let skip = 0;
for (const rel of files) {
  const fp = path.join(FRONTEND, rel);
  if (!fs.existsSync(fp)) {
    console.warn(`[SKIP] 不存在: ${rel}`);
    skip++;
    continue;
  }
  const content = fs.readFileSync(fp, 'utf8');
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