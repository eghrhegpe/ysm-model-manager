#!/usr/bin/env node
/**
 * test_port_align_baseline.ts — port-align oracle 版本基线断言契约测试（P2① 补网）。
 *
 * 背景：scripts/port-align.ts 的 Blockbench oracle 是手工复刻，其"权威"依赖
 * vendored 参照 upstream/blockbench-master（.gitignore 排除、非 git 管理、可被静默
 * 升级/丢失）。checkOracleBaseline 纯函数把基线钉在仓内（ORACLE_BASELINE 常量 +
 * 知识卡 go-threejs.md 不变量段），本测试锁四种判定：
 *   - 版本==基线 且黄金参照符号全活 → ok（version 回显）
 *   - 版本 ≠ 基线 → version-drift（found 回显实际版本）
 *   - 黄金参照文件缺失 / 符号被上游改名 → ref-missing（定位到具体 file+symbol）
 *   - vendored 参照目录缺席（fresh clone 常态）→ absent（跳过断言，非致命）
 * 另锁 ORACLE_BASELINE 的形状（基线版本 + 两份黄金参照），防裸改。
 *
 * 运行：node tests/test_port_align_baseline.ts
 * 零依赖，用 assert 实现（不计走测试框架）；失败 exit 1。
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ORACLE_BASELINE, checkOracleBaseline } from "../scripts/port-align.ts";

// 构造机内参照 fixture：upstream/blockbench-master/{package.json, 黄金参照两文件}
function fixture(
  version: string,
  opts?: { dropCube?: boolean; dropBedrock?: boolean; breakSymbol?: "cube" | "bedrock" },
) {
  const root = mkdtempSync(join(tmpdir(), "port-align-base-"));
  const bb = join(root, "upstream", "blockbench-master");
  mkdirSync(join(bb, "js/outliner/types"), { recursive: true });
  mkdirSync(join(bb, "js/formats/bedrock"), { recursive: true });
  writeFileSync(join(bb, "package.json"), JSON.stringify({ name: "Blockbench", version }));
  if (!opts?.dropCube) {
    writeFileSync(
      join(bb, "js/outliner/types/cube.js"),
      opts?.breakSymbol === "cube"
        ? "function renamedMirror(element) {\n}"
        : "updateUV(element, animation = true) {\n\tlet face_list = [];\n}",
    );
  }
  if (!opts?.dropBedrock) {
    writeFileSync(
      join(bb, "js/formats/bedrock/bedrock.js"),
      opts?.breakSymbol === "bedrock"
        ? "function parseGeometry(s, group, bone_data) {\n}"
        : "function parseCube(s, group, bone_data) {\n}",
    );
  }
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

// ─── 0) 基线形状钉死：版本 + 两份黄金参照（防裸改常量）──
{
  assert.equal(ORACLE_BASELINE.blockbench, "5.1.4", "基线版本钉 5.1.4（vendored 参照实测值）");
  assert.deepEqual(
    ORACLE_BASELINE.goldenRefs.map((r) => `${r.file}|${r.symbol}`),
    [
      "js/outliner/types/cube.js|updateUV", // box face_list/mirror_uv 两步（cube.js L1289-1316）
      "js/formats/bedrock/bedrock.js|parseCube", // 几何三层 X 镜像/翻号（bedrock.js L648，ADR-042 §2.1）
    ],
    "黄金参照 = cube.js(updateUV) + bedrock.js(parseCube)",
  );
}

// ─── 1) 版本匹配 + 符号全活 → ok ─────────────────────
{
  const { root, cleanup } = fixture(ORACLE_BASELINE.blockbench);
  const r = checkOracleBaseline(root);
  assert.equal(r.status, "ok", "ok");
  if (r.status === "ok") assert.equal(r.version, "5.1.4", "version 回显");
  cleanup();
}

// ─── 2) 版本漂移 → version-drift（found 回显）──────────
{
  const { root, cleanup } = fixture("5.2.0");
  const r = checkOracleBaseline(root);
  assert.equal(r.status, "version-drift", "version-drift");
  if (r.status === "version-drift") assert.equal(r.found, "5.2.0", "found 回显实际版本");
  cleanup();
}

// ─── 3) 黄金参照文件缺失 → ref-missing ───────────────
{
  const { root, cleanup } = fixture(ORACLE_BASELINE.blockbench, { dropBedrock: true });
  const r = checkOracleBaseline(root);
  assert.equal(r.status, "ref-missing", "ref-missing");
  if (r.status === "ref-missing") {
    assert.equal(r.file, "js/formats/bedrock/bedrock.js", "定位到缺失文件");
    assert.equal(r.symbol, "parseCube", "符号回显");
  }
  cleanup();
}

// ─── 4) 符号被上游改名 → ref-missing（符号活形态校验）──
{
  const { root, cleanup } = fixture(ORACLE_BASELINE.blockbench, { breakSymbol: "cube" });
  const r = checkOracleBaseline(root);
  assert.equal(r.status, "ref-missing", "cube.js 内 updateUV 被改名 → ref-missing");
  if (r.status === "ref-missing") assert.equal(r.file, "js/outliner/types/cube.js", "定位到 cube.js");
  cleanup();
}

// ─── 5) 参照目录缺席（fresh clone 常态）→ absent ───────
{
  const empty = mkdtempSync(join(process.cwd(), "tests/.tmp-port-align-absent-"));
  try {
    const r = checkOracleBaseline(empty);
    assert.equal(r.status, "absent", "absent（跳过断言、非致命）");
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
}

console.log("✅ test_port_align_baseline 全部通过");
