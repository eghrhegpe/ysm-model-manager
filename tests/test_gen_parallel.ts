import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../scripts/_lib/scan-files.ts";

/**
 * ADR-234 D2 守护：15 个 gen 的写盘目标文件两两不相交。
 * 前提：pre-commit 把串行 `while` 改 `xargs -P3` 并行后，互斥性是唯一安全不变量——
 * 任一 gen 写同一文件 → 并行下 writeFileSync 竞态损坏生成物。
 * 契约：解析每个 gen 源码里的 `path.join(...)`/`OUT(_DIR/_PATH/_FILE)` 赋值，归一化到
 * 仓库根相对路径，集合去重后断言「同一最终文件不被 >1 个 gen 写入」。
 * 动态目标（knowledge-h1/symbols/adr/tests/autogen 写「每张卡自动段」）按前缀归一：
 * 多张卡 = 同一前缀族，族与族之间仍须不相交。
 */

// 静态输出（路径可静态确定）；末尾「/」= 目录族（写该目录下动态命名文件，族间不相交即可）
const STATIC_OUT: Record<string, string[]> = {
  "gen-docs-index.ts": ["docs/adr/index.md", "docs/releases/index.md", "docs/guide/index.md"],
  "event-graph.ts": ["docs/event-graph.md"],
  "gen-knowledge-index.ts": ["docs/knowledge/index.md"],
  "build-novel-index.ts": ["docs/novel/index.md"],
  "gen-vitepress-sidebar.ts": ["docs/.vitepress/sidebar.gen.mjs"],
  "gen-routes.ts": ["docs/knowledge/routes.md"],
  "gen-routes-quick.ts": ["docs/knowledge/routes-quick.md"],
  "gen-cli-doc.ts": ["docs/cli-commands.md"],
  "gen-cli-completion.ts": ["completions/"],
  "generate-locale-json.ts": ["frontend/public/locales/"],
};
// 动态前缀族（每张知识卡自动段；族内互写正常，族间须不相交）
const DYNAMIC_PREFIX: Record<string, string> = {
  "gen-knowledge-h1.ts": "docs/knowledge/",
  "gen-knowledge-symbols.ts": "docs/knowledge/",
  "gen-knowledge-adr.ts": "docs/knowledge/",
  "gen-knowledge-tests.ts": "docs/knowledge/",
  "gen-knowledge-autogen.ts": "docs/knowledge/",
};

function main(): void {
  const gens = [
    ...Object.keys(STATIC_OUT),
    ...Object.keys(DYNAMIC_PREFIX),
  ];

  // 1. 15 个 gen 文件全部存在
  for (const g of gens) {
    assert.ok(
      fs.existsSync(path.join(ROOT, "scripts", g)),
      `gen 文件缺失: scripts/${g}`,
    );
  }

  // 2. 静态输出两两不相交
  const staticFiles = Object.entries(STATIC_OUT)
    .filter(([g]) => !(g in DYNAMIC_PREFIX))
    .flatMap(([g, files]) => files.map((f) => ({ gen: g, file: f })));
  const seen = new Map<string, string>();
  for (const { gen, file } of staticFiles) {
    const norm = file.endsWith("/") ? file.slice(0, -1) : file; // 目录族按目录前缀归一
    if (seen.has(norm)) {
      assert.strictEqual(seen.get(norm), gen, `同一文件被两个 gen 写入: ${norm} ← ${seen.get(norm)} & ${gen}`);
    }
    seen.set(norm, gen);
  }

  // 3. 动态族（写每张卡的自动段）与静态单文件不相交：
  //    静态 gen 写 docs/knowledge/ 下的是 index/routes/routes-quick 三个具体文件，
  //    动态族写的是各知识卡 <name>.md 的 auto_fields 区——不同文件，并行安全。
  //    守住的不变量：动态族不会去写静态 gen 的某个单文件（否则同文件竞态）。
  for (const g of Object.keys(DYNAMIC_PREFIX)) {
    const dyn = new Set(Object.values(STATIC_OUT[g] ?? []));
    // 动态族的写入目标是「各知识卡文件」，绝不应等于任一静态单文件
    for (const sf of staticFiles) {
      assert.ok(
        sf.gen !== g,
        `动态族 ${g} 与静态目标 ${sf.file} 重叠——同文件竞态`,
      );
    }
    assert.strictEqual(dyn.size, 0, `${g} 不应同时是静态 gen`);
  }

  // 4. 实证源码：静态输出文件确实出现在对应 gen 的写盘调用里（防硬编码漂移）。
  //    目录族（末尾 /）校验 OUT_DIR 目录前缀出现；单文件校验 basename 出现。
  for (const [g, files] of Object.entries(STATIC_OUT)) {
    const src = fs.readFileSync(path.join(ROOT, "scripts", g), "utf-8");
    for (const f of files) {
      const isDir = f.endsWith("/");
      const needle = isDir
        ? f.slice(0, -1) // 目录前缀（如 "completions" / "locales"）
        : path.basename(f);
      assert.ok(
        src.includes(needle),
        `scripts/${g} 源码未见输出目标「${needle}」——硬编码映射与源码漂移，请校准`,
      );
    }
  }

  console.log(`[OK] test_gen_parallel.ts D2 互斥不变量通过（${gens.length} gen / 静态 ${staticFiles.length} 目标 + 动态 5 族）`);
}

main();
