#!/usr/bin/env node
/**
 * 契约测试：仓库文件写绑定成功路径必须失效扫描缓存（派生 fail-closed 版，2026-10-10 翻转）。
 *
 * 旧版（同日早先）用人工枚举 FILE_WRITE_OPS 清单扫调用点——清单漏列即隐身（fail-open），
 * 实证盲区：DeleteModelFile 手动配了失效但闸看不见。本版改由 scripts/_lib/write-surface-gate.ts
 * **从 go/fileops 导出面自动派生**候选写函数：app 层每个 `fileops.X(` 调用点三选一归宿——
 * ① X 在 READONLY 豁免表（真只读/纯计算，漏分类即红）；② 所在函数体含
 * scanner.InvalidateCache/InvalidatePath；③ 进 exemptSites（带 reason，僵尸条目反查）。
 * 新增写函数被调用而没归类 → 当场红。
 *
 * 历史（保留作理由）：app_files.go 的 RenameDir/RemoveDir/RenameFile/WriteModelFolder 历来
 * 有失效（注释逐条写着「否则 30s 内旧名仍可被扫描命中」），审计抓到 MoveModelFile/
 * CopyModelFile 独漏（右键移动/复制后 tree:reload 命中旧缓存 ≤TTL；watcher 查看器模式无兜底），
 * 已补 + 单测 TestMoveCopyModelFile_InvalidatesScanCache。
 *
 * 运行：node tests/test_fileops_write_invalidate.ts（或经 _lib/contract-tests.ts 统一入口）。
 * 退出码：0 全绿；非 0 断言失败。
 */
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runWriteGate } from "../scripts/_lib/write-surface-gate.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// go/fileops 导出面中的只读/纯计算/不产条目类——**漏列一个被调用的非写函数即红**，
// 漏列一个写函数则它会要求失效归宿（两个方向都 fail-closed）。
const FILEOPS_READONLY = new Set([
  "CheckNoSymlinkInPath", // 只读守卫：逐组件 Lstat 查 symlink，不落盘（2026-10-16 锐评补）
  "CreateDir", // 建空目录：不产模型条目、不改扫描结果语义
  "ExtractPreviewTexture", // 只读提取
  "FindPreviewImage", // 只读查找
  "GetPackInfo", // 只读解析
  "IsFileBanned", // 只读判定
  "MoveCopyTarget", // 纯路径计算（plan，不动盘）
  "RenameTarget", // 纯路径计算（plan，不动盘）
]);

// recycle/download 两包（2026-10-11 锐评收口补入监视面——此前仅靠"人肉守约"手写失效）。
// 诚实边界：`New` 是构造器归只读；recycle 的真实写方法是**方法值链**（r.Restore/r.Delete），
// 闸的正则 `recycle.X(` 抓不到，仍属闸的既有盲区（文档见 write-surface-gate.ts 文件头）。
// 能被抓的只有两个函数式入口：recycle.Move / recycle.RemoveRepoDuplicates。
const RECYCLE_READONLY = new Set(["New"]); // 构造器：写发生在其返回对象的方法链上
const DOWNLOAD_READONLY = new Set(["New", "ResolveSavePath"]); // 构造器 + 纯路径计算

// RemoveRepoDuplicates 在 clearInstanceDir 内被调，但失效由调用方 RemoveInstanceDupes
// 在批量循环后统一做一次（逐目录失效浪费）——豁免并留痕。
const EXTRA_EXEMPT = [
  {
    file: "app_install_instance.go",
    fn: "clearInstanceDir",
    call: "RemoveRepoDuplicates",
    reason: "失效由调用方 RemoveInstanceDupes 批量循环后统一 InvalidateCache() 一次（:114）",
  },
];

const { sites, checked, violations } = runWriteGate({
  root: ROOT,
  appDir: "internal/app",
  minSites: 6, // 现网调用点 19+，低于 6 = 派生/扫描坏了
  packages: [
    { dir: "go/fileops", alias: "fileops", satisfy: "scan", readonlyFns: FILEOPS_READONLY },
    { dir: "go/recycle", alias: "recycle", satisfy: "scan", readonlyFns: RECYCLE_READONLY },
    { dir: "go/download", alias: "download", satisfy: "scan", readonlyFns: DOWNLOAD_READONLY },
  ],
  exemptSites: EXTRA_EXEMPT,
});

assert.ok(
  checked >= 6,
  `受审（非只读）调用点应 ≥6（写族基线：Rename×2+Remove+Move+Copy+WriteFolder+Delete+Toggle×2），实际 ${checked}——` +
    "派生模块或导出面解析失效即空转。",
);

assert.deepStrictEqual(
  violations,
  [],
  "改仓库文件树的 fileops 写绑定成功路径必须失效扫描缓存（否则 tree:reload 命中 ≤TTL 旧缓存，" +
    "已改名/已删/已移走的文件仍出现、新位置不出现；watcher 查看器模式无兜底）。\n" +
    violations.map((v) => `  ${v}`).join("\n"),
);

console.log(
  `[test_fileops_write_invalidate] OK — 派生 fail-closed：${sites} 个调用点（fileops/recycle/download），${checked} 个写点全部有失效归宿`,
);
