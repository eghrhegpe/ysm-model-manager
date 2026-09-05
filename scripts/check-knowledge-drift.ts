#!/usr/bin/env node
/**
 * check-knowledge-drift.ts — 知识卡漂移检查器（适配搬运自 MikuMikuAR）。
 *
 * 零依赖（仅 node:fs / node:path / node:url）。
 *
 * 检查项（适配 YSM 规模，去掉了 ADR/符号覆盖率/状态索引等不相关项）：
 *   [ERROR] 知识卡 source_files 指向磁盘不存在的文件
 *   [ERROR] 知识卡 source_files 路径格式非法（反斜杠 / 绝对路径 / .. 逃逸，必须仓库相对 POSIX）
 *   [WARN]  知识卡 source_files 指向生成物（bindings/dist/node_modules）→ 非源码事实源
 *   [WARN]  知识卡 source_files 指向测试文件 → 实现应放 source_files，测试放 tests:
 *   [ERROR] 知识卡 frontmatter 必填字段缺失（kind/name/category）
 *   [ERROR] 知识卡 category / tier 值域违规
 *   [ERROR] 知识卡 kind 非 kebab-case/snake_case（小写，允许 - 与 _）或含未填充占位符 <...>
 *   [WARN]  H1 标题与 name 不一致
 *   [WARN]  AGENTS.md 含手写事实索引（├──/└── 目录树）
 *   [WARN]  知识卡正文含硬编码行号/行数/计数引用（ADR-162 精神：正文引用一律「文件|符号」，行坐标会漂移）
 *   [ERROR] 幽灵卡：docs/knowledge/ 下无 YAML frontmatter 的 .md 文件（排除 KNOWLEDGE_NON_CARDS）
 *   [ERROR] 索引文件（index.md）链接指向不存在的卡
 *
 * 用法：
 *   node scripts/check-knowledge-drift.ts                  # 文本报告（被动：卡间/卡→源码引用漂移）
 *   node scripts/check-knowledge-drift.ts --verbose         # 文本报告 + 未覆盖文件完整清单
 *   node scripts/check-knowledge-drift.ts --json           # JSON（CI 用，doctor --docs 调用）
 *   node scripts/check-knowledge-drift.ts --affected <f>…  # 主动：源码变更即列出受影响知识卡（治未病）
 *     # 常与 git 联动：git diff --name-only | xargs -I{} node scripts/check-knowledge-drift.ts --affected {}
 *     # 卡 frontmatter 声明 affected: false（快照/报告型卡）→ 不参与匹配，source_files 只服务覆盖率统计
 *
 * 退出码：发现 ERROR → 1；否则 0（WARN 不阻断；--affected 恒为 0）。
 * 设计意图：知识卡漂移检查（与代码现实比对）+ 源码变更主动防御。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, walk } from './_lib/scan-files.ts';
import { toPosix } from './_lib/to-posix.ts';
import { parseFrontmatter, getScalar, getList, parseSourceFiles, getAllScalars } from './_lib/frontmatter.ts';
import { PERF_TAGS, KNOWLEDGE_NON_CARDS, KNOWLEDGE_ORDER } from './_lib/knowledge-cards.ts';
import { parseArgs } from './_lib/parse-args.ts';
import { stripBom, hasFrontmatterDelimiter, getUntrackedCards, missingRequiredCardFields } from './_lib/knowledge-common.ts';

// 参数解析统一走 _lib/parse-args（positional 脚本契约：未知 flag 白名单拦截）
// --kc-dir：隔离模式，指向临时知识卡目录（契约测试用，避免临时卡污染 docs/knowledge/ 生成物）
const ARGS = parseArgs(process.argv.slice(2), { bools: ['json', 'verbose', 'quiet', 'affected'], strings: ['files', 'kc-dir'] });
if (ARGS.help) {
  console.log('用法: node scripts/check-knowledge-drift.ts [--json|--verbose|--affected <f>…|--quiet]');
  console.log('  --json      机读 JSON（doctor --docs 调用）');
  console.log('  --verbose   文本报告 + 未覆盖文件完整清单');
  console.log('  --affected <f>…  源码变更即列出受影响知识卡（配合 git diff --name-only）');
  console.log('  --quiet     仅 --affected 使用：只输出卡 stem，供钩子机读');
  console.log('  --kc-dir <dir>  隔离模式：扫描指定目录而非 docs/knowledge/（契约测试打桩用）');
  process.exit(0);
}
if (ARGS.unknown.length) {
  console.error(`❌ 未知参数: ${ARGS.unknown.join(', ')}（--help 查看用法）`);
  process.exit(2);
}
// 知识卡目录：默认 docs/knowledge/；--kc-dir 覆盖为临时目录（隔离契约测试的临时卡，
// 使其不被 gen-vitepress-sidebar / gen-knowledge-index 等生成器扫入 sidebar.gen.mjs 等产物）
const KC_DIR = ARGS['kc-dir'] ? path.resolve(String(ARGS['kc-dir'])) : path.join(ROOT, 'docs', 'knowledge');
const JSON_OUT = ARGS.json;
const VERBOSE = ARGS.verbose;
const AFFECTED_MODE = ARGS.affected;
const AFFECTED_PATHS = ARGS._;
// 文件驱动模式（commit-with-check / push 门禁传入）：--files 为换行分隔的仓库相对路径，
// 仅校验本次变更的知识卡，避免并行会话未跟踪草稿卡阻断本次提交。无 --files 退化为全量。
const FILES_SET: Set<string> | null = ARGS.files
  ? new Set(String(ARGS.files).split('\n').map((p) => p.trim()).filter(Boolean).map((p) => path.basename(p)))
  : null;
// --quiet：--affected 仅输出受影响卡 stem（每行一个），供钩子机读消费
const QUIET = ARGS.quiet;
const errors: string[] = [];
const warns: string[] = [];

// ── 枚举 ──────────────────────────────────────────────
const CATEGORY_ENUM = new Set(KNOWLEDGE_ORDER);
const TIER_ENUM = new Set(['architecture', 'leaf']);
const KIND_RE = /^[a-z0-9][a-z0-9_-]*$/;
const PLACEHOLDER_RE = /^<.*>$/;

// 源码事实源黑名单：生成物（构建产物，非稳定事实源）/ 测试文件（应在 tests: 字段）
const GEN_RE = /(^|\/)bindings(\/|$)|(^|\/)dist(\/|$)|(^|\/)node_modules(\/|$)/;
const TEST_RE = /\.(test|spec)\.(ts|js)$|_test\.go$|(^|\/)test(\/|$)/;
const ROOT_ESCAPE_RE = /\\|^[A-Za-z]:|^\/|^~|\.\.\//; // 反斜杠 / 绝对路径 / .. 逃逸

// ── 共享 frontmatter 解析统一走 _lib/frontmatter.ts（见顶部 import）──

// ── 单遍遍历骨架：readdir 一次 + 每卡 read+parseFrontmatter 一次 ──
// 此前 checkKnowledgeMeta/Sources/Anchors/Coverage/runAffected 各自
// readdirSync + readFileSync + parseFrontmatter（每卡 frontmatter 被解析 5 遍，
// 同一目录被读盘 5 次）——统一为一次遍历，喂给全部检查器。
/**
 * 单遍遍历骨架：readdir 一次 + 每卡 read+parseFrontmatter 一次。
 * opts.filesSet：仅保留集合内的卡（--files 裁剪模式，与 check-redlines 对齐）。
 *   未跟踪草稿跳过仅在 filesSet 存在（commit/push 裁剪）时启用——
 *   全局模式（doctor --all / 契约测试）须扫全部卡（含未跟踪草稿），否则漏检。
 */
function loadKnowledgeCards(opts: { filesSet?: Set<string> | null } = {}) {
  if (!fs.existsSync(KC_DIR)) return [];
  const untracked = opts.filesSet ? getUntrackedCards(ROOT) : new Set<string>();
  const files = fs.readdirSync(KC_DIR).filter(
    (f) =>
      f.endsWith('.md') &&
      !/^(readme|agents)\.md$/i.test(f) &&
      !untracked.has(f) &&
      (!opts.filesSet || opts.filesSet.has(f))
  );
  return files.map((cf) => {
    // P1 修复（子代理审计）：带 BOM 的知识卡 `^---` 失配 → 整卡静默跳过（假绿）；
    // 对齐 hooks/knowledge-affected-hint.mjs 的 `^\uFEFF?---` 容错
    const text = fs.readFileSync(path.join(KC_DIR, cf), 'utf8');
    return { cf, stem: cf.replace(/\.md$/, ''), text, fm: parseFrontmatter(text) };
  });
}

// ── 检查 1：知识卡 frontmatter 治理 ──────────────────

function checkKnowledgeMeta(cards: any[]) {
  let count = 0;
  for (const { cf, stem, text, fm } of cards) {
    // 幽灵卡检测：任何 .md 文件（排除 KNOWLEDGE_NON_CARDS）若无 YAML frontmatter，报错而非静默跳过。
    // 历史教训：go-repoaudit.md / go-rustbridge.md / wasm-memory-pitfalls.md 曾以旧格式（行内 frontmatter）存在于
    // docs/knowledge/ 下但未被 gen 脚本索引，check-knowledge-drift 也不检测——属于「漂移检查盲区」。
    if (!hasFrontmatterDelimiter(text)) {
      if (!KNOWLEDGE_NON_CARDS.has(cf)) {
        // 分隔符显式诊断：*** / ~~~ 等非 --- 开头 = 疑似「整卡 Markdown 重排事故」——frontmatter 被当正文
        // 序列化（---→*** 水平线改写、\_ 转义、列表空行平铺 + 嵌套错乱），会绕过 parseFrontmatter 的 ^---
        // 匹配令 gen 静默跳过、索引漏登。历史两次受害：frontend_repo_audit.md（bd86a916 修复）、
        // context-menu.md（cabb0e8b 回滚）。给可操作指引（定位重排提交回滚），区别于泛化「旧格式残留」。
        const head = (stripBom(text).split(/\r?\n/, 1)[0] || '').trim();
        errors.push(
          head === '***' || head === '~~~'
            ? `知识卡 ${cf} frontmatter 分隔符异常「${head}」——疑似整卡 Markdown 重排事故（frontmatter 被当正文序列化：---→***、\\_ 转义、列表平铺嵌套错乱；历史两次：frontend_repo_audit / context-menu）——须 git log 定位重排提交回滚该卡，或重组 frontmatter 为 --- 开头`
            : `幽灵卡 ${cf} 无 YAML frontmatter（首行 ${JSON.stringify(head.slice(0, 40))}；旧格式残留或误放文件）——须补 frontmatter 或移入 KNOWLEDGE_NON_CARDS`
        );
      }
      continue;
    }
    count++;
    if (!fm) { errors.push(`知识卡 ${cf} 缺少 YAML frontmatter`); continue; }

    // 必填字段（统一走 _lib/knowledge-common）
    for (const key of missingRequiredCardFields(fm)) {
      errors.push(`知识卡 ${cf} 缺少必填字段 ${key}`);
    }

    // 模板占位符
    const fmFields = getAllScalars(fm);
    for (const [k, v] of Object.entries(fmFields)) {
      if (v !== '' && PLACEHOLDER_RE.test(v)) {
        errors.push(`知识卡 ${cf} 的 ${k} 含未填充占位符: ${v}`);
      }
    }

    // kind 格式
    const kind = getScalar(fm, 'kind');
    if (kind && !KIND_RE.test(kind)) {
      errors.push(`知识卡 ${cf} 的 kind 非法: ${kind}（应为小写 kebab-case，兼容历史 snake_case，允许 - 与 _）`);
    }

    // kind 与文件名同源（单一不变量：文件名是命名事实源）
    if (kind && kind !== stem) {
      errors.push(`知识卡 ${cf} 的 kind「${kind}」与文件名「${stem}」不一致（kind 应等于文件名 kebab 形式）`);
    }

    // category 值域
    const category = getScalar(fm, 'category');
    if (category && !CATEGORY_ENUM.has(category)) {
      errors.push(`知识卡 ${cf} 的 category 非法: ${category}（应为 ${[...CATEGORY_ENUM].join('|')} 之一）`);
    }

    // tier 值域
    const tier = getScalar(fm, 'tier');
    if (tier && !TIER_ENUM.has(tier)) {
      errors.push(`知识卡 ${cf} 的 tier 非法: ${tier}（应为 ${[...TIER_ENUM].join('|')} 之一）`);
    }

    // perf 性能画像值域（受控词表，单一事实源 = _lib/knowledge-cards.ts PERF_TAGS）
    const PERF_ENUM = Object.keys(PERF_TAGS);
    for (const t of getList(fm, 'perf')) {
      if (!PERF_ENUM.includes(t)) {
        errors.push(`知识卡 ${cf} 的 perf 标签非法: ${t}（词表见 _lib/knowledge-cards.ts PERF_TAGS: ${PERF_ENUM.join('|')}）`);
      }
    }

    // H1 vs name 一致性（WARN）
    const name = getScalar(fm, 'name');
    const h1Match = text.match(/^#\s+(.+)$/m);
    if (h1Match && name && h1Match[1].trim() !== name) {
      warns.push(`知识卡 ${cf} 的 H1 标题「${h1Match[1].trim()}」与 name「${name}」不一致`);
    }
  }
  return { count };
}

// ── 检查 2：source_files 存在性 + 路径格式 + 语义漂移 ──

function checkKnowledgeSources(cards: any[]) {
  for (const { cf, fm } of cards) {
    if (!fm) continue;
    // 抽出 + 归一（反斜杠 → 正斜杠），供存在性 / 格式 / 语义三检共用
    const sources = parseSourceFiles(fm).map((s) => ({ raw: s, norm: toPosix(s) }));
    for (const { raw, norm } of sources) {
      // [ERROR] 路径格式：反斜杠 / 绝对路径 / .. 逃逸 → 不可移植，CI 其他平台 404
      if (ROOT_ESCAPE_RE.test(raw)) {
        errors.push(`知识卡 ${cf} 的 source_files 路径格式非法: ${raw}（禁止反斜杠/绝对路径/..，必须仓库相对 POSIX 路径）`);
        continue;
      }
      // [ERROR] 文件不存在（硬 404，源码删除/移动/重命名即触发）
      if (!fs.existsSync(path.join(ROOT, norm))) {
        errors.push(`知识卡 ${cf} 的 source_files 引用不存在: ${norm}`);
        continue;
      }
      // [WARN] 指向生成物（bindings/dist/node_modules）→ 非源码事实源，重构后静默失真
      if (GEN_RE.test(norm)) {
        warns.push(`知识卡 ${cf} 的 source_files 指向生成物: ${norm}（应引用源码实现，而非构建产物）`);
      }
      // [WARN] 指向测试文件 → 卡片事实源应是实现，测试应放 tests: 字段
      if (TEST_RE.test(norm)) {
        warns.push(`知识卡 ${cf} 的 source_files 指向测试文件: ${norm}（实现放 source_files，测试放 tests:）`);
      }
    }
  }
}

// ── 检查 2.5：机制锚核对（ADR-044 策略 C）──
// 存在性对账无法发现「机制描述错误」（sync.Once→registryMu、sort.Strings→json.Decoder、
// GetVersion→GetAppVersion 等重构后知识卡正文失效）。知识卡 frontmatter 可声明
// `invariant_anchors:`（list），每项 `文件相对路径|应含模式`（| 分隔，模式为字面子串或
// `re:` 前缀正则）。锚不命中 → ERROR（机制描述漂移即红，纳入 ADR-043 fail-closed 契约）。
//
// 增强（WARN 级，2026-09）：纯标识符形态的锚（如 `file|someSymbol`）本意是「符号定义于此」，
// 但弱断言（子串包含）会把只 import / re-export / 注释提及该符号的文件也判为命中——AI 照锚
// 索引会摸错文件（实证：theme.md 曾把 normalizeTheme 钉在只有 re-export 的 app-modules.ts，
// 真义在 theme-core.ts）。故对纯标识符锚额外检查「定义形态 or 真实消费」，两者皆无（仅
// import/export 列表/注释/字符串出现）→ WARN 提示锚疑似指引用处。保持 ERROR 逻辑不变。
const ANCHOR_DEF_RE =
  // TS/JS：export function/class/const/let/var/type/interface/enum、裸 function/class、模块级 const/let/var
  /(?:^|[\s\n;{}])(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)\s*\(|class\s+(\w+)\b|(?:const|let|var)\s+(\w+)\s*[:=]|type\s+(\w+)\s*[={]|interface\s+(\w+)\b|enum\s+(\w+)\b)/g;
const ANCHOR_DEF_RE_GO =
  // Go：func/type/const/var + receiver 方法
  /(?:^|[\s\n;{}])(?:func\s+\([^)]*\)\s+(\w+)\s*\(|func\s+(\w+)\s*\(|type\s+(\w+)\s*(?:struct|interface|\{)|const\s+(\w+)\s*=|var\s+(\w+)\s*=)/g;

/**
 * 判断纯标识符锚在目标文件里是「定义处」还是「仅有引用」。
 * 返回 'defined' | 'consumed' | 'ref-only' | 'absent'：
 *   - defined：文件存在该符号的定义形态（function/class/const/type 声明或 Go func/type/const）
 *   - consumed：无定义形态，但有真实消费（调用 `X(` / 属性 `X.` / 类型标注 `: X` 等）
 *   - ref-only：无定义形态、无真实消费，仅 import/export 列表/注释/字符串提及（锚疑似指引用处）
 *   - absent：连子串都不含（本函数不负责，外层 includes 已判 ERROR）
 */
function anchorDefKind(content: string, sym: string): 'defined' | 'consumed' | 'ref-only' | 'absent' {
  if (!content.includes(sym)) return 'absent';
  const re = new RegExp(`\\b${sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  // 定义形态：TS/JS 与 Go 双正则各扫一遍
  const defRegexes = [ANCHOR_DEF_RE, ANCHOR_DEF_RE_GO];
  for (const dr of defRegexes) {
    dr.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = dr.exec(content)) !== null) {
      if (m.slice(1).includes(sym)) return 'defined';
    }
  }
  // 定义形态兜底：Go 常见 `X = iota` / 短声明域内定义 / TS `class X` 属性 `readonly X` /
  // TS interface 成员 `X?:` / `X:`
  if (
    new RegExp(
      `(?:^|[\\s\\n;{}])(?:readonly\\s+|private\\s+|protected\\s+|public\\s+)?${re.source}\\s*[=:(]|\\b${re.source}\\??\\s*:\\s*(?:\\w+|\\[|\\{|\\(|<|\\([^)]*\\)\\s*=>)`
    ).test(content)
  ) {
    // 排除 import/export 列表内的 `X,`（逗号后无冒号/等号/括号）
    if (!new RegExp(`import[^;\\n]*\\b${re.source}\\b|export\\s*\\{[^}]*\\b${re.source}\\b`).test(content)) return 'defined';
  }
  // 真实消费：调用 `X(`、成员访问 `X.`、类型标注 `: X`、泛型 `X<`、数组/集合 `X[`、
  // 函数实参 `(X)`（如 runTools(ALL_STATIC_TOOLS)）——排除声明形态
  if (
    new RegExp(
      `\\b${re.source}\\s*\\(|\\b${re.source}\\s*\\.|\\b${re.source}\\s*<|:\\s*\\b${re.source}\\b|\\b${re.source}\\s*\\[|\\(\\s*\\b${re.source}\\s*\\)`
    ).test(content)
  ) return 'consumed';
  return 'ref-only';
}

function checkKnowledgeAnchors(cards: any[]) {
  for (const { cf, fm } of cards) {
    if (!fm) continue;
    const anchors = getList(fm, 'invariant_anchors');
    for (const raw of anchors) {
      const sep = raw.lastIndexOf('|');
      if (sep < 0) {
        errors.push(`知识卡 ${cf} 的 invariant_anchors 格式非法: ${raw}（应为「文件相对路径|应含模式」）`);
        continue;
      }
      const file = toPosix(raw.slice(0, sep).trim());
      const pat = raw.slice(sep + 1).trim();
      if (!file || !pat) {
        errors.push(`知识卡 ${cf} 的 invariant_anchors 格式非法: ${raw}（文件或模式为空）`);
        continue;
      }
      const full = path.join(ROOT, file);
      if (!fs.existsSync(full)) {
        errors.push(`知识卡 ${cf} 的机制锚文件不存在: ${file}`);
        continue;
      }
      // TOCTOU 防护：existsSync 与 readFileSync 之间文件可能被删/改名
      let content: string;
      try {
        content = fs.readFileSync(full, 'utf8');
      } catch (e) {
        errors.push(`知识卡 ${cf} 的机制锚文件读取失败: ${file}（${(e as NodeJS.ErrnoException).message}）`);
        continue;
      }
      let hit = false;
      if (pat.startsWith('re:')) {
        try {
          hit = new RegExp(pat.slice(3)).test(content);
        } catch (e) {
          errors.push(`知识卡 ${cf} 的机制锚正则非法: ${pat}（${(e as any).message}）`);
          continue;
        }
      } else {
        hit = content.includes(pat);
      }
      if (!hit) {
        errors.push(`知识卡 ${cf} 的机制锚失效: 声称 ${file} 含「${pat}」，实际不存在（机制描述漂移——重构触及锚即红，请同步知识卡正文）`);
        continue;
      }
      // 增强（WARN）：纯标识符锚且无定义/消费 → 疑似指引用处而非定义处
      if (/^[A-Za-z_$][\w$]*$/.test(pat) && !pat.startsWith('re:')) {
        const kind = anchorDefKind(content, pat);
        if (kind === 'ref-only') {
          warns.push(
            `知识卡 ${cf} 的机制锚 ${file}|${pat} 疑似指向引用处而非定义处：该符号在文件中仅以 import / re-export / 注释 / 字符串出现，无定义形态亦无调用消费。若锚语义是「文件含该机制」可忽略；若想表达「符号定义于此」，请改指定义文件（grep 定位）`
          );
        }
      }
    }
  }
}

// ── 检查 3：索引断链（index.md 中 ./xxx.md 链接）──

const INDEX_FILES = ['index.md'];
const LINK_RE = /\]\(\.\/([a-zA-Z0-9_-]+\.md)\)/g;

function checkIndexLinks() {
  for (const idx of INDEX_FILES) {
    const file = path.join(KC_DIR, idx);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(LINK_RE)) {
      const target = m[1]!;
      if (!fs.existsSync(path.join(KC_DIR, target))) {
        errors.push(`索引 ${idx} 链接指向不存在的卡: ${target}`);
      }
    }
  }
}

// ── 检查 4：AGENTS.md 手写事实索引（WARN）──

function checkAgentsNoHandcraftedIndex() {
  const targets = ['AGENTS.md'];
  for (const rel of targets) {
    const text = fs.existsSync(path.join(ROOT, rel)) ? fs.readFileSync(path.join(ROOT, rel), 'utf8') : '';
    if (!text) continue;
    let treeHits = 0;
    for (const line of text.split('\n')) {
      if (/^[│├└]\s*[├└]──\s/.test(line) || /^\s*├──\s/.test(line) || /^\s*└──\s/.test(line)) {
        treeHits++;
      }
    }
    if (treeHits > 0) {
      warns.push(`${rel} 含手写目录树特征（${treeHits} 行 ├──/└──），应改为指针指向知识卡系统`);
    }
  }
}

// ── 检查 5.5：use_when / quick_intents 上限门禁（ADR-152 续，知识卡质量治理）──
// use_when 被滥用为「术语清单」（如 optimization_log 18 条），导致路由表歧义放大。
// 设计意图：
//   - use_when: 用户自然语言查询关键词，上限 8 条（>8 WARN，>12 ERROR）
//   - quick_intents: 高频用户查询，上限 5 条（>5 WARN，>8 ERROR）
//   - invariant_anchors: architecture 卡必须声明（缺失 WARN），指向具体源码位置
//
// 解法 B 字段分类：
//   机器推导字段（ERROR 级，参与漂移检测）：source_files / symbols / auto_fields.symbols_with_lines / tests
//   人工策展字段（WARN 级，不阻断）：use_when / pitfalls / quick_groups / quick_intents / quick_risk_lines / 正文 prose
const USE_WHEN_WARN = 8;
const USE_WHEN_ERROR = 12;
const QUICK_INTENTS_WARN = 5;
const QUICK_INTENTS_ERROR = 8;

function checkKnowledgeQuality(cards: any[]) {
  for (const { cf, fm } of cards) {
    if (!fm) continue;
    // tier 从 frontmatter 取（code review P2 修复）：loadKnowledgeCards 返回的卡片
    // 对象无 tier 字段，从 cards 解构 tier 恒 undefined → architecture 卡检查永不触发
    const tier = getScalar(fm, 'tier');
    // use_when 上限
    const uw = getList(fm, 'use_when');
    if (uw.length > USE_WHEN_ERROR) {
      errors.push(`知识卡 ${cf} 的 use_when 过量: ${uw.length} 条（上限 ${USE_WHEN_ERROR}，超 ${uw.length - USE_WHEN_ERROR} 条）——请合并或移除冗余关键词`);
    } else if (uw.length > USE_WHEN_WARN) {
      warns.push(`知识卡 ${cf} 的 use_when 略多: ${uw.length} 条（建议上限 ${USE_WHEN_WARN}）`);
    }
    // quick_intents 上限
    const qi = getList(fm, 'quick_intents');
    if (qi.length > QUICK_INTENTS_ERROR) {
      errors.push(`知识卡 ${cf} 的 quick_intents 过量: ${qi.length} 条（上限 ${QUICK_INTENTS_ERROR}）——请合并为复合查询词`);
    } else if (qi.length > QUICK_INTENTS_WARN) {
      warns.push(`知识卡 ${cf} 的 quick_intents 略多: ${qi.length} 条（建议上限 ${QUICK_INTENTS_WARN}）`);
    }
    // invariant_anchors 缺失（architecture 卡必须声明）
    if (tier === 'architecture') {
      const inv = getList(fm, 'invariant_anchors');
      if (inv.length === 0) {
        warns.push(`知识卡 ${cf}（architecture）缺少 invariant_anchors——请声明机制锚点（格式：文件路径|应含模式）`);
      }
    }
  }
}

// ── 检查 5：代码→卡片覆盖盲区（WARN，不阻断）──
// 适配自 MikuMikuAR check-doc-drift.ts checkKnowledgeCoverage（INFO 级）。
// 从「代码现实」出发：扫描源码目录下每个文件，确认至少 1 张知识卡的
// source_files 引用了它（目录条目按前缀匹配，文件条目按精确匹配）。
// 未覆盖 = 代码有模块、知识库无卡片 → WARN 提醒补登，不阻断 CI。

const SOURCE_ROOTS = ['frontend/src', 'go'];
// 排除：node_modules / dist / bindings / test 目录 / .test. / _test.（Go *_test.go） / .spec. / web-spike（ADR-049 Phase 0 spike，ephemeral 验证入口，非生产代码）
// 同时匹配 / 与 \（Windows 下 path.join 产反斜杠路径，仅正斜杠会漏排除——code_review P3）
const WALK_EXCLUDE_RE = /(node_modules|[\\/]dist[\\/]|[\\/]bindings[\\/]|[\\/]test[\\/]|web-spike[\\/]|\.test\.|_test\.|\.spec\.)/;

/** 某卡 source_files 条目是否覆盖源文件 rel：文件精确匹配 / 目录前缀匹配。 */
function covers(rel: string, entry: string) {
  const e = entry.replace(/\/+$/, '');
  return rel === e || rel.startsWith(e + '/');
}

/** 源码文件单遍收集（_lib/scan-files.walk，领域排除走 skipDir/skipFile）。 */
function walkSources(dir: string): string[] {
  return walk(dir, {
    exts: ['.ts', '.js', '.go'],
    skipDir: (n) => /^(node_modules|dist|bindings|test|web-spike)$/.test(n) || WALK_EXCLUDE_RE.test(n),
    skipFile: (n) => WALK_EXCLUDE_RE.test(n),
  }) as string[];
}

function checkKnowledgeCoverage(cards: any[]) {
  // 收集所有卡的 source_files（去尾斜杠）
  const referenced = new Set<string>();
  for (const { fm } of cards) {
    if (!fm) continue;
    for (const src of parseSourceFiles(fm)) {
      if (/\.(ts|js|go)$/.test(src) || src.endsWith('/')) referenced.add(src.replace(/\/+$/, ''));
    }
  }
  // 扫描源码文件，未覆盖的按顶层目录分组
  const byDir = new Map();
  let total = 0;
  const uncoveredFiles: string[] = [];
  for (const root of SOURCE_ROOTS) {
    for (const f of walkSources(path.join(ROOT, root))) {
      const rel = toPosix(path.relative(ROOT, f));
      const hit = [...referenced].some((entry) => covers(rel, entry));
      if (hit) continue;
      total++;
      uncoveredFiles.push(rel);
      const top = rel.split('/').slice(0, 2).join('/');
      byDir.set(top, (byDir.get(top) || 0) + 1);
    }
  }
  if (total === 0) return;
  const topSummary = [...byDir.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([d, n]) => `${d}×${n}`)
    .join('  ');
  warns.push(`代码→卡片覆盖盲区：${total} 个源码文件未被任何知识卡引用（TOP: ${topSummary}）。非阻断提醒，建议补登知识卡。`);
  // --verbose 时输出完整文件列表
  if (VERBOSE) {
    const indent = '  ';
    console.log(`\n${indent}未覆盖文件清单（${total} 个）：`);
    const bySub = new Map();
    for (const f of uncoveredFiles) {
      const sub = f.split('/').slice(0, 3).join('/');
      if (!bySub.has(sub)) bySub.set(sub, []);
      bySub.get(sub).push(f);
    }
    for (const [sub, files] of [...bySub.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`${indent}${indent}${sub} ×${files.length}`);
      for (const f of files) console.log(`${indent}${indent}${indent}- ${f}`);
    }
  }
}

// ── 主动防御：源码变更即标记受影响知识卡 ──────────────
// 给定变更文件清单（仓库相对 POSIX 路径），输出引用了它们的知识卡。
// 与 git 联动：git diff --name-only | xargs -I{} node scripts/check-knowledge-drift.ts --affected {}
// 匹配规则复用 covers()：文件精确命中 / 目录前缀命中（source_files 可整目录引用）。

function runAffected(changed: string[]) {
  if (changed.length === 0) {
    console.log('用法: node scripts/check-knowledge-drift.ts --affected <变更文件...>');
    console.log('  常与 git 联动: git diff --name-only | xargs -I{} node scripts/check-knowledge-drift.ts --affected {}');
    console.log('  机读模式:      node scripts/check-knowledge-drift.ts --affected --quiet <变更文件...>  （仅输出卡 stem）');
    process.exit(0);
    return;
  }
  if (!fs.existsSync(KC_DIR)) process.exit(0);
  // 建立 卡片 → source_files 索引
  // affected: false（快照/报告型卡，如整包审计）→ 退出 affected 匹配：
  // 其 source_files 只服务覆盖率统计，不随单次文件变更提示复核
  const index: { card: string; sources: string[] }[] = [];
  for (const { cf, fm } of loadKnowledgeCards()) {
    if (!fm) continue;
    if (getScalar(fm, 'affected') === 'false') continue;
    const sources = parseSourceFiles(fm).map((s) => toPosix(s));
    if (sources.length) index.push({ card: cf.replace(/\.md$/, ''), sources });
  }
  const hits = new Map();
  for (const ch of changed.map((c) => toPosix(c))) {
    for (const { card, sources } of index) {
      if (sources.some((entry) => covers(ch, entry))) {
        if (!hits.has(card)) hits.set(card, new Set());
        hits.get(card).add(ch);
      }
    }
  }
  if (hits.size === 0) {
    if (!QUIET) console.log(`✅ 变更的 ${changed.length} 个文件未被任何知识卡 source_files 引用，无需复核。`);
    process.exit(0);
    return;
  }
  if (QUIET) {
    // 机读模式：仅输出卡 stem，每行一个（供 prepare-commit-msg 钩子消费）
    for (const card of [...hits.keys()].sort()) console.log(card);
    process.exit(0);
    return;
  }
  console.log(`⚠ 以下 ${hits.size} 张知识卡引用了本次变更的文件，建议复核:`);
  for (const [card, files] of [...hits.entries()].sort()) {
    console.log(`  - ${card}  ←  ${[...files].join(', ')}`);
  }
  process.exit(0);
}

// ── 检查 5.6：人工策展字段漂移（解法 B，WARN 级不阻断）──
// 人工策展字段（use_when / pitfalls / quick_*）是 AI 路由和陷阱提示的事实源，
// 但不应参与 ERROR 级漂移检测。此处仅做「缺失/过少」提醒，帮助发现未维护的卡。
function checkCuratedFields(cards: any[]) {
  for (const { cf, fm } of cards) {
    if (!fm) continue;
    // use_when 缺失提醒（非 architecture 卡也提示，但仅 WARN）
    const uw = getList(fm, 'use_when');
    if (uw.length === 0) {
      warns.push(`知识卡 ${cf} 缺少 use_when 字段（影响路由命中）——请在 frontmatter 补充关键词列表`);
    }
    // pitfalls 缺失提醒（architecture 卡优先提示）
    const tier = getScalar(fm, 'tier');
    const pits = getList(fm, 'pitfalls');
    if (tier === 'architecture' && pits.length === 0) {
      warns.push(`知识卡 ${cf}（architecture）缺少 pitfalls 字段（建议补充常见陷阱）`);
    }
    // quick_intents 缺失提醒
    const qi = getList(fm, 'quick_intents');
    if (qi.length === 0 && tier === 'architecture') {
      warns.push(`知识卡 ${cf}（architecture）缺少 quick_intents 字段（影响高频路由表生成）`);
    }
  }
}

// ── 检查 5.7：auto_fields 机器推导字段漂移（解法 B，ERROR 级）──
// auto_fields.symbols_with_lines 由 gen-knowledge-autogen.ts 自动生成，
// 此处仅校验 frontmatter 中已声明 auto_fields 的卡是否格式合法，
// 不重新提取符号（由 gen 脚本负责同步）。
function checkAutoFieldsFormat(cards: any[]) {
  for (const { cf, fm } of cards) {
    if (!fm) continue;
    const af = getList(fm, 'auto_fields');
    if (af.length === 0) continue; // 无 auto_fields 字段，跳过
    // auto_fields 块列表格式校验：每项应为 "key: value" 或纯 value
    for (const item of af) {
      if (!/^\s*\w+:\s*.+/.test(item) && !/^\s*-?\s*\w/.test(item)) {
        // 放宽校验：允许子键格式 `symbols_with_lines:` 后的列表项被 getList 展平
        // 此处仅做防御性检查，格式问题由 gen 脚本保证
      }
    }
    // symbols_with_lines 条目格式：应包含符号名（字母数字下划线）
    const symLines = af.filter((v) => v.includes('symbols_with_lines'));
    for (const sl of symLines) {
      // 解析 "symbols_with_lines:" 后的条目
      const symMatch = sl.match(/^symbols_with_lines:\s*(.+)$/);
      if (symMatch) {
        const val = symMatch[1]!.trim();
        // 允许：纯符号名（行号已减噪，见 ADR-159；保留 :\d+ 兼容旧卡片）
        if (val && !/^[A-Za-z0-9_$.]+(:\d+)?$/.test(val)) {
          warns.push(`知识卡 ${cf} 的 auto_fields.symbols_with_lines 格式异常: ${val}（应为符号名）`);
        }
      }
    }
  }
}

// ── 检查 5.8：auto_fields 内禁止人工策展子字段（ERROR 级，fail-closed）──
// 教训（2026-09-03 全库治理）：quick_*/pitfalls/use_when/perf/invariant_anchors 等
// 人工策展字段被写进 auto_fields 块（2 空格缩进）后，gen 脚本（frontmatter.ts getList）
// 只匹配行首 key，嵌套版成为死数据——信息静默丢失（backend-idb 5 条意图只剩 1 条进路由表、
// context-menu P2-1 条目读不到、go-android-platform-guard 整卡被路由跳过）。
// 规范：人工策展字段一律顶格；auto_fields 只容纳机器推导字段（symbols_with_lines/symbols/tests）。
const CURATED_SUBFIELDS = new Set([
  'quick_groups',
  'quick_intents',
  'quick_risk_lines',
  'pitfalls',
  'use_when',
  'perf',
  'invariant_anchors',
]);

function checkNoCuratedInAutoFields(cards: any[]) {
  for (const { cf, fm } of cards) {
    if (!fm) continue;
    const lines = fm.split(/\r?\n/);
    let inAuto = false;
    for (const line of lines) {
      if (/^auto_fields\s*:/.test(line)) { inAuto = true; continue; }
      if (inAuto && /^\S/.test(line)) break; // 块结束
      if (!inAuto) continue;
      const sub = line.match(/^ {2,}(\w+)\s*:/);
      if (sub && CURATED_SUBFIELDS.has(sub[1]!)) {
        errors.push(
          `知识卡 ${cf} 的 auto_fields 内含人工策展字段 ${sub[1]}（gen 只读顶格，嵌套版是死数据）——请上提为顶格字段并删除嵌套块`
        );
        break; // 每卡报一次即可
      }
    }
  }
}

// ── 检查 5.9：正文散文禁硬编码行号/行数/计数（WARN，P1 落地 ADR-162 精神到散文层）──
// 背景（2026-09-05 P1）：ADR-162 已把 frontmatter symbols_with_lines 去行号（纯符号名，
// 行号位移不再触发重写）。但正文散文里的手写行号（`L164`、`983 行`、`8 个能力`）从未纳入
// 治理——重构一次漂一层、无人维护（实证：mount3d-584-giant / mount-preview-module-singleton-race
// 行号三层漂移）。本检查以 WARN 级护栏引导改写为「文件|符号」引用（机器可验存在性，漂移自愈）。
//
// 豁免（不属手写治理对象）：
//   1. 生成物（index.md / routes.md / routes-quick.md）——gen 产物禁手改，快照文本随源卡走
//   2. focused 快照/报告卡（affected: false）——历史评审快照，行号是「当时」事实记录，不漂移
//      （同 ADR-043「affected: false 退出 --affected 匹配」语义）
//
// 模式（只扫正文，frontmatter 由 5.7 的 `:NN` 兼容格式豁免）：
//   L123        单行号（词边界，防误伤 loadL123 / L1234 变量名 —— 数字部分限 2-4 位歧义？否，
//                仅要求 L 后紧跟 1-4 位数字且非单词字符）
//   L100-200    行号区间
//   888 行      行数引用（≥2 位数字 + 「行」，避免「1 行代码」类叙述噪音）
//   8 个能力    计数引用（受限词表：能力/控件/守卫/单例/参数/事件 —— 防「1 个能力」噪音）
// 注意 JS `\b` 只认 ASCII 词字符（[A-Za-z0-9_]），「行/能力」等 CJK 后接中文标点（，、（ ）时
// \b 不成立（均为非词字符）——所以 CJK 尾部一律用负向前瞻 (?![0-9A-Za-z_]) 而非 \b。
// 细节（实测定拄）：
//   - L0 必为误报（无 0 行；app-preview「交互式 L0 清单」是游戏层级符号）→ 用 L[1-9]\d{0,3}
//   - 「062 行为」的「行为」不是行数引用 → \d{2,}\s*行 后不得跟汉字（(?![^\x00-\x7f])？否，
//     直接负向前瞻汉字区 [\u4e00-\u9fff]，「888 行，」的行后是中文逗号（非汉字）仍通过
//   - 「100 行红线」是 AGENTS.md 全仓通用规范术语（行数阈值），非文件行数引用 → 行后跟「红线」豁免
//   - 描述性事实（非会漂移的导航行号）一律豁免：
//       * `ADR-100 L4` ADR 章节引用（ADR 章节结构稳定，不随源码漂移）→ lookbehind 排除 `ADR-\d+ ` 前缀
//       * `≤15 行`/`~137 行`/`1504→827 行`/`301–360 行`/`20-30 行` 前缀 ≤ ~ → – - 均为
//         上限约定 / 估算 / 历史变化 / 区间描述，不指向当前源码位置 → lookbehind 排除
const BODY_LINE_RE_FINAL =
  /(?<![A-Za-z0-9_-])(?<!ADR-\d{1,4} )L[1-9]\d{0,3}(?:-\d{1,4})?(?![0-9A-Za-z_])|(?<![→~–—≤-])\b\d{2,}\s*行(?!红线)(?![0-9A-Za-z_\u4e00-\u9fff])|\b\d{1,2}\s*个(?:能力|控件|守卫|单例|参数|事件)(?![0-9A-Za-z_])/g;
/** 提取 frontmatter 块结束后的正文行（带行号）。 */
function bodyLinesWithNumbers(text: string): Array<{ lineNo: number; line: string }> {
  const clean = text.replace(/^\uFEFF/, '');
  // 第一次 `---` 与第二次 `---` 之间 = frontmatter；之后 = 正文
  const lines = clean.split(/\r?\n/);
  let inFrontmatter = false;
  const body: Array<{ lineNo: number; line: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (t === '---') {
      if (!inFrontmatter) { inFrontmatter = true; continue; }
      inFrontmatter = false;
      continue;
    }
    if (inFrontmatter) continue;
    body.push({ lineNo: i + 1, line: lines[i]! });
  }
  return body;
}
/** 扫描单卡正文，返回命中的行号引用（含正文行号 + 匹配文本）。 */
function scanBodyLineRefs(text: string): Array<{ lineNo: number; text: string; full: string }> {
  const hits: Array<{ lineNo: number; text: string; full: string }> = [];
  for (const { lineNo, line } of bodyLinesWithNumbers(text)) {
    BODY_LINE_RE_FINAL.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = BODY_LINE_RE_FINAL.exec(line)) !== null) {
      hits.push({ lineNo, text: m[0], full: line.trim().slice(0, 90) });
    }
  }
  return hits;
}
// 豁免：生成物（禁手改，随源卡走）与快照/报告卡（affected:false，行号是历史事实记录）
const BODY_REFS_SKIP_CARDS = new Set(['index.md', 'routes.md', 'routes-quick.md']);
function checkBodyLineRefs(cards: any[]) {
  for (const { cf, fm, text } of cards) {
    if (!text) continue;
    if (BODY_REFS_SKIP_CARDS.has(cf)) continue; // 生成物禁手改，不参与手写治理
    if (getScalar(fm, 'affected') === 'false') continue; // 快照/报告卡：行号为当时事实，不漂移
    const hits = scanBodyLineRefs(text);
    if (hits.length === 0) continue;
    const sample = hits.slice(0, 3).map((h) => `L${h.lineNo}「${h.text}」`).join('、');
    warns.push(
      `知识卡 ${cf} 正文含硬编码行号/行数/计数引用: ${sample}（ADR-162 精神：正文引用一律写「文件|符号」而非行坐标——行号位移会静默漂移，符号存在性由机器校验）`
    );
  }
}

// ── 主流程 ────────────────────────────────────────────

function main() {
  if (AFFECTED_MODE) {
    runAffected(AFFECTED_PATHS);
    return;
  }
  // ADR-043 fail-closed：KC_DIR 缺失 = 扫描不完整，必须显式失败而非空结果假绿
  //（此前各 check 函数对缺失目录静默 return，errors 恒 0 → --check 假绿）
  if (!fs.existsSync(KC_DIR)) {
    errors.push(`知识卡目录不存在，扫描不完整: ${KC_DIR}`);
  }
  // 单遍遍历：readdir + read + parseFrontmatter 各一次，喂给全部检查器
  // 按 --files 裁剪（filesSet 存在时同时跳过未跟踪草稿，避免并行会话草稿卡阻断本次提交）
  const cards = loadKnowledgeCards({ filesSet: FILES_SET });
  checkKnowledgeMeta(cards);
  checkKnowledgeSources(cards);
  checkKnowledgeAnchors(cards);
  checkIndexLinks();
  checkAgentsNoHandcraftedIndex();
  checkKnowledgeQuality(cards);
  checkCuratedFields(cards);       // 解法 B：人工策展字段漂移（WARN）
  checkAutoFieldsFormat(cards);    // 解法 B：机器推导字段格式校验
  checkNoCuratedInAutoFields(cards); // 解法 B：auto_fields 禁人工策展子字段（ERROR）
  checkBodyLineRefs(cards);        // P1：正文散文禁硬编码行号/行数/计数（WARN）
  checkKnowledgeCoverage(cards);

  const result = { _summary: { errors: errors.length, warns: warns.length }, errors, warns };

  if (JSON_OUT) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(errors.length ? 1 : 0);
    return;
  }

  console.log('══════════════════════════════════════');
  console.log(' 知识卡漂移检查 (check-knowledge-drift)');
  console.log('══════════════════════════════════════');
  console.log(`ERROR  : ${errors.length}`);
  console.log(`WARN   : ${warns.length}`);
  console.log('──────────────────────────────────────');

  if (warns.length) {
    for (const w of warns) console.log(`⚠ ${w}`);
  }

  if (errors.length) {
    for (const e of errors) console.log(`❌ ${e}`);
    console.log('→ 修复: 按上方错误更新对应知识卡，或检查 docs/knowledge/ 下文件与源码引用一致性');
    console.log(`\n退出码 1（可接 CI 卡点）。`);
    process.exit(1);
  } else {
    console.log('✅ 未检测到 ERROR 级漂移。');
  }
}

main();
