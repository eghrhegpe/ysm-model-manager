#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { finish, ok, runScript } from "./_lib.mts";

const _ROOT = process.cwd();

// 隔离策略同 check-knowledge-perf-tags：临时卡写系统临时目录，
// 经 --kc-dir 指向，避免生成器 glob 到它污染生成物。
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ysm-bodyref-contract-"));
const TMP_CARD = path.join(TMP_DIR, "zzz-body-line-refs-tmp.md");
const CARD_STEM = "zzz-body-line-refs-tmp";

function writeTmpCard(bodyExtraLines: string[] = [], fmExtraLines: string[] = []) {
  const fm = [
    "---",
    `kind: ${CARD_STEM}`,
    "name: 正文行号引用契约测试临时卡",
    "tier: leaf",
    "category: utils",
    "source_files:",
    "  - frontend/src/utils/base/pure/array.ts",
    "use_when:",
    "  - 临时测试",
    "auto_fields:",
    "  symbols_with_lines:",
    "    - SomeLegacySymbol:42",
    ...fmExtraLines,
    "---",
    "",
    `# 正文行号引用契约测试临时卡`,
    "",
    "## 概览",
    "",
    "契约测试用临时卡，测完即删。",
    "",
    ...bodyExtraLines,
    "",
  ].join("\r\n");
  fs.writeFileSync(TMP_CARD, fm, "utf8");
}

function runDrift() {
  const r = runScript("check-knowledge-drift.ts", "--json", "--kc-dir", TMP_DIR);
  let out = { errors: [], warns: [] };
  try {
    out = r.stdout ? JSON.parse(r.stdout) : out;
  } catch {
    /* 解析失败保持空 */
  }
  return { status: r.status, out };
}

console.log("=== 知识卡正文行号/行数/计数硬编码引用契约 ===");

try {
  // 1. 正文干净 → 无此 WARN
  writeTmpCard();
  let { status, out } = runDrift();
  ok(
    "干净正文无 body-line 相关 WARN",
    !out.warns.some((w) => w.includes(CARD_STEM) && w.includes("行号")),
    `不应出现正文行号 WARN: ${out.warns.join("; ").slice(0, 200)}`,
  );
  ok("干净正文退出码 0", status === 0, `status=${status}`);

  // 2. frontmatter 旧 `:NN` 格式不误报（ADR-162 兼容旧卡）
  writeTmpCard(["此卡 frontmatter 带 SomeLegacySymbol:42，正文不应误报。"]);
  ({ status, out } = runDrift());
  ok(
    "frontmatter :NN 不误报正文行号",
    !out.warns.some((w) => w.includes(CARD_STEM) && w.includes("行号")),
    `frontmatter :NN 不应触发正文行号 WARN: ${out.warns.join("; ").slice(0, 200)}`,
  );

  // 3. 正文含 L123（单行号）
  writeTmpCard(["`mount3D` 入口（L123）捕获本次代数。"]);
  ({ status, out } = runDrift());
  ok(
    "正文 L123 → WARN 且带卡名+行号",
    !!out.warns.some((w) => w.includes(CARD_STEM) && w.includes("L123")),
    `期望 WARN 含卡名与 L123: ${out.warns.join("; ").slice(0, 300)}`,
  );
  ok("WARN 级不阻断 → 退出码 0", status === 0, `status=${status}`);

  // 4. 正文含行号区间 L100-200
  writeTmpCard(["函数本体 L100-200 仍超 100 行红线。"]);
  ({ status, out } = runDrift());
  ok(
    "正文 L100-200 区间 → WARN",
    out.warns.some((w) => w.includes(CARD_STEM)),
    `期望 WARN: ${out.warns.join("; ").slice(0, 300)}`,
  );

  // 5. 正文含行数引用「123 行」
  writeTmpCard(["mount-preview-core.ts 现 888 行，mount3D 本体 527 行。"]);
  ({ status, out } = runDrift());
  ok(
    "正文「888 行」行数 → WARN",
    out.warns.some((w) => w.includes(CARD_STEM)),
    `期望 WARN: ${out.warns.join("; ").slice(0, 300)}`,
  );

  // 6. 正文含计数「8 个能力」
  writeTmpCard(["`createAll()` 创建 8 个能力（天空/地面/环境/雾）。"]);
  ({ status, out } = runDrift());
  ok(
    "正文「8 个能力」计数 → WARN",
    out.warns.some((w) => w.includes(CARD_STEM)),
    `期望 WARN: ${out.warns.join("; ").slice(0, 300)}`,
  );

  // 6.5. 语义误报豁免：这些是描述性事实而非会漂移的导航行号
  writeTmpCard([
    "求值闭包见 ADR-100 L4 与 ADR-100 L1-L3（ADR 章节引用）。",
    "对账摘要须控制在 ≤15 行以内。",
    "bridge_windows.go 约 ~137 行的规模估算。",
    "sample 已从 1504→827 行收缩（历史变化记录）。",
    "第三方实现区间：AO 在 301–360 行、tint 在 9–30 行。",
    "新增设置项不超过 20-30 行闭包。",
  ]);
  ({ status, out } = runDrift());
  ok(
    "ADR 章节引用 / ≤上限 / ~估算 / →历史变化 / –区间 / N-M 范围 均不报",
    !out.warns.some((w) => w.includes(CARD_STEM)),
    `豁免失败: ${out.warns
      .filter((w) => w.includes(CARD_STEM))
      .join(" | ")
      .slice(0, 300)}`,
  );

  // 7. 正文含符号引用（文件|符号）→ 不误报
  writeTmpCard(["入口见 `mount-preview-core.ts|mount3D`，签名不动（回归红线）。"]);
  ({ status, out } = runDrift());
  ok(
    "正文「文件|符号」引用不误报",
    !out.warns.some((w) => w.includes(CARD_STEM)),
    `文件|符号引用不应触发 WARN: ${out.warns.join("; ").slice(0, 200)}`,
  );

  // 8. WARN 文案应包含改写指引（ADR-162 精神）
  writeTmpCard(["入口见 L123。"]);
  ({ status, out } = runDrift());
  const hint = out.warns.find((w) => w.includes(CARD_STEM) && w.includes("L123")) || "";
  ok(
    "WARN 含改写指引（文件|符号）",
    hint.includes("文件") && hint.includes("符号"),
    `期望指引「文件|符号」: ${hint.slice(0, 300)}`,
  );

  // 9. 正文含 `---` 水平线（markdown 分隔线）后仍须扫描（5.9 解析器回归：旧实现 toggle
  //    误判水平线为 frontmatter 重开，分隔线后整段正文漏扫——mount3d-584-giant 实证假绿）
  writeTmpCard(["正文甲。", "---", "分隔线后的正文 L123 引用。"]);
  ({ status, out } = runDrift());
  ok(
    "水平线后的正文 L123 仍须 WARN",
    !!out.warns.some((w) => w.includes(CARD_STEM) && w.includes("L123")),
    `期望分隔线后的 L123 被扫到: ${out.warns.join("; ").slice(0, 300)}`,
  );
  ok("水平线用例退出码 0（WARN 不阻断）", status === 0, `status=${status}`);

  // 9.5. 层级符号豁免：L1/L2/L3 后跟「空白+ASCII 字母或反引号」是层级枚举非行号
  //      （model3d 解码拷贝链 L1 base64 / L2 `atob` 串实证；L0 游戏层级早已豁免）
  writeTmpCard(["L1 base64 串 + L2 `atob` 串 + L3 `charCodeAt` 拷贝 = 4.33N。"]);
  ({ status, out } = runDrift());
  ok(
    "层级符号 L1/L2/L3 不误报",
    !out.warns.some((w) => w.includes(CARD_STEM) && w.includes("行号")),
    `层级符号不应触发 WARN: ${out.warns.join("; ").slice(0, 200)}`,
  );

  // 10. frontmatter 人工字段（quick_risk_lines）行号引用 → 5.10 WARN（注入速查表的一跳层）
  writeTmpCard([], ["quick_risk_lines:", "  - mount3D 本体 527 行（L351-877，预置顶复核节实测）"]);
  ({ status, out } = runDrift());
  ok(
    "frontmatter quick_risk_lines 行号 → WARN 且注明 frontmatter",
    !!out.warns.some((w) => w.includes(CARD_STEM) && w.includes("frontmatter")),
    `期望 frontmatter WARN: ${out.warns.join("; ").slice(0, 300)}`,
  );

  // 10.5. frontmatter 定性描述（无行号）不误报
  writeTmpCard([], ["quick_risk_lines:", "  - 仍超 100 行红线，勿写死行号"]);
  ({ status, out } = runDrift());
  ok(
    "frontmatter 定性描述不误报",
    !out.warns.some((w) => w.includes(CARD_STEM)),
    `定性描述不应触发 WARN: ${out.warns.join("; ").slice(0, 200)}`,
  );
  // 11. 冒号形行号（2026-10-06 补网）：`文件名.ext:行号` 是仓内最主流的硬编码形态，
  //     此前三个分支只认 L123 / N 行 / N 个X，冒号形完全失明
  //     →「0 WARN 与 18 处实际违规共存」（知识库锐评实证）
  writeTmpCard(["remaining 所有权归 Go 载荷（queue.go:254——末文件 left=0），前端禁止本地递减。"]);
  ({ status, out } = runDrift());
  ok(
    "正文冒号形 `queue.go:254` → WARN",
    out.warns.some((w) => w.includes(CARD_STEM) && w.includes("queue.go:254")),
    `期望 WARN 含卡名与 queue.go:254: ${out.warns.join("; ").slice(0, 300)}`,
  );
  ok("冒号形 WARN 级不阻断 → 退出码 0", status === 0, `status=${status}`);

  // 12. 冒号形行号区间 / 目录前缀 / L 前缀
  writeTmpCard([
    "释放链见 watcher.go:268-280。",
    "装配入口见 frontend/src/utils/base/pure/array.ts:L12。",
    "并发基准见 bench_concurrent_json.go:77。",
  ]);
  ({ status, out } = runDrift());
  ok(
    "正文冒号形区间形态 → WARN",
    out.warns.some((w) => w.includes(CARD_STEM) && w.includes("watcher.go:268-280")),
    `期望 WARN 含区间形态: ${out.warns.join("; ").slice(0, 300)}`,
  );

  // 13. 冒号形豁免：无数字的裸文件名 / URL / 版本号 / 非源码扩展名（.md 章节结构稳定，
  //     不随源码漂移，且 ADR 的 L 形已单列豁免）/ 文件|符号 锚定形态
  writeTmpCard([
    "裸文件名 queue.go 见上节。",
    "示例地址 http://example.com:27 不含冒号行号。",
    "版本 v1.2.3:27 不是源码行号。",
    "文档章节 ADR-042.md:34 不入治理范围。",
    "锚定写法 `mount-preview-core.ts|mount3D` 是机器可验形态。",
  ]);
  ({ status, out } = runDrift());
  ok(
    "裸文件名/URL/版本号/.md/文件|符号 均不误报冒号形",
    !out.warns.some((w) => w.includes(CARD_STEM) && w.includes("行号")),
    `冒号形豁免失败: ${out.warns
      .filter((w) => w.includes(CARD_STEM))
      .join(" | ")
      .slice(0, 300)}`,
  );

  // 14. 冒号形进入 frontmatter 人工字段（5.10）：quick_risk_lines 原样注入速查表，
  //     是一跳层，行坐标漂移比正文更值得护栏
  writeTmpCard([], [
    "quick_risk_lines:",
    "  - 后处理门禁写死在 postprocessing-capability.ts:147，勿绕过",
  ]);
  ({ status, out } = runDrift());
  ok(
    "frontmatter quick_risk_lines 冒号形 → 5.10 WARN",
    out.warns.some(
      (w) =>
        w.includes(CARD_STEM) &&
        w.includes("frontmatter") &&
        w.includes("postprocessing-capability.ts:147"),
    ),
    `期望 frontmatter 冒号形 WARN: ${out.warns.join("; ").slice(0, 300)}`,
  );

} finally {
  if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true, force: true });
}

finish("知识卡正文行号引用契约全过");
