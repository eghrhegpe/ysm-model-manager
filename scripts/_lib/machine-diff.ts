/**
 * machine-diff.ts — 机器区 diff 判定（滞留生成物自动收编，ADR-184）。
 *
 * 背景：pre-commit 的 gen 循环每次 commit 都跑 GEN_CMDS（写模式），理论上把漂移卡
 * 刷成最新态并 stage。但 gen-stage.ts 的并发隔离判定（stage = 快照变化 − gen 前 dirty）
 * 制造了一个死角：gen 刷出的 diff 若没在当次 commit 搭上车（--only 路径限定提交 /
 * 无人提交），滞留在工作区后，之后任何 commit 开始时它已是 dirty → 被当作「并行
 * 半成品」排除 → 永远自动 stage 不进去（实证：event-graph.md 8a03beaa 滞留案例）。
 *
 * 本模块回答「滞留 dirty 文件可否自动收编」：
 *   - 生成物整文件（内容 = 全体输入的纯函数，无人工策展区）→ 无条件收编；
 *   - 知识卡 diff 变更行全部匹配机器区行模式（auto_fields/symbols 键 + 缩进列表项）
 *     → 纯机器区，收编；
 *   - 任一变更行落在人工策展区（正文 prose / use_when / pitfalls / 表格等）→ 排除，
 *     保持并发隔离（防吞并行会话手改——ADR-151 卷带实证的同一红线）。
 *
 * project-map.md 刻意排除出「生成物整文件」清单：其 GEN 区用途表是人工知识
 * （脚本从现文档读回复用，见 gen-project-map.ts loadUsageFromDoc），无条件收编
 * 会吞并行会话对用途表的手改。routes.md / routes-quick.md 相反：描述列源在卡片
 * frontmatter（gen-routes 读回），自身无人工维护区 → 全量重写可收编。
 *
 * 逃生阀：YSM_SKIP_GEN_STAGE=1（gen-stage.ts CLI 读取，恢复旧行为全排除）。
 */
import { execFileSync } from 'node:child_process';

/** 无人工复用区的生成物整文件（GEN_CMDS 直接产出全量态）。 */
export const GEN_WHOLE_OUTPUTS: readonly string[] = [
  'docs/event-graph.md',
  'docs/knowledge/index.md',
  'docs/knowledge/routes.md',
  'docs/knowledge/routes-quick.md',
  'docs/novel/index.md',
  'docs/.vitepress/sidebar.gen.mjs',
  'docs/cli-commands.md',
  'docs/adr/index.md',
];

/** 前缀匹配的生成物整文件目录（递归全量态）。 */
export const GEN_WHOLE_PREFIXES: readonly string[] = [
  'frontend/public/locales/',
  'completions/',
];

/** 机器区键行：auto_fields / symbols / symbols_with_lines 声明。 */
const MACHINE_KEY_RE = /^\s*(auto_fields|symbols|symbols_with_lines)\s*:/;
/** 机器区列表项：缩进 + `- 符号名`（auto_fields/symbols 块内容）。 */
const MACHINE_LIST_RE = /^\s+-\s+\S/;

/** 路径是否命中生成物整文件清单（正斜杠归一）。 */
export function isGenWholeOutput(p: string): boolean {
  const n = p.replace(/\\/g, '/');
  if (GEN_WHOLE_OUTPUTS.includes(n)) return true;
  return GEN_WHOLE_PREFIXES.some((pre) => n.startsWith(pre));
}

/** 滞留 dirty 文件分类结果。 */
export type StrandedKind = 'whole' | 'machine' | 'manual';

/**
 * 分类滞留 dirty 文件可否自动收编。
 * @param p        相对仓库根路径（正斜杠/反斜杠均可）
 * @param diffText git diff 输出（工作树 diff）
 * @returns whole（生成物整文件无条件收编）/ machine（纯机器区收编）/ manual（排除）
 */
export function classifyStranded(p: string, diffText: string): StrandedKind {
  if (isGenWholeOutput(p)) return 'whole';
  if (!diffText.trim()) return 'manual'; // 无变更内容（防御）
  const lines = diffText.split(/\r?\n/);
  let inHunk = false;
  for (const raw of lines) {
    if (raw.startsWith('@@')) {
      inHunk = /^@@ -\d+(?:,\d+)? \+\d+/.test(raw);
      continue;
    }
    if (!inHunk) continue; // diff --git / index / --- / +++ / \ No newline 等文件头
    const mark = raw.charAt(0);
    if (mark !== '+' && mark !== '-') continue; // 上下文行（unified=0 下罕见）
    const content = raw.slice(1);
    // hunk 内防御：+++ / --- 不可能是变更行
    if (content.startsWith('+') || content.startsWith('-')) continue;
    if (MACHINE_KEY_RE.test(content)) continue;
    if (MACHINE_LIST_RE.test(content)) continue;
    return 'manual'; // 变更行落在人工策展区 → 排除
  }
  return 'machine'; // 全部变更行均机器区模式
}

/** 该路径是否属于快照扫描域（docs / locales / completions）。 */
export function inSnapScope(p: string): boolean {
  const n = p.replace(/\\/g, '/');
  return (
    n.startsWith('docs/') ||
    n.startsWith('frontend/public/locales/') ||
    n.startsWith('completions/')
  );
}

/**
 * 滞留机器区收编清单：遍历 dirty 跟踪文件，git diff 判定后返回可收编路径。
 * @param dirtyPaths porcelain 中已 dirty 的跟踪文件路径（排除 ?? 未跟踪）
 * @returns 应自动收编的滞留文件清单（逐行，正斜杠）
 */
export function strandedStageList(dirtyPaths: string[]): string[] {
  if (process.env.YSM_SKIP_GEN_STAGE === '1') return [];
  const out: string[] = [];
  for (const p of dirtyPaths) {
    if (!inSnapScope(p)) continue;
    if (isGenWholeOutput(p) || /^docs\/(knowledge|adr)\//.test(p.replace(/\\/g, '/'))) {
      try {
        const diff = execFileSync('git', ['diff', '--', p], {
          cwd: process.cwd(),
          encoding: 'utf8',
        }) as string;
        if (diff.trim() && classifyStranded(p, diff) !== 'manual') out.push(p.replace(/\\/g, '/'));
      } catch {
        /* git diff 失败跳过（保守：不收编） */
      }
    }
  }
  return out;
}
