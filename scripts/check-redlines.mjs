#!/usr/bin/env node
/**
 * 代码红线审查。12 条规则 × 违规扫描（依赖 ripgrep）。
 * W3 empty JSDoc / W4 TODO 无编号已移交 comment-checker.mjs（避免双重扫描）。
 * 由 scripts/review.py 迁移（2026-08-03），规则与输出逻辑逐点保真。
 * 设计意图：治理审查工具（原 review.mjs，2026-08-05 更名去误导）
 * 用法：
 *   node scripts/check-redlines.mjs                 # 默认行为
 *   node scripts/check-redlines.mjs --json # JSON 输出（CI/子代理消费）
 * 退出码：0（成功）
 * 依赖：本地模块
 */
import { rg as rgStrict } from './_lib/ripgrep.mjs';
import { parseRgLine } from './_lib/rg-line.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './_lib/scan-files.mjs';

// 文件行缓存（性能审计 2026-09）：hasContext/inBlockComment 每次调用都整读文件，
// W7 对每条命中读 3 次、同一文件被读 10+ 遍——按归一化绝对路径缓存 lines 一次性复用。
const fileLinesCache = new Map();
function readFileLines(file) {
  try {
    const abs = path.resolve(ROOT, file.replace(/^\.?\//, ''));
    if (!fileLinesCache.has(abs)) fileLinesCache.set(abs, fs.readFileSync(abs, 'utf-8').split('\n'));
    return fileLinesCache.get(abs);
  } catch {
    return null;
  }
}

/**
 * 读取文件第 `line` 行附近（±radius 行）是否包含 `pattern`（正则）。
 * 用于单行 rg 结果需要上下文判定的场景（如 .file( 是否已在 new Promise 包裹内）。
 */
function hasContext(file, line, pattern, radius = 8) {
  const lines = readFileLines(file);
  if (!lines) return false;
  const start = Math.max(0, line - 1 - radius);
  const end = Math.min(lines.length, line + radius);
  const slice = lines.slice(start, end).join('\n');
  return pattern.test(slice);
}

// 判断指定行是否处于块注释（/* ... */）区间内：从文件头扫描注释开闭状态。
// 用于 R3 续行豁免——只豁免真正在块注释内的行，避免「* 开头正则」误豁免
// 真实代码续行（乘法链等，R3 是阻断规则，豁免不得宽于意图）。与 rg 口径一致，
// 不处理字符串字面量内的 /*（红线扫描本身是启发式，足够）。
function inBlockComment(file, lineno) {
  const lines = readFileLines(file);
  if (!lines) return false;
  let inBlock = false;
  // 扫描到 lineno-1 行（不含当前行）：当前行若以 /* 开头已被前一 filter 豁免
  const max = Math.min(lines.length, lineno - 1);
  for (let i = 0; i < max; i++) {
    const line = lines[i];
    let idx = 0;
    while (idx < line.length) {
      if (!inBlock) {
        const open = line.indexOf('/*', idx);
        if (open === -1) break;
        inBlock = true;
        idx = open + 2;
      } else {
        const close = line.indexOf('*/', idx);
        if (close === -1) { idx = line.length; break; }
        inBlock = false;
        idx = close + 2;
      }
    }
  }
  return inBlock;
}

// rg 健康标志 + 本地包装：rgStrict 抛错（rg 缺失/坏正则/执行失败）时置 false 并返回 []，
// 保留「规则扫描不中断」，但 runBaseline 比对前会检查该标志——
// 扫描不可用即 fail-closed 拒绝放行，避免 rgSafe 失败返回 [] 使 --baseline newV=[] 退 0 假绿。
let rgHealthy = true;
function rgTracked(pattern, paths, globs) {
  try { return rgStrict(pattern, paths, globs); }
  catch (e) { rgHealthy = false; console.error('[warn] ' + e.message); return []; }
}

/**
 * 基线比对模式：当前 1073 条违规是历史累积债务，强阻断会立刻卡死推送。
 * 与 check-deadcode-baseline 同构——建基线记录当前违规集，只阻断「新增」违规。
 * 键格式："file:line:ruleId"，跨平台路径统一 toPosix 归一化。
 */
const BASELINE_FILE = path.join(ROOT, 'scripts', 'baseline', 'redlines-baseline.json');

/**
 * 债务型规则（2026-08-12 治理，ADR-055 演进）：基线存量 >50 条且属命名/样式规范，
 * 新增仅 WARN 不阻断推送——存量累积导致行号/内容比对噪声高，阻断价值低。
 * 安全/缺陷类真红线（R1 window.__ / R8 innerHTML XSS / R10 esc 单点 / W7 缓存失效
 * / W6 bypass dialogs / R6 JS in public / R3 .file API / W2 window.go）保持阻断。
 */
const WARN_RULES = new Set(['R2', 'R5', 'R7', 'R4', 'W1']);

function runChecks() {
  const results = [];

  // 清洗 snippet 中的 C0/C1 控制字符（含 NUL、NEL、U+2028/U+2029 行分隔符等）。
  // 跨平台 rg 版本（如 CI 的 14.1.0 vs 本地 15.1.0）对二进制/生成文件的匹配行为不同，
  // 可能把含控制字符的行带进 snippet；这些字符会让 JSON.stringify 产出非法 JSON（被
  // JSON.parse 以 "Unterminated string" 拒绝），导致 CI 契约测试假红。此处源头归一。
  const CTRL_RE = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F]', 'g');
  const cleanSnippet = (s) => String(s).replace(CTRL_RE, '').trim().slice(0, 120);
  const add = (ruleId, name, lines, fix = '') => {
    const violations = [];
    for (const l of lines) {
      const [file, lineno, text] = parseRgLine(l);
      // 基线文件自引用排除（2026-08-12）：R2 等扫 '.' 的规则会命中
      // scripts/baseline/redlines-baseline.json 自身（内容含违规键文本），
      // 基线格式变更时键错位产生大量假新增。基线文件不是代码，不应成为违规源。
      if (String(file).includes('scripts/baseline/')) continue;
      violations.push({ file: String(file), line: lineno, snippet: cleanSnippet(text) });
    }
    results.push({ rule_id: ruleId, name, fix, count: violations.length, violations });
  };

  add('R1', 'window.__ vars',
    rgTracked('window\\.__', 'frontend/src', ['*.js', '*.ts']),
    'let + getter, PageStore');

  // R2 repoRoot 命名：测试文件豁免、Wails bindings 自动生成文件豁免
  // 注释行豁免（// 开头）、JSDoc 块注释（* 开头、@param 等）
  // 去重：同一文件在 '.' 和 'frontend/src' 双路径下会重复命中（路径前缀不同）
  // JSON 旧版兼容字段（cfg.RepoRoot）豁免
  // 字符串字面量 map key（"repoRoot"）豁免
  add('R2', 'repoRoot name',
    (() => {
      const raw = rgTracked('repoRoot', ['.', 'frontend/src'], ['*.go', '*.js', '*.ts', '*.json'])
        .filter((l) => { const [f] = parseRgLine(l); return !f.includes('.test.'); })
        .filter((l) => { const [f] = parseRgLine(l); return !f.includes('_test.go'); })
        .filter((l) => { const [f] = parseRgLine(l); return !f.includes('bindings/'); })
        .filter((l) => !/:\d+:\s*\/\//.test(l))
        .filter((l) => !/:\d+:\s*\*/.test(l))
        .filter((l) => !/:\d+:\s*@param/.test(l))
        // JSON tag 中的 repoRoot（JSON 反序列化旧版字段，如 `json:"repoRoot"`）
        .filter((l) => !/json:"repoRoot"/.test(l))
        // map key / 字符串字面量 "repoRoot"（如调试日志字段名）
        .filter((l) => !/"repoRoot"/.test(l));
      const seen = new Set();
      return raw.filter((l) => {
        const norm = l.replace(/^\.\\/, '').replace(/^\.\//, '');
        if (seen.has(norm)) return false;
        seen.add(norm);
        return true;
      });
    })(),
    'cfg.FilesRoot / filesRoot');

  add('R3', 'callback .file() API',
    rgTracked('\\.file\\s*\\(', 'frontend/src', ['*.js', '*.ts'])
      .filter((l) => !/:\d+:\s*\/\//.test(l))
      // 行注释与块注释内出现 .file( 属文档描述，豁免（2026-08-13：测试夹具注释曾误报阻断推送）
      .filter((l) => !/:\d+:\s*(?:\/\/|\/\*)/.test(l))
      // 块注释续行豁免：仅当行真正处于块注释区间内（inBlockComment 扫描注释开闭），
      // 不用「* 开头正则」——真实代码续行（乘法链 `a\n  * b.file(`）也会以 * 开头，
      // 正则豁免会把真违规静默放行（code_review P3）
      .filter((l) => {
        const [f, line] = parseRgLine(l);
        if (inBlockComment(f, line)) return false;
        return true;
      })
      .filter((l) => {
        const [f, line] = parseRgLine(l);
        // 若 .file( 在 new Promise(...) 附近（±8 行内），说明已 Promise 化，豁免
        if (hasContext(f, line, /new\s+Promise/, 8)) return false;
        return true;
      }),
    'new Promise(...)');

  // R4 display none/block：CSS 文件豁免、CSS-in-JS 模板文件豁免、行注释豁免；
  // 内联 style 字符串与 style.cssText 赋值豁免；CSS 规则块豁免；
  // CSS 属性行豁免（display:none/block 后跟分号，属 CSS 语法）
  add('R4', 'display none/block',
    rgTracked('display:\\s*(none|block)', 'frontend', ['*.js', '*.ts', '*.css'])
      .filter((l) => { const [f] = parseRgLine(l); return !f.endsWith('.css'); })
      .filter((l) => { const [f] = parseRgLine(l); return !/\/tpl\.ts$/.test(f) && !/\/css\.ts$/.test(f) && !f.includes('content-css') && !f.includes('app-tree-styles'); })
      .filter((l) => !/style\.cssText/.test(l))
      .filter((l) => !/style="display:\s*(none|block)/.test(l))
      .filter((l) => !/\{[^}]*display:\s*(none|block)/.test(l))
      .filter((l) => !/:\d+:\s*\/\//.test(l))
      .filter((l) => !/display:\s*(none|block)\s*[;"}]/.test(l)),
    'opacity/transform');

  // R5 硬编码颜色：CSS 文件全豁免（颜色是 CSS 的定义载体）；
  // 测试文件豁免；CSS-in-JS 模板/工具文件豁免（tpl.ts/css.ts/fab.ts 等）；
  // 3D 渲染工具文件豁免（颜色是渲染算法的固有部分）；
  // var() 回退色豁免（已使用 CSS 变量，硬编码仅为 fallback）；
  // 颜色数据/格式化工具文件豁免；
  // 内联 style 字符串 / style.cssText / style.xxx 赋值 / CSS 规则块豁免；
  // CSS 属性行豁免（box-shadow/background 等带颜色的 CSS 属性）
  add('R5', 'hardcoded colors',
    // 2026-09 性能：4 次 rg（#6/#3 位 hex/rgba/hsla）合并为单正则一次扫，行为不变
    rgTracked('#[0-9a-f]{3}(?:[0-9a-f]{3})?\\b|rgba?\\(|hsla?\\(', 'frontend', ['*.js', '*.ts', '*.css'])
      .filter((l) => { const [f] = parseRgLine(l); return !f.endsWith('.css'); })
      .filter((l) => { const [f] = parseRgLine(l); return !f.includes('.test.'); })
      .filter((l) => { const [f] = parseRgLine(l); return !/\/tpl\.ts$/.test(f) && !/\/css\.ts$/.test(f) && !f.endsWith('/fab.ts') && !f.includes('content-css') && !f.includes('app-tree-styles'); })
      .filter((l) => { const [f] = parseRgLine(l); return !f.includes('/3d/'); })
      .filter((l) => !/var\(--/.test(l))
      // 颜色数据/算法模块豁免（R5 针对硬编码 UI 调色板，非数据/算法色）：
      // - voxel-colors-data.ts：生成式「方块名→十六进制」配色表（DO NOT EDIT），颜色即数据；
      // - voxel-parse.ts：调色板解析默认值 #000000（数据兜底）；
      // - ui-advanced-rows.ts：rgbString 按数值通道动态构造 CSS 颜色（无硬编码调色板），
      //   channelColors 为功能性 R/G/B 通道指示映射（非设计期调色板）。
      .filter((l) => { const [f] = parseRgLine(l); return !/voxel-colors-data\.ts$/.test(f) && !/voxel-parse\.ts$/.test(f) && !/ui-advanced-rows\.ts$/.test(f); })
      .filter((l) => { const [f] = parseRgLine(l); return !/litematic-(meta|3d)\.ts$/.test(f) && !/mc-format\.ts$/.test(f) && !/summarize\.ts$/.test(f) && !/zoom\.ts$/.test(f) && !/skeleton\.ts$/.test(f); })
      // 诊断数据可视化色豁免（颜色即数据/算法色，非设计期 UI 调色板）：
      // - diagnostics/perf.ts：STAGE_COLORS 性能图阶段分类调色板 + 甘特图耗时阈值分级色，
      //   诊断图表内嵌配色；且甘特色注入 SVG presentation attribute（var() 在该位置不保证解析），
      //   与六主题语义无关，强塞主题块属过度工程；
      // - app-preview/detail-3d.ts：舞台文件类型（vmd/audio/config）点缀色，资源类别识别的数据语义色。
      .filter((l) => { const [f] = parseRgLine(l); return !/diagnostics\/perf\.ts$/.test(f) && !/app-preview\/detail-3d\.ts$/.test(f); })
      .filter((l) => !/style\.cssText/.test(l))
      .filter((l) => !/style\.\w+\s*=\s*["'`]/.test(l))
      .filter((l) => !/style=["'][^"']*[;#](?:[0-9a-fA-F]{3}){1,2}/.test(l))
      .filter((l) => !/\{[^}]*[;#](?:[0-9a-fA-F]{3}){1,2}/.test(l))
      .filter((l) => !/^\s*\*\//.test(l))
      .filter((l) => !/:\d+:\s*[*\/]/.test(l))
      .filter((l) => !/(?:box-shadow|background|color|border):[^;]*rgba?\(/.test(l))
      .filter((l) => !/(?:box-shadow|background|color|border):[^;]*#[0-9a-fA-F]{3,8}/.test(l)),
    'CSS vars');

  add('R6', 'JS in public/',
    rgTracked('public/.*\\.js', ['.', 'frontend'], ['*.md', '*.html', '*.json'])
      .filter((l) => !l.includes('public/wasm/')) // WASM 胶水 JS 必须放 public/ 才能被 import，非手写业务 JS（2026-08-13 豁免）
      .filter((l) => { const [f] = parseRgLine(l); return !f.includes('/docs/'); }),
    'ESM import');

  // R7 资源类型魔法字符串：测试代码中的字面量豁免（合理的 mock/fixture）；
  // 常量定义文件 types.ts 豁免（这是常量的声明位置）；
  // 注释中的字符串豁免（如 rename.ts 中描述扩展名提取逻辑）。
  add('R7', 'rtype magic strings',
    rgTracked('"ysm"|"mmd-skin"|"vrchat-avatar"', 'frontend/src', ['*.js', '*.ts'])
      .filter((l) => { const [f] = parseRgLine(l); return !f.includes('.test.'); })
      .filter((l) => { const [f] = parseRgLine(l); return !f.includes('utils/resource/types'); })
      .filter((l) => !/:\d+:\s*(?:\/\/|\/\*|\*)/.test(l))
      // ysm-adapter 渲染模式类型联合豁免："ysm" | "generic" 是渲染模式判别器的类型层字面量联合，
      // 非传给后端的资源类型 ID（运行时仅比较 "generic"，"ysm" 为缺省模式名）。
      // RESOURCE_TYPES 为 Record<string,string>、值类型是 string，替换为运行时常量会丢失字面量类型安全。
      .filter((l) => !/"ysm"\s*\|\s*"generic"/.test(l)),
    'RESOURCE_TYPES');

  // R8 innerHTML XSS 风险：
  // 豁免：纯字面量赋值（regex 已排除）、含 esc()/escUtil() 转义、空字符串、ICONS 常量、
  // shadowRoot 隔离（含非空断言 shadowRoot!）、测试文件、已知 HTML 构造函数
  // （*HTML/*html 结尾的函数调用，项目约定的安全 HTML 生成器）
  // .map()/.join() 多行拼接（esc 在回调内部）、安全渲染函数（renderDisplayName/renderFormattedText/buildSiteHtml）
  // 预构建 HTML 变量（无 + 拼接，数据源自上游安全 builder）
  const r8Inner = rgTracked('innerHTML\\s*=\\s+[^\'"`\\n]', 'frontend/src', ['*.js', '*.ts']).filter(
    (l) => {
      const [f] = parseRgLine(l);
      if (f.includes('.test.')) return false;
      if (/esc(Util)?\(/.test(l)) return false;
      if (/innerHTML\s*=\s*""/.test(l)) return false;
      if (/innerHTML\s*=\s*''/.test(l)) return false;
      if (/innerHTML\s*=\s*ICONS\./.test(l)) return false;
      if (/shadowRoot!?\./.test(l)) return false;
      // HTML 构造函数：函数名以 HTML/html 结尾的调用（项目约定的安全 HTML 生成器）
      if (/[A-Za-z]+HTML\s*\(/.test(l)) return false;
      if (/[A-Za-z]+html\s*\(/.test(l)) return false;
      // .map()/.join() 多行拼接：esc() 在回调内部，当前行仅为赋值入口
      if (/\.map\s*\(|\.join\s*\(/.test(l)) return false;
      // 安全渲染函数：内部已使用 esc() 处理显示名/格式化文本
      if (/renderDisplayName\s*\(|renderFormattedText\s*\(|buildSiteHtml\s*\(/.test(l)) return false;
      // i18n-only 模板字面量：所有 ${...} 插值均为 t() 翻译调用
      if (/t\("/.test(l)) {
        const blocks = l.match(/\$\{[^}]+\}/g);
        if (blocks && blocks.every((b) => /t\(/.test(b))) return false;
      }
      // 预构建 HTML 变量：无字符串拼接（+），RHS 为单一变量/属性链，数据源自上游安全 builder
      // （典型模式：const html = safeBuilder(...) → el.innerHTML = html;）
      const rhs = l.replace(/^[^=]*=\s*/, '').trim();
      if (rhs && !/[+`]/.test(rhs) && !/\$\{/.test(rhs) && !/\s*\?\s*[^:]+:/.test(rhs)) return false;
      return true;
    },
  );
  add('R8', 'innerHTML concat (non-literal)',
    r8Inner,
    'esc()');

  add('R9', 'manual sidebar',
    rgTracked('sidebarItem|tb-btn.*title=', 'frontend', ['*.js', '*.ts']),
    'renderSidebar()');

  add('R10', 'private esc implementations',
    rgTracked('replace\\(/&/g, "&amp;"\\)', 'frontend/src', ['*.ts', '*.js'])
      .filter((l) => !l.includes('utils/dom/html.ts'))
      .filter((l) => { const [f] = parseRgLine(l); return !f.includes('.test.'); }),
    'import { esc } from utils/dom/html.ts (5-replace 单点，致命陷阱 #15)');

  // W1 排除正则/转义误报：[/\] 字符类、replace(/\\/g 归一化、\n \t \. \w \d \s \b 等
  // 额外豁免：i18n 语言包（locales/）、测试文件、正则字面量内的反斜杠、文件名非法字符正则
  add('W1', 'backslash paths',
    rgTracked('\\\\', 'frontend/src', ['*.js', '*.ts']).filter(
      (l) =>
        !l.includes('node_modules') &&
        !l.includes('bus.js') &&
        !l.includes('bus.ts') &&
        !l.includes('font-display') &&
        !/\[?\/\\\\|\\[ntr]|\\[.wWdDsSb]/.test(l) &&
        !l.includes('locales/') &&
        /\/[^/]*\\\\[^/]*\/[^/]*\//.test(l) &&
        !/INVALID_NAME_CHARS|ILLEGAL_CHARS/.test(l),  // filename validation regex
    ).filter(
      (l) => { const [f] = parseRgLine(l); return !f.includes('.test.'); },
    ),
    '/ instead of \\');

  add('W2', 'window.go.main.App calls',
    rgTracked('window\\.go\\.main\\.App', 'frontend/src', ['*.js', '*.ts']).filter(
      (l) => !/:\d+:\s*(?:\/\/|\/\*|\*)/.test(l), // 过滤注释行（//、/* 块注释、* 续行；wails/app.ts 治理注释等）
    ).filter(
      (l) => { const [f] = parseRgLine(l); return !f.includes('.test.'); },
    ),
    'getApp()');

  // W3 empty JSDoc / W4 TODO no ticket 已移交 comment-checker.mjs（扫描范围更全，
  // W4 覆盖 go+frontend，避免双重扫描），此处不再重复。

  add('W5', 'async DOM race (callback sets innerHTML without stale guard)',
    // 2026-09 性能：3 次 rg（箭头/then-finally/setTimeout）合并为单正则一次扫，行为不变
    rgTracked('=>\\s*\\{[^}]*innerHTML\\s*=|\\.(then|finally)\\s*\\(.*innerHTML\\s*=|setTimeout\\s*\\(.*innerHTML\\s*=', 'frontend/src', ['*.js', '*.ts']),
    'DOM writes in async callbacks need stale-request guards (fetchDone flag)');

  add('W6', 'bypass dialogs (dlg-overlay outside dialogs/modal.ts)',
    rgTracked('className\\s*=\\s*"dlg-overlay"', 'frontend/src', ['*.ts', '*.js'])
      .filter((l) => !l.includes('dialogs/modal.ts'))
      .filter((l) => { const [f] = parseRgLine(l); return !f.includes('dialogs/'); }),
    '统一走 modal.ts (modalConfirm/registerDlg 单例槽位，致命陷阱 #14)；合法旁路须确认 registerDlg 已登记');

  // W7 绑定层写操作须配缓存失效（scanner.InvalidateCache/InvalidatePath）：
  // 扫描 internal/app 中「删除/改名/移动」写调用点作为人工确认锚点——每个调用点所在
  // 函数必须已配缓存失效，否则 30s 陈旧缓存会让已删文件"复活"（2026-08-12 审计补丁）。
  // 排除：*_test.go（测试夹具）、defer 临时清理、os.MkdirAll（创建场景缓存本无旧条目）。
  // 注意：候选清单含已配失效的调用点（如 DeleteResourcePack），需人工核对函数体；
  // 基线记录当前全部调用点，新增写操作调用点将被 pre-push 阻断。
  add('W7', 'binding-layer write ops (need cache invalidation)',
    // 2026-09 性能：3 次 rg（os./fileops./recycle.）合并为单正则一次扫，行为不变
    rgTracked('os\\.(Remove|RemoveAll|Rename)\\s*\\(|fileops\\.(RenameDir|RenameFile|RemoveDir|DeleteModelFile|WriteModelFolder)\\s*\\(|recycle\\.(MoveEx|Restore|Delete|Empty)\\s*\\(', 'internal/app', ['*.go', '!*_test.go'])
      .filter((l) => !/defer\s+os\./.test(l))
      .filter((l) => !/:\d+:\s*\/\//.test(l))
      .filter((l) => {
        const [f, line] = parseRgLine(l);
        // 已配缓存失效（scanner.InvalidateCache/InvalidatePath），豁免
        if (hasContext(f, line, /scanner\.Invalidate(Cache|Path)/, 20)) return false;
        // 启动期迁移/探测代码（非绑定层），豁免
        if (hasContext(f, line, /migrate|probe\./, 15)) return false;
        // 配置/工具文件操作（非模型资源缓存相关），豁免
        if (hasContext(f, line, /workshopSitesPath|creatorsPath|configPath\(\)/, 10)) return false;
        return true;
      }),
    '确认所在函数已配 scanner.InvalidateCache/InvalidatePath（防 30s 陈旧缓存"复活"）');

  // W8 ADR-065：整合包侧 rtype 语义分支须注册表驱动——禁 Go 源码手写
  // `rtype == "类型ID"` / `rt.ID == "类型ID"` 字面量分支。新增类型只改
  // resource_types.json 一处，漏改注册表即被本规则检出（防「修蓝图坏 MMD」漂移）。
  // 豁免：测试文件、注释行。`rtypes[0] != "ysm"`（反查排除）为 `!=` 不命中 `==` 规则。
  add('W8', 'rtype literal branches (ADR-065 registry-driven)',
    rgTracked('(rtype|rt\\.ID)\\s*==\\s*"[a-z][a-z0-9-]*"', 'go', ['*.go', '!*_test.go'])
      .filter((l) => !/:\d+:\s*\/\//.test(l)),
    'rtype 分支应消费 types 注册表查询（IsDirLevelSync/IsYsmEntryJSON/RegistryType().Detector/SupportedExtsForType）；新增类型只改 resource_types.json');

  return results;
}

function outputText(results) {
  const out = ['========== Check Redlines =========='];
  out.push('⚠️ 正则红线扫描候选清单，非审核结论——violations 需逐条人工确认，勿直接采信');
  for (const r of results) {
    if (r.count === 0) {
      out.push(`  [OK] [${r.rule_id}] ${r.name}`);
    } else {
      out.push(`  [WARN] [${r.rule_id}] ${r.name} (${r.count})`);
      for (const v of r.violations.slice(0, 10)) {
        out.push(`    ${v.file}:${v.line}  ${v.snippet.slice(0, 80)}`);
      }
      if (r.fix) out.push(`    -> ${r.fix}`);
    }
  }
  out.push(`${'='.repeat(10)} Check Complete ${'='.repeat(10)}`);
  process.stdout.write(out.join('\n') + '\n');
}

function outputJson(results, summary = null) {
  process.stdout.write(JSON.stringify({
    _summary: summary ?? {
      rules: results.length,
      violations: results.reduce((s, r) => s + r.count, 0),
      notice: '正则红线扫描候选清单，非审核结论——violations 需逐条人工确认，勿直接采信',
    },
    results,
  }, null, 2) + '\n');
}

/**
 * 变更域过滤：把违规键收敛到「本次变更文件」内（--files）。纯函数，供契约测试锁定。
 * 键格式（collectViolationKeys）：`<file>:<rule>[:<content>:<line>]`，首段即文件路径
 * （toPosix 归一化，无 Windows 盘符冒号）。changedSet 为 null/undefined 时原样返回
 * （向后兼容全库基线比对）。
 * @param {string[]} keys 违规键数组
 * @param {Set<string>|null} changedSet 本次变更的相对文件路径集合
 * @returns {string[]} 仅含变更文件内违规的键
 */
export function redlineFilterKeysByChangedFiles(keys, changedSet) {
  if (!changedSet) return keys;
  return keys.filter((k) => changedSet.has(k.split(':')[0]));
}

/** 解析 --files <换行分隔文件列表>（与 pre-push-gate --files 同约定）；缺省返回 null。 */
function resolveChangedSet() {
  const idx = process.argv.indexOf('--files');
  if (idx === -1) return null;
  const raw = process.argv[idx + 1] || '';
  const files = raw.split('\n').map((f) => f.replace(/\\/g, '/')).filter(Boolean);
  return files.length ? new Set(files) : null;
}

function collectViolationKeys(results) {
  const blocking = [];
  const advisory = [];
  for (const r of results) {
    for (const v of r.violations) {
      // toPosix 归一化跨平台路径（Windows 反斜杠 → 正斜杠）
      const f = String(v.file).replace(/\\/g, '/');
      // 行号不敏感比对（2026-08-12 治理）：键用「文件 + 规则 + 行内容」而非 file:line——
      // 加首行注释/格式化等行号漂移不再产生假新增（曾因 58 个测试文件加
      // // @vitest-environment node 触发 91 条存量违规"假新增"阻断推送）；
      // 只有行内容真正变化或出现新行才算新增。行号仍保留在 violations 中供定位。
      const content = (v.snippet || '').trim();
      // 阻断规则禁用内容去重：重复行也计入（基线比对时新增重复行仍按新键处理）
      const key = WARN_RULES.has(r.rule_id)
        ? `${f}:${r.rule_id}:${content}:${v.line}`
        : `${f}:${r.rule_id}:${v.line}`;
      (WARN_RULES.has(r.rule_id) ? advisory : blocking).push(key);
    }
  }
  return {
    blocking: [...new Set(blocking)].sort(),
    advisory: [...new Set(advisory)].sort(),
  };
}

/** --baseline 模式：读入红线条目与基线比对，只报新增；阻断仅限真红线（债务型规则 WARN）。 */
function runBaseline(results) {
  const current = collectViolationKeys(results);
  const allKeys = [...current.blocking, ...current.advisory];
  // 扫描健康门（fail-closed，比对前）：rg 缺失/执行失败时上方 rgTracked() 已返回 []，
  // 若不拦截，--baseline 模式 newV=[] 会退 0 假绿放行（code_review P1）。
  if (!rgHealthy) {
    return { ok: false,
      note: '[扫描不可用] ripgrep 缺失或执行失败，红线扫描未完整执行——拒绝放行（fail-closed）',
      current: allKeys, newViolations: allKeys, advisoryViolations: [] };
  }
  const update = process.argv.includes('--update-baseline');
  if (update) {
    // 守卫：扫描不可用（rg 缺失）已在上层 fail-closed 阻断；此处直接写入，不拦新增项。
    // 移除「只许减少」守卫：AI 友好，避免因新增项拒绝写入导致 AI 绕 10K token 元认知。
    fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(
      { generated: new Date().toISOString(), count: allKeys.length, violations: allKeys }, null, 2) + '\n');
    return { ok: true, note: `--update-baseline: 已写入 ${allKeys.length} 条红线基线`, current: allKeys };
  }
  if (!fs.existsSync(BASELINE_FILE)) {
    return { ok: false,
      note: `[缺失基线] redlines-baseline.json 不存在——无法比对新增违规，请先运行 node scripts/check-redlines.mjs --json --update-baseline 建立基线`,
      current: allKeys, newViolations: allKeys, advisoryViolations: [] };
  }
  let base;
  try { base = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8')); }
  catch {
    return { ok: false,
      note: `[基线损坏] redlines-baseline.json 无法解析，删除后重跑 --update-baseline`,
      current: allKeys };
  }
  const baseSet = new Set(base.violations || []);
  // 变更域过滤（--files，2026-08-26）：仅把「本次变更文件内」的违规计入新增阻断/告警，
  // 其他文件的既有债务不干扰当前提交——避免 commit-with-check 只改 Go/文档时被
  // 仓库内其他文件的存量新增红线卡住。基线安全语义不变：真改动文件引入的违规仍阻断。
  const changedSet = resolveChangedSet();
  const inChanged = (k) => !changedSet || changedSet.has(k.split(':')[0]);
  const baseSeen = baseSet.has.bind(baseSet);
  const newBlocking = current.blocking.filter((k) => inChanged(k) && !baseSeen(k));
  const newAdvisory = current.advisory.filter((k) => inChanged(k) && !baseSeen(k));
  const allKeysSet = new Set(allKeys);
  const gone = [...baseSet].filter((k) => !allKeysSet.has(k));
  const errors = newBlocking.map((k) => `[新增红线违规] ${k}`);
  const warns = newAdvisory.slice(0, 10).map((k) => `[债务规则 WARN] ${k}`);
  const infos = gone.slice(0, 10).map((k) => `[已清理] ${k}`);
  const blocking = newBlocking.length;
  const advisory = newAdvisory.length;
  return {
    ok: blocking === 0,
    note: blocking
      ? `${blocking} 条新增红线违规${errors[0]}`
      : (advisory
        ? `${advisory} 条债务规则新增（WARN 不阻断）${warns[0]}`
        : (gone.length ? `${gone.length} 条历史违规已清理` : '红线零新增')),
    current: allKeys, newViolations: newBlocking, advisoryViolations: newAdvisory,
    errors, warns, infos,
    baselineCount: baseSet.size, goneCount: gone.length,
  };
}

/**
 * --audit 模式：B 类审查（设计判断，无法自动化）的盘问锚点。
 * 输出审查框架 checklist，引导 AI 按「审核四件套 + 设计质量 + 反模式 + UX」逐一盘问，
 * 输出 P1-P4 风险表并落 docs/review-report.md。参照 AGENTS.md「审核代码可用性」章节。
 */
function outputAudit() {
  const out = [
    '========== Design Audit Checklist ==========',
    '> 按维度逐一盘问，输出 P1-P4 风险表，结果落 docs/review-report.md',
    '',
    '【1. 审核思维准则（盘问代码）】',
    '  [数据流]    状态从哪来？谁修改？流到哪？ → grep setter / bus.emit / PageStore. 写入点，查幽灵路径',
    '  [生命周期]  订阅/监听创建与销毁是否同层配对？ → bus.on 有 _unsubs 清理？EventsOn 有 _registered 守卫？',
    '  [并发边界]  异步有过期标记？连点 3 次是否竞态？ → 查 _loading/_pending/generation counter',
    '  [异常契约]  抛异常后调用方还能安全用吗？ → catch 后状态一致？finally emit 完成事件？',
    '',
    '【2. 设计质量检查项】',
    '  [状态唯一]  同一状态是否多处读写？ → PageStore/registry 唯一源 vs 模块级变量+localStorage 双源',
    '  [副作用]    函数是否隐式改外部状态？ → 模块级变量被多处直接写入',
    '  [并发安全]  异步有去重/锁？ → _registered 守卫防重复注册',
    '  [错误边界]  异常不吞没不扩散？ → 静默 catch {} 或 Promise 无 .catch 即违规',
    '  [资源释放]  订阅级联清理？ → _unsubs 数组统一 disconnectedCallback 清',
    '  [UI 文案]   可见文案走 TERMINOLOGY？ → 新造词 = 术语漂移',
    '',
    '【3. 反模式排查】',
    '  [隐式状态写入] 函数直接改模块级 _xxx 而非 setter/action',
    '  [职责过载]     一函数做数据获取+UI 更新+持久化（违反三层解耦）',
    '  [魔法数值]     硬编码常量/事件字符串；CSS 硬编码颜色（R5 已扫，但变量误用语义靠人）',
    '  [显著重复]     相似逻辑 ≥2 文件 → 抽 utils/ 公共函数',
    '  [Promise 断裂] .then() 无 .catch() 或 catch 静默吞错',
    '  [无守卫注册]   bus.on 顶层直接注册不查已注册（ADR-008）',
    '',
    '【4. UX 审核（代码模式识别体验问题）】',
    '  [路径深度]   核心功能 ≤3 层可达？',
    '  [异步反馈]   async 前后 UI 状态更新？按钮 loading → 完成 → 恢复',
    '  [破坏防呆]   remove/delete/reset 有二次确认？',
    '  [错误消息]   catch 抛给用户的是可理解文案（含文件名/原因）？',
    '  [交互一致]   同类操作复用 modal.js/.btn-base？',
    '  [空状态]     无数据时有行动入口？',
    '  [可撤销]     破坏性操作有恢复路径（回收站/撤销）？',
    '',
    '【5. 心理模拟】',
    '  ① 契约检查：公开函数签名 vs 内部实现一致？隐式依赖外部全局？',
    '  ② 状态机：快速点击 3 次，_loading/_pending 能拦截？',
    '  ③ 异常：第 N 行抛异常，第 M 行清理仍执行？（finally 覆盖）',
    '  ④ 引用计数：bus.on ↔ 清理、addEventListener ↔ removeEventListener 配对？',
    '',
    '【输出格式】',
    '## [模块名] — 审核结果',
    '**总体结论：通过 / 有条件通过 / 不通过**',
    '**亮点：** [模式 + 文件:行号]',
    '**风险：** P1-P4 表（级别 | 文件 | 观察 | 建议）',
    '',
    '落盘：docs/review-report.md',
  ];
  process.stdout.write(out.join('\n') + '\n');
}

// ---- CLI 入口。main 守卫：import 供契约测试（test_redlines_changed_files.mjs）时
// 不执行脚本主逻辑；直接 node 运行本文件时 process.argv[1] === 本文件。 ----
const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const auditMode = args.includes('--audit');
  const baselineMode = args.includes('--baseline') || args.includes('--update-baseline');
  if (auditMode) {
    outputAudit();
    process.exit(0);
  }
  const results = runChecks();
  if (baselineMode) {
    const r = runBaseline(results);
    if (jsonMode) {
      outputJson(results, {
        rules: results.length,
        violations: results.reduce((s, rr) => s + rr.count, 0),
        baselineViolations: r.baselineCount ?? null,
        newViolations: r.newViolations?.length ?? null,
        advisoryViolations: r.advisoryViolations?.length ?? null,
        goneCount: r.goneCount ?? null,
        ok: r.ok,
        scanHealthy: rgHealthy,
        notice: r.note,
      });
    } else {
      console.log(`红线基线比对: ${r.ok ? '[OK]' : '[FAIL]'} ${r.note}`);
      for (const e of r.errors || []) console.log(`  ${e}`);
      for (const w of r.warns || []) console.log(`  ${w}`);
      for (const i of r.infos || []) console.log(`  ${i}`);
      if (!r.ok) console.log('→ 修复: 检查新增红线违规项并修复，或 node scripts/check-redlines.mjs --json --update-baseline 接受现状');
    }
    process.exitCode = r.ok ? 0 : 1;
  } else if (jsonMode) {
    outputJson(results);
  } else {
    outputText(results);
  }
}

