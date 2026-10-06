#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { finish, ok, runScript } from "./_lib.mts";

// gen-knowledge-autogen「输入消失 → 派生块回收」契约。
// 实证：extensibility-round2.md 删掉 source_files 后 gen 报「已是最新，无需修改」，
// 278 行 tests(26) + auto_fields.symbols_with_lines(252) 残留——gen 只按符号名增删，
// 从不在输入消失时删除整块。本卡是孤例（全库 --check 实测零残留）。
// 隔离策略：临时卡目录 + --kc-dir（同 check-knowledge-* 家族范式）。

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ysm-autogen-stale-"));
const CARD = "zzz-autogen-stale-tmp.md";

// 无 source_files 卡的 frontmatter 头部（含一条注释——回收时不得被吞）
const HEAD = [
  "---",
  "kind: zzz-autogen-stale-tmp",
  "name: autogen 残留回收契约临时卡",
  "tier: leaf",
  "category: utils",
  "# 治理注记：此处是 YAML 注释，回收时必须保留",
  "status: snapshot",
  "affected: false",
].join("\r\n");

const TAIL = "\r\ninvariant_anchors:\r\n  - go/types/registry/extensions.go|ShouldHashExt\r\n---\r\n\r\n# 正文\r\n";

function writeCard(withSources: boolean, withStale: boolean) {
  const fm = [HEAD];
  if (withSources) fm.push("source_files:", "  - frontend/src/utils/base/pure/array.ts");
  if (withStale)
    fm.push(
      "tests:",
      "  - frontend/src/utils/base/pure/array.test.ts",
      "auto_fields:",
      "  symbols_with_lines:",
      "    - SymbolA",
      "    - SymbolB",
    );
  fs.writeFileSync(path.join(TMP_DIR, CARD), fm.join("\r\n") + TAIL, "utf8");
}

function runCheck() {
  return runScript("gen-knowledge-autogen.ts", "--check", "--kc-dir", TMP_DIR);
}

console.log("=== gen-knowledge-autogen 派生块回收契约 ===");

try {
  // 1. 无 source_files + 残留 tests/auto_fields → --check 退出 1 且点名
  writeCard(false, true);
  let r = runCheck();
  ok("残留派生块 → --check 退出 1", r.status === 1, `status=${r.status} stderr=${r.stderr?.slice(0, 150)}`);
  ok(
    "报错点名卡名并列出 tests / auto_fields",
    (r.stderr || "").includes(CARD) && (r.stderr || "").includes("tests"),
    `stderr=${r.stderr?.slice(0, 200)}`,
  );

  // 2. 跑 gen（非 check）→ 两个派生块回收，注释与 invariant_anchors 原样保留
  r = runScript("gen-knowledge-autogen.ts", "--kc-dir", TMP_DIR);
  ok("gen 执行退出 0", r.status === 0, `stderr=${r.stderr?.slice(0, 150)}`);
  const text = fs.readFileSync(path.join(TMP_DIR, CARD), "utf8");
  ok("tests 块已回收", !/^tests:/m.test(text), `残留: ${(text.match(/^tests:.*$/m) || []).join()}`);
  ok(
    "auto_fields 块已回收",
    !/^auto_fields:/m.test(text),
    `残留: ${(text.match(/^auto_fields:.*$/m) || []).join()}`,
  );
  ok("派生符号已清空", !text.includes("SymbolA") && !text.includes("SymbolB"), "符号残留");
  ok("YAML 注释保留", text.includes("# 治理注记：此处是 YAML 注释，回收时必须保留"), "注释被吞");
  ok("invariant_anchors 保留", text.includes("ShouldHashExt"), "机制锚丢失");
  ok(
    "frontmatter 结构与正文完好",
    /^---\r?\n[\s\S]*?\n---\s+# 正文/.test(text),
    "分隔符/正文损坏",
  );

  // 3. 回收后 --check 幂等
  r = runCheck();
  ok("回收后 --check 退出 0", r.status === 0, `status=${r.status} stderr=${r.stderr?.slice(0, 150)}`);

  // 4. 无 source_files 且无残留 → 不误报
  writeCard(false, false);
  r = runCheck();
  ok("无残留 → --check 退出 0", r.status === 0, `status=${r.status} stderr=${r.stderr?.slice(0, 150)}`);

  // 5. 有 source_files + 残留 → 不误判为「无来源残留」（交正常增删漂移路径接管）
  writeCard(true, true);
  r = runCheck();
  ok(
    "有 source_files 时不误报「无来源残留」",
    !(r.stderr || "").includes(`${CARD} → 无 source_files`),
    `stderr=${r.stderr?.slice(0, 200)}`,
  );
} finally {
  if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true, force: true });
}

finish("gen-knowledge-autogen 派生块回收契约全过");
