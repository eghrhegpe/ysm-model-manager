#!/usr/bin/env node
/**
 * test_check_knowledge_content.ts — 知识卡正文机制声明漂移探针契约测试。
 *
 * 锁 `check-knowledge-content.ts` 的核心纯逻辑：
 *   - `extractAnchors`：从卡正文抽「`文件`(`符号`)」与「`文件`|符号」两种锚定形态，
 *     且路径组必须含 `/`（与纯反引号符号 / 中文反引号短句区分，防误报）。
 *   - 跳过 frontmatter（不重复 invariant_anchors 校验）。
 *   - 不把非源码路径（`resource_types.json`、README.md、ADR-NNN）当锚。
 *
 * 运行：node tests/test_check_knowledge_content.ts
 * 用 assert 实现（不计走测试框架）；失败 exit 1。
 */
import assert from "node:assert/strict";
import { extractAnchors } from "../scripts/check-knowledge-content.ts";

// ─── 1) 两种形态都抽出 ─────────────────────────────
{
  const body = [
    "实现锚在 `frontend/src/foo.ts`（`buildTree`） 行内。",
    "另见 `go/cli/bar.go`|RunCmd 的调用。",
  ].join("\n");
  const a = extractAnchors(body);
  assert.equal(a.length, 2, "两种形态各抽 1 个");
  assert.deepEqual(
    a.map((x) => x.file).sort(),
    ["frontend/src/foo.ts", "go/cli/bar.go"].sort(),
    "文件路径正确",
  );
  assert.deepEqual(
    a.map((x) => x.symbol).sort(),
    ["RunCmd", "buildTree"].sort(),
    "符号正确",
  );
}

// ─── 2) 路径必须含 /，纯符号/中文短句不误报 ───────────
{
  const body = [
    "调用 `OpenFolder` 打开选择器。",
    "`里的 Molang 字符串编译为` 表达式。",
    "返回 `资源列表`。",
  ].join("\n");
  const a = extractAnchors(body);
  assert.equal(a.length, 0, "无合法路径前缀的纯反引号/中文短句不抽锚");
}

// ─── 3) 非源码路径（.json/.md/ADR）不抽锚 ─────────────
{
  const body = [
    "事实源 `resource_types.json` 与 `README.md`。",
    "见 `ADR-146` 决策。",
    "合法锚 `frontend/src/x.ts`（`sym`）。",
  ].join("\n");
  const a = extractAnchors(body);
  assert.equal(a.length, 1, "仅合法源码锚被抽");
  assert.equal(a[0]!.file, "frontend/src/x.ts");
}

// ─── 4) frontmatter 内锚不抽（避免重复 invariant_anchors）──
{
  const text = [
    "---",
    "invariant_anchors:",
    "  - frontend/src/y.ts|symInside",
    "---",
    "# 标题",
    "正文锚 `frontend/src/z.ts`（`symBody`）。",
  ].join("\n");
  const a = extractAnchors(text);
  assert.equal(a.length, 1, "只抽正文锚，frontmatter 内不抽");
  assert.equal(a[0]!.file, "frontend/src/z.ts");
}

// ─── 5) 竖线形态允许裸符号（含点号成员）───────────────
{
  const body = "配置 `frontend/src/cfg.ts`|app.state.theme 读取。";
  const a = extractAnchors(body);
  assert.equal(a.length, 1, "点号成员符号可抽");
  assert.equal(a[0]!.symbol, "app.state.theme");
}

console.log("✅ test_check_knowledge_content 全部通过");
