#!/usr/bin/env node
/**
 * 契约测试：整合包/落地写入口的双缓存配对守卫（派生 fail-closed 版，2026-10-10 翻转）。
 *
 * 背景：整合包页与同步 diff 各有一层 30s TTL 派生缓存（go/instance 同步结果 + go/sync 扫盘）。
 * go/sync 写操作内部 `defer InvalidateSyncScanCaches()` 自带 sync 一侧；但 instance 一侧
 * **go/sync 不能清**（go/instance 导入 go/sync，反向即成环），失效归 **internal/app 层每条写入口**
 * 成对调 instance.InvalidateSyncItemsCache() + ysmsync.InvalidateSyncScanCaches()（或等价的
 * a.ClearScanCache() 三层清）。审计抓到七条 ysmsync 入口独漏 ResolveConflicts、installer 落地族
 * 全漏（含活 bug ImportByType）——已全补。
 *
 * 旧版（同日早先）用人工枚举 SYNC_WRITE_OPS/INSTALLER_WRITE_OPS 清单扫调用点——清单漏列一个
 * 写函数它根本不进扫描（fail-open）。本版由 scripts/_lib/write-surface-gate.ts 从
 * **go/sync + go/installer + go/importer 三包导出面自动派生**候选写函数，app 层每个 `pkg.X(`
 * 调用点三选一归宿：① 只读豁免表（DetectConflicts/ListVersions/DetectContainerType 等，
 * 漏分类即红）；② 所在函数体含配对失效（两行显式 或 a.ClearScanCache）；③ exemptSites
 * （精确到 文件+函数+调用名，带 reason，僵尸条目反查防烂尾）。新增写函数被调用没归类 → 当场红。
 *
 * 接口方法值盲区：importer.Get(rtype) 返回 Handler、经 h.Import() 落盘——枚举正则天然抓不到
 * `h.Import(`。本版把 importer.Get 归类为**写**（其调用点所在函数必须有失效），间接覆盖
 * ImportByType 这条活路径（其修复见 app_import_invalidate_test.go）。
 *
 * 运行：node tests/test_sync_write_cache_pairing.ts（或经 _lib/contract-tests.ts 统一入口）。
 * 退出码：0 全绿；非 0 断言失败。
 */
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runWriteGate } from "../scripts/_lib/write-surface-gate.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// go/sync 导出面中的只读项（app 层会调用到）
const SYNC_READONLY = new Set([
  "DetectConflicts", // 纯 diff 读，不写盘
  "ListVersions", // 只读枚举实例
  "ResolutionStrategy", // 类型转换（非写动作）
]);
// go/importer 导出面的只读/注册项
const IMPORTER_READONLY = new Set([
  "DetectContainerType", // 内容类型检测（读）
  "DetectContainerTypeFromBase64Tail", // 尾部探针检测（读）
]);

const { sites, checked, exemptHits, violations } = runWriteGate({
  root: ROOT,
  appDir: "internal/app",
  minSites: 15, // 现网三包调用点合计 34，低于 15 = 派生/扫描坏了
  packages: [
    { dir: "go/sync", alias: "ysmsync", satisfy: "pair-or-clear", readonly: SYNC_READONLY },
    { dir: "go/installer", alias: "installer", satisfy: "pair-or-clear", readonly: new Set() },
    {
      dir: "go/importer",
      alias: "importer",
      satisfy: "pair-or-clear",
      readonly: IMPORTER_READONLY,
    },
  ],
  exemptSites: [
    {
      file: "app_install_import.go",
      fn: "InstallModelFile",
      call: "InstallToGlobal",
      reason:
        "落点为整合包实例全局 custom 目录（mcRoot/SubDirMap(ysm)），非 scan/instance/sync 缓存键覆盖的目录；前端零消费者，仅 CLI go/cli/install.go 调用，CLI 进程每启即新、三层派生缓存不驻留——清缓存无对象。查证 2026-10-10（若未来 GUI 接入此绑定、或缓存键扩到实例目录，须移除豁免补失效）。",
    },
    {
      file: "app_install_instance.go",
      fn: "SyncResources",
      call: "SyncResourcesWithConfig",
      reason:
        "app 层恒传 config=nil → 纯读不写盘（go/sync handleSyncConflicts 仅 ConflictPolicy 非空才落盘）。若未来传非 nil config，本函数即变写入口，须移除豁免补两行配对（见 go-sync 卡双缓存配对条注意项）。",
    },
  ],
});

assert.ok(
  checked >= 10,
  `受审（非只读）写调用点应 ≥10（SyncCustomToRepo/Push×2/Pull×2/Toggle/Relink/Resolve/Install×3/importer 写族等），实际 ${checked}——派生模块或导出面解析失效即空转。`,
);
assert.strictEqual(
  exemptHits,
  2,
  `两条精确豁免应各命中一次（InstallToGlobal / SyncResourcesWithConfig），实际 ${exemptHits}——僵尸豁免或归类漂移。`,
);

assert.deepStrictEqual(
  violations,
  [],
  "整合包/落地写入口必须同函数体内有失效归宿（go/sync 不能反向依赖 go/instance，" +
    "instance 侧失效归 app 层）——缺半边 = 整合包页/新落地文件展示旧同步状态 ≤TTL。\n" +
    violations.map((v) => `  ${v}`).join("\n"),
);

console.log(
  `[test_sync_write_cache_pairing] OK — 派生 fail-closed：${sites} 个 sync/installer/importer 调用点，${checked} 个写点全部有配对归宿，${exemptHits} 条精确豁免命中`,
);
