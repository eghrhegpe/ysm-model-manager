#!/usr/bin/env node
/**
 * Markdown 链接检查。扫所有 md 文件，验证内部链接目标是否存在。
 * 由 scripts/link-checker.py 迁移（2026-08-03），逻辑逐点保真。
 * link-checker.ts — 文档链接检查器
 * 设计意图：文档链接检查器
 * 依赖：node:fs / node:path / node:url
 * 用法：
 *   node scripts/link-checker.ts                 # 默认行为
 *   node scripts/link-checker.ts --json # JSON 输出（CI/子代理消费）
 * 退出码：0（成功）
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, toPosix } from "./_lib/scan-files.ts";

const SKIP_DIRS = new Set([
  "node_modules",
  "archive",
  ".git",
  "vendor",
  "upstream",
  "build",
  "dist",
]);
const SKIP_FILES = new Set([".doc-next-steps.md"]); // 自动生成产物，引用路径可能过期，不应计入断链

/**
 * 扫描域判定（纯函数）：仓库根相对 posix 路径 → 是否纳入链接检查。
 * 只收 `.md`，且路径任一段不得命中 SKIP_DIRS、文件名不得命中 SKIP_FILES。
 */
export function isScannable(rel: string): boolean {
  if (!rel.endsWith(".md")) return false;
  const parts = toPosix(rel).split("/");
  const base = parts[parts.length - 1] ?? "";
  if (SKIP_FILES.has(base)) return false;
  return !parts.some((s) => SKIP_DIRS.has(s));
}

/** git 跟踪文件的仓库根相对 posix 路径；git 不可用 → null。 */
function trackedRelPaths(): string[] | null {
  try {
    const out = execFileSync("git", ["-c", "core.quotepath=false", "ls-files", "-z"], {
      cwd: ROOT,
      encoding: "utf-8",
      maxBuffer: 128 * 1024 * 1024,
    });
    return out
      .split("\0")
      .filter(Boolean)
      .map((p) => toPosix(p));
  } catch {
    return null;
  }
}

/**
 * 扫描目标枚举：**扫描域 = git 跟踪的 `.md`**（2026-09-15 修，见 ADR-244）。
 *
 * 原实现是裸 `readdir` 工作树 ⇒ 任何人往仓库里丢一个**未跟踪** md 就能拦住全仓推送
 * （实证：并行 agent 落在仓库根的 `SOUL.md` / `TOOLS.md` 带 `/concepts/soul` 模板链接，
 * 3 条断链把推送卡住，与本笔改动毫无关系）。门禁只该检查**仓库里的**文档——
 * 未跟踪 / 被忽略文件不参与，其生命周期由各自工具负责。
 * git 不可用（导出的 tarball 等）→ 退回文件树 walk，并以 `source` 标注留痕（调用方打印告警）。
 * @returns `source: "git"` = 权威路径；`"walk"` = 退化路径（未跟踪文件会重新进入扫描域）
 */
export function listScanTargets(): { rels: string[]; source: "git" | "walk" } {
  const tracked = trackedRelPaths();
  if (tracked) {
    // 口径 = 索引 ∩ 可扫 ∩ 磁盘存在：被跟踪但工作区缺失的 md（并行会话删除未 add、
    // 手工误删）若进扫描域，extractLinks 的 readFileSync 进 catch 返空 + 锚点恒 0，
    // 该文件断链全盲 ⇒ links_broken:0 假绿（review 2d51556ba P2）
    return {
      rels: tracked.filter((r) => isScannable(r) && fs.existsSync(path.join(ROOT, r))),
      source: "git",
    };
  }
  const rels = walkMd(ROOT)
    .map((f) => toPosix(path.relative(ROOT, f)))
    .filter(isScannable);
  return { rels, source: "walk" };
}

function walkMd(dir: string) {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    if (SKIP_FILES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMd(full));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

function extractLinks(filepath: string) {
  /** 提取 md 文件中的 Markdown 链接。 */
  const links: [string, string, number][] = [];
  let text: string;
  try {
    text = fs.readFileSync(filepath, "utf-8");
  } catch {
    return links;
  }

  // 在原文上匹配，position 即原文偏移（供 gen-doc-next-steps 的 file#line 直跳）；
  // fenced 代码块（```...```）内的链接跳过（示例链接如 adr 占位章节路径不判断链），
  // 而非先剥离再匹配——剥离会让 position 与原文错位、行号系统性偏移（code_review P2-1）
  const re = /\[([^\]]*)\]\(([^)\s]+(?:\s+"[^"]*")?)\)/g;
  let m = re.exec(text);
  while (m !== null) {
    if (insideFence(text, m.index)) {
      // 位于 fenced 代码块内 → 跳过
      m = re.exec(text);
      continue;
    }
    const linkText = m[1]!;
    const rawPath = m[2]?.split(/\s+/)[0] ?? ""; // 去掉 title 部分
    links.push([linkText, rawPath, m.index]);
    m = re.exec(text);
  }
  return links;
}

/** 判断给定字符偏移是否位于 fenced 代码块（```...```）内：统计到 pos 为止的 ``` 围栏数，奇数即在块内。 */
function insideFence(text: string, pos: number) {
  const upTo = text.slice(0, pos);
  const fences = (upTo.match(/^```/gm) || []).length;
  return fences % 2 === 1;
}

function resolvePath(filepath: string, rawPath: string) {
  /** 将 Markdown 相对路径解析为实际文件系统路径，并分离 `#anchor`（批次4 P3：锚点此前被丢弃不校验）。 */
  if (rawPath.startsWith("http://") || rawPath.startsWith("https://")) return null; // 外部链接跳过
  if (rawPath.startsWith("file://")) return null; // 源码引用(file://...)非文档链接，跳过
  if (rawPath.startsWith("#")) return null; // 纯页内锚点（同一文件的标题跳转，不校验）
  if (/[<>]/.test(rawPath)) return null; // 占位符链接（如 <page>-<n>.png）非真实链接，跳过
  const hashIdx = rawPath.indexOf("#");
  const anchor = hashIdx !== -1 ? rawPath.slice(hashIdx + 1) : "";
  const cleanPath = hashIdx !== -1 ? rawPath.slice(0, hashIdx) : rawPath;
  let candidate: string;
  if (cleanPath.startsWith("/")) {
    // 绝对路径从项目根开始
    candidate = path.join(ROOT, cleanPath.replace(/^\/+/, ""));
  } else {
    // 相对路径从文件目录开始
    candidate = path.join(path.dirname(filepath), cleanPath);
  }
  candidate = path.resolve(candidate);
  return { path: candidate, anchor };
}

/**
 * 收集 md 文件的标题锚点集合（vitepress 规则）：
 * `## 标题 {#custom}` 取自定义 id；普通标题生成 slug（去标点、空格→连字符、小写）。
 * 中文标题另加「原文无空格」候选——vitepress 对纯中文标题的 anchor 即原文。
 */
function collectAnchors(mdFile: string) {
  const anchors = new Set<string>();
  let text: string;
  try {
    text = fs.readFileSync(mdFile, "utf8");
  } catch {
    return anchors;
  }
  for (const line of text.split("\n")) {
    const m = line.match(/^#{1,6}\s+(.+)$/);
    if (!m) continue;
    const title = m[1]?.trim() ?? "";
    const custom = title.match(/\{#([A-Za-z0-9_-]+)\}\s*$/);
    if (custom) {
      anchors.add(custom[1]!);
      continue;
    }
    const textOnly = title.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "");
    const slug = textOnly
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-");
    if (slug) anchors.add(slug);
    const zh = textOnly.replace(/[^\p{Script=Han}]/gu, "").trim();
    if (zh) anchors.add(zh);
  }
  return anchors;
}

function checkLinks(files: string[]): [number, any[]] {
  /** 检查文件列表中的所有内部链接。 */
  const broken: any[] = [];
  let okCount = 0;
  for (const fp of files) {
    for (const [text, rawPath, pos] of extractLinks(fp)) {
      const resolved = resolvePath(fp, rawPath);
      if (resolved === null) continue; // 外部链接 / 页内锚点
      if (fs.existsSync(resolved.path)) {
        // 跨文件锚点校验：目标 md 存在但 #anchor 无对应标题 → 断链（此前漏检，批次4 P3）
        if (
          resolved.anchor &&
          resolved.path.toLowerCase().endsWith(".md") &&
          !collectAnchors(resolved.path).has(resolved.anchor)
        ) {
          const rel = path.relative(ROOT, fp);
          broken.push({
            file: rel,
            position: pos,
            link_text: text,
            raw_path: rawPath,
            resolved_path: resolved.path,
            type: "anchor",
            anchor: resolved.anchor,
          });
          continue;
        }
        okCount += 1;
      } else {
        const rel = path.relative(ROOT, fp);
        broken.push({
          file: rel,
          position: pos,
          link_text: text,
          raw_path: rawPath,
          resolved_path: resolved.path,
          type: "file",
        });
      }
    }
  }
  return [okCount, broken];
}

function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const strict = args.includes("--strict"); // 门禁模式：断链即 exit 1，可接 CI 卡点
  // P1 修复（子代理审计）：未知 flag 静默忽略会让 `--stric` 拼错悄悄关闭门禁
  // （脚本照常输出断链数但 exit 0）——显式白名单拦截，拼错即退 1
  const KNOWN_FLAGS = new Set(["--json", "--strict", "--help", "-h"]);
  const unknownFlags = args.filter((a) => a.startsWith("--") && !KNOWN_FLAGS.has(a));
  if (unknownFlags.length) {
    console.error(`[link-checker] 未知 flag: ${unknownFlags.join(", ")}（支持 --json / --strict）`);
    process.exit(1);
  }

  // 扫描域 = git 跟踪的 .md（2026-09-15，见 ADR-244）：未跟踪文件不参与扫描
  const { rels, source } = listScanTargets();
  const files = rels.map((r) => path.join(ROOT, r));
  if (source === "walk") {
    console.error(
      "[link-checker] ⚠️ git 不可用，已退回文件树扫描：未跟踪的 md 会重新进入扫描域，结果可能受工作区杂物影响",
    );
  }

  const [ok, broken] = checkLinks(files);

  if (jsonMode) {
    const out = {
      _summary: {
        files_scanned: files.length,
        links_ok: ok,
        links_broken: broken.length,
        scan_source: source,
      },
      broken_links: broken,
    };
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    // 门禁模式：断链即 exit 1（--json --strict 下同样生效，doctor.ts 352 用 rc 判定）
    process.exit(strict && broken.length ? 1 : 0);
  }

  process.stdout.write(
    `扫描 ${files.length} 个 md 文件（域: ${source === "git" ? "git 跟踪文件" : "文件树 walk"}）\n有效链接: ${ok}, 断链: ${broken.length}\n\n`,
  );
  if (broken.length) {
    for (const b of broken) {
      process.stdout.write(`  [BROKEN] ${b.file}: 链接 \`${b.link_text}\` -> \`${b.raw_path}\`\n`);
    }
    process.stdout.write(`\n共 ${broken.length} 条断链\n`);
  } else {
    process.stdout.write("全部链接有效\n");
  }

  // 门禁模式：存在断链则非零退出（可接 CI 卡点）；--strict 未启用时仅信息展示
  process.exit(strict && broken.length ? 1 : 0);
}

// 仅当作为入口直接执行时才跑主流程（被契约测试 import 时不触发，避免误退出）
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
