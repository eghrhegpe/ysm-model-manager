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
 * 会吞并行会话对用途表的手改。ADR-184 续（2026-09-05）：gen-project-map 已移出
 * GEN_CMDS 自动刷新（价值以 --json 为主，表格自动刷只制造滞留噪音），按需手动跑；
 * 故 project-map.md 不再进 snapChanged，其滞留路径随自动刷新一并消失。
 * routes.md / routes-quick.md 相反：描述列源在卡片
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

/**
 * 机器区键行：auto_fields / symbols / symbols_with_lines 声明。
 * 真实卡片形态：gen 只写 frontmatter `auto_fields:` 下的嵌套键（2 空格缩进）
 * 与列表项（4 空格缩进裸符号）；顶层无 `symbols:` 字段（grep 实证）。
 * 匹配键行 + 任意缩进是收敛到 auto_fields 子树的前提（新增整块时键行本身也入 diff）。
 */
const MACHINE_KEY_RE = /^\s*(auto_fields|symbols|symbols_with_lines)\s*:/;
/**
 * 机器区列表项：≥2 空格缩进 + `- ` + 单个裸符号 token（如 `    - AllExts`）。
 * 刻意收窄：use_when/pitfalls/quick_intents 等人工策展列表项（2 空格缩进、
 * 自然语言文本）与正文嵌套 bullet 均不匹配——裸符号 token 是 gen 输出独有形态，
 * 缩进 + token 双约束把「人工 bullet 编辑」整体排除在机器区外（ADR-151 红线）。
 */
const MACHINE_ITEM_RE = /^\s{2,}-\s+[A-Za-z_][A-Za-z0-9_.]*\s*$/;

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
 *
 * 机器区判定带 YAML 块上下文（每个 hunk 独立），信号双路：
 *   1. git diff hunk 头 section 名（funcname 上下文）——机器区 hunk 实证带 `auto_fields:`
 *      （go-types.md 深在 66-139 行的 hunk 头全是 `@@ ... @@ auto_fields:`）；
 *   2. hunk 内逐行块状态：顶格机器键行（auto_fields/symbols/symbols_with_lines）进入机器块，
 *      顶格其他行（人工键 use_when/pitfalls、正文 prose、表格、列0 bullet）结束机器块；
 *      缩进列表项在机器块内且形态为 `- 裸符号` → 机器项，否则人工项 → manual。
 *
 * 三个既有红线保障：
 *   - 无 +/- 前缀防御分支：git diff 列0 变更行（如 `-- item` 删 bullet，剥前缀后
 *     content 以 '-' 开头）是真实变更行，必须参与分类而非被静默吞掉（旧 L83 防御删除）；
 *   - 空内容行（`+`/`-` 后为空）中性跳过：机器块去空行重排（旧格式卡「符号+空行交替」
 *     压缩）不误判 manual（ADR-184 收编目标含此类卡），空行人工编辑同样不受影响；
 *   - 无任何机器变更行（纯上下文/空行 diff）→ manual 保守不收编。
 * 机器键行只在 machine 区信号下判定；整 diff 无键行提示且非 whole 时缩进 bullet 一律
 * manual（漏收编无害——滞留旧态；误收编有害——吞并行手改，ADR-151 红线方向保守）。
 */
export function classifyStranded(p: string, diffText: string): StrandedKind {
  if (isGenWholeOutput(p)) return 'whole';
  if (!diffText.trim()) return 'manual'; // 无变更内容（防御）
  const lines = diffText.split(/\r?\n/);
  let inHunk = false;
  let hunkZone: 'machine' | 'human' | 'unknown' = 'unknown';
  let sawMachineChange = false; // 是否见过被判定为机器区的变更行
  for (const raw of lines) {
    if (raw.startsWith('@@')) {
      inHunk = /^@@ -\d+(?:,\d+)? \+\d+/.test(raw);
      hunkZone = 'unknown'; // 每个 hunk 独立定块（上下文 3 行不跨 hunk 泄漏）
      if (inHunk) {
        // git funcname section 头：`@@ -66,9 +66,11 @@ auto_fields:` → 整 hunk 判机器区
        const section = raw.split('@@').pop() ?? '';
        const trimmed = section.trim();
        if (MACHINE_KEY_RE.test(trimmed)) hunkZone = 'machine';
        else if (trimmed !== '') hunkZone = 'human';
      }
      continue;
    }
    if (!inHunk) continue; // diff --git / index / --- / +++ / \ No newline 等文件头
    const mark = raw.charAt(0);
    if (mark !== ' ' && mark !== '+' && mark !== '-') continue; // \ No newline 等
    const content = raw.slice(1);
    if (content.trim() === '') continue; // 空内容行（上下文/空行变更均中性）
    const isChange = mark === '+' || mark === '-';
    const atCol0 = !/^[ \t]/.test(content);
    if (atCol0) {
      // 顶格行 = YAML 块边界：机器键行进机器块，其他行（人工键/正文/表格/bullet）出块
      if (MACHINE_KEY_RE.test(content)) {
        hunkZone = 'machine';
        if (isChange) sawMachineChange = true;
      } else {
        hunkZone = 'human';
        if (isChange) return 'manual'; // 顶格人工内容变更 → 排除
      }
      continue;
    }
    // 缩进行：上下文行不改变块状态
    if (!isChange) continue;
    if (hunkZone === 'machine') {
      // 机器块内：缩进机器子键行（`  symbols_with_lines:`，gen 首次整块插入时入 diff）
      // 与裸符号列表项（`    - AllExts`）均为机器变更；其他形态 → 人工渗入 → manual
      if (MACHINE_KEY_RE.test(content) || MACHINE_ITEM_RE.test(content)) {
        sawMachineChange = true;
        continue;
      }
      return 'manual';
    }
    // 缩进变更行落在人工区（use_when/pitfalls/quick_intents 的 2 空格 bullet——
    // 中文长句/含连字符 token，形态上本就不匹配 MACHINE_ITEM_RE；若恰好是裸符号形态，
    // 也因未处机器块信号内而保守排除）或未知区 → manual
    return 'manual';
  }
  // 无任何机器变更行（纯上下文/纯空行 diff）→ 保守不收编
  return sawMachineChange ? 'machine' : 'manual';
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
 * 批量优化：一次 `git diff -- <全部候选>` 子进程，按 `diff --git` 头拆分归属各文件，
 * 避免每 dirty 文件 spawn 一个 git（pre-commit 每次提交串行 N 次子进程）。
 * @param dirtyPaths porcelain 中已 dirty 的跟踪文件路径（排除 ?? 未跟踪）
 * @returns 应自动收编的滞留文件清单（逐行，正斜杠）
 */
export function strandedStageList(dirtyPaths: string[]): string[] {
  if (process.env.YSM_SKIP_GEN_STAGE === '1') return [];
  // 先过滤候选（快照域 + 可收编类别），命中才进 git 调用
  const candidates: string[] = [];
  for (const p of dirtyPaths) {
    if (!inSnapScope(p)) continue;
    const n = p.replace(/\\/g, '/');
    if (isGenWholeOutput(p) || /^docs\/(knowledge|adr)\//.test(n)) candidates.push(p);
  }
  if (candidates.length === 0) return [];
  const out: string[] = [];
  try {
    // 候选路径已知（porcelain dirty 清单）→ 不从 diff 头反解路径：
    // quotepath=false 让非 ASCII 原样输出，再用「整头全等」把每个 chunk 归属到候选，
    // 彻底规避 git C 风格引用（八进制转义）/空格截断等反解歧义；匹配失败保守跳过。
    const all = execFileSync('git', ['-c', 'core.quotepath=false', 'diff', '--', ...candidates], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }) as string;
    if (!all.trim()) return out;
    // 候选归一化路径（正斜杠）；预期 diff 头 = `diff --git a/<p> b/<p>`
    const normCands = candidates.map((p) => p.replace(/\\/g, '/'));
    const chunks = all.split(/\r?\n(?=diff --git )/);
    for (const chunk of chunks) {
      const header = (chunk.split(/\r?\n/, 1)[0] ?? '').trimEnd();
      let hit = -1;
      for (let i = 0; i < normCands.length; i++) {
        if (header === `diff --git a/${normCands[i]} b/${normCands[i]}`) { hit = i; break; }
      }
      if (hit < 0) continue; // 头归属失败（引号路径等异常）→ 保守跳过（不收编）
      const p = normCands[hit]!;
      if (chunk.trim() && classifyStranded(p, chunk) !== 'manual') out.push(p);
    }
  } catch {
    /* git diff 失败跳过（保守：不收编） */
  }
  return out;
}
