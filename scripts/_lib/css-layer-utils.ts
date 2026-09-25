/**
 * css-layer-utils.ts — css-layer-check 的纯函数抽出（2026-09-14 契约测试缺口收口）。
 *
 * 背景：css-layer-check.ts 主体在模块顶层无条件执行 + process.exit，任何
 * import 它的文件都会在同进程内被杀掉（tests/test_css_layer_check.ts 曾因此
 * 导入即终止、断言永不执行）。本模块把 3 个「文本解析 + 文件读取」的纯函数
 * 抽出，零顶层副作用，供测试直接消费（锁定插值展开语义的回归）。
 *
 * 与 css-layer-check.ts 的分工：本模块 = 纯算法（别名解析 / 字面量读取 / 插值展开）；
 * 脚本主体 = 全仓扫描编排 + 判定 + 落盘（读文件、扫 shadow domain、exit 码）。
 */
import fs from "node:fs";
import path from "node:path";
import { tryResolveAlias } from "./alias-resolve.ts";

/**
 * 解析 import 说明符到绝对路径：
 * - `@/` 别名 / `#root` 根别名 → 经 alias-resolve 解到 frontend/src 具体文件
 * - 相对路径（`./` `../`）→ 基于 fromAbs 所在目录 resolve
 * - 裸包导入（react / three 等）→ null（不参与 shadow CSS 组装）
 */
export function resolveImportAbs(spec: string, fromAbs: string): string | null {
  if (spec.startsWith("@/") || spec.startsWith("#root")) return tryResolveAlias(spec);
  if (spec.startsWith(".")) return path.resolve(path.dirname(fromAbs), spec);
  return null;
}

/** 取被导入模块里 `export const NAME = "字面量"` 的内容（跨行字符串字面量亦可）。 */
export function readConstLiteral(src: string, name: string): string | null {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 正则用普通字符串拼接（非模板字面量）：字符类含反引号时内嵌模板字符串会被
  // Node 24 的 TS 类型剥离器误判为模板边界 → ERR_INVALID_TYPESCRIPT_SYNTAX
  const re = new RegExp(
    // biome-ignore lint/style/useTemplate: 拼接为刻意选择（上条注释：内嵌模板字面量会被 Node 24 TS 类型剥离器误判模板边界）
    "export\\s+const\\s+" + esc + "\\s*=\\s*([" + "'\u0060\"" + "])([\\s\\S]*?)\\1",
  );
  return src.match(re)?.[2] ?? null;
}

/**
 * 聚合 CSS 前展开 TS 模板插值：把 cssText 里 import 进来的 `${IDENT}` 常量就地展开，
 * 使按源文件文本正则扫类名 / @keyframes 的检查能看见插值内容。
 *
 * **为什么展开全部常量（不再只展开含 @keyframes 的）**：插值进来的常量正是本 shadow
 * 实际 adopt 的样式——`sidebar-css.ts` / `app-tree-styles.ts` 都靠 `${dropdownBaseCSS}` /
 * `${btnBaseCSS}` 引入共享串。旧实现只展开含 @keyframes 的常量（理由「不扰动检查 3
 * 判定基线」），后果是这些**真实生效的定义对检查 3 不可见**：`.dd-wrap` / `.dd-menu` 被判
 * 「未定义」（假阳性），而 `.btn-base` 仅因某句注释提过它才侥幸不被报（注释洗白，2026-09 实测）。
 * 判定基线本就该建立在「shadow 真正拿到什么」之上，故过滤条件删除。
 *
 * 最小侵入保留：
 * - 无 `${` 的文本原样返回（性能守卫：不触发 import 解析）
 * - 解析不出的 import（文件缺失 / 裸包）保持原样，不因 tooling 缺失制造新假阳性
 *
 * 对检查 1/1b/1c 无影响：共享常量里唯一的 animation 声明是 noAnimationsCSS 的
 * `animation: none !important`（extractAnimationRefs 显式跳过含 none 的体），
 * 故展开后不会新增任何 keyframe 引用。
 */
export function expandStyleInterpolations(cssText: string, fileAbs: string): string {
  if (!cssText.includes("${")) return cssText;
  const importRe = /import\s*(?:type\s+)?\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
  let out = cssText;
  for (const im of cssText.matchAll(importRe)) {
    const names = (im[1] ?? "")
      .split(",")
      .map(
        (s) =>
          s
            .trim()
            .split(/\s+as\s+/)[0]
            ?.trim() ?? "",
      )
      .filter(Boolean);
    const abs = resolveImportAbs(im[2] ?? "", fileAbs);
    if (!abs) continue;
    let src: string | null = null;
    try {
      src = fs.readFileSync(abs, "utf8");
    } catch {
      continue; // 解析不出的 import 保持原样（不因 tooling 缺失制造新假阳性）
    }
    for (const n of names) {
      // biome-ignore lint/style/useTemplate: 拼接的是被展开占位符的字面量文本本身，非模板
      const token = "${" + n + "}";
      if (!out.includes(token)) continue;
      const lit = readConstLiteral(src, n);
      if (!lit) continue;
      out = out.split(token).join(lit);
    }
  }
  return out;
}

/**
 * shadow 域是否含动效声明（`animation` / `transition` 系列的**属性位**）。
 *
 * 用途：css-layer-check 检查 4——有动效的 shadow 域必须 adopt `.no-animations` 通配桥。
 *
 * 判定要点：
 * - 前缀用负向后顾 `(?<![-\w])` 而非字符类：`--btn-transition:` 是**自定义属性**声明，
 *   前面的 `-` 若被 `[^-\w]` 收下就会误判成「本域有动效」（实测噪声源）；
 * - `transition-duration/-delay/-property` 显式列入：它们同样产生动效，漏判会让域被
 *   当成纯静态而跳过桥检查（假绿）。
 */
export function hasMotionDeclaration(cssText: string): boolean {
  return /(?<![-\w])animation\s*:|(?<![-\w])transition(?:-duration|-delay|-property)?\s*:/.test(
    cssText,
  );
}

/**
 * shadow 域是否已 adopt `.no-animations` 通配桥。
 *
 * 认可两种形态：
 *   ① 引用共享片段 `noAnimationsCSS`（`utils/dom/css.ts`，**推荐**——单一事实源）；
 *   ② 手写等价通配 `:host-context(.no-animations) *`（手抄一份也应放行，闸门不惩罚等价实现）。
 *
 * **刻意不认可逐类登记**（`:host-context(.no-animations) .foo`）：那正是漂移源头——
 * 新增组件动画不会自动被覆盖，「所有动画都可关闭」退化成假承诺。闸门的全部价值就是
 * 逼出通配形态，故此处对逐类形态判「无桥」。
 */
export function hasNoAnimationsBridge(cssText: string): boolean {
  if (/\bnoAnimationsCSS\b/.test(cssText)) return true;
  return /:host-context\(\s*\.no-animations\s*\)\s*\*/.test(cssText);
}

/**
 * 注释完整性探测：返回「注释体内误写星号加斜杠（即块注释闭合符）导致提前闭合」后
 * 残留的游离闭合符下标（无则 -1）。
 *
 * 原理：字符串感知扫描——先识别字符串 / 模板字面量区间（字面量内的行注释符、块注释符
 * 不参与判定），再线性扫字面量外的块注释开启，按「首个闭合符」结束。
 * 若注释体里再写闭合符（历史病例：keyframe 名与斜杠连写、CSS 选择器通配符连写），
 * 注释提前结束，其后文本成为裸 CSS，剥完后仍残留游离闭合符。
 *
 * 为何严重：解析器会把裸文本当选择器、并吞掉紧随的第一个花括号块——2026 实测吞掉
 * fadeSlideUp 的 @keyframes，使 app-content 全 shadow 的入场动画静默失效（无报错，
 * getComputedStyle().animationName 仍显示名字，但 getAnimations() 为 0）。
 *
 * 为何必须字符串感知：本函数消费方是承载 CSS 的 TS 源文件（检查 5 扫 shadow 域全量 .ts），
 * 字符串 / 模板正文合法含星号紧接斜杠（CSS 文本的选择器通配、glob 模式等）——不跳过字面量
 * 会把正文里的连写误判为破注释残留，假阳性阻断 pre-push。
 */
export function findStrayCommentClose(src: string): number {
  // 单次线性扫描：字符串/模板字面量、`//` 行注释、`/* */` 块注释三态交替。
  // 字符串/模板**原文保留**（正文合法含星号斜杠连写，如 CSS 选择器通配 `.dlg-*/`、glob），
  // `//` 行注释剥除（保留换行），`/* */` 块注释体剥除。
  // 剥完后**字面量外**残留的 `*/` 即游离闭合符（注释提前闭合 → 其后裸 CSS 被解析器吞掉）。
  // 判定面：先剥除字符串区间再找 `*/`——字面量正文的合法连写不参与判定（检查 5 假阳性防线）。
  const TICK = String.fromCharCode(96);
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'" || c === TICK) {
      // 字面量原文保留（正文合法，不剥除）
      const quote = c;
      let j = i + 1;
      if (quote === TICK) {
        // 模板字面量：按「未展开的原源码」扫描——${ 插值体整体当字面量正文（不递归进内部），
        // 嵌套引号、内部花括号都不参与终止判定
        let depth = 0;
        while (j < n) {
          if (src[j] === "\\") j += 2;
          else if (src[j] === "$" && src[j + 1] === "{") {
            depth += 1;
            j += 2;
          } else if (src[j] === "{" && depth > 0) {
            depth += 1;
            j += 1;
          } else if (src[j] === "}" && depth > 0) {
            depth -= 1;
            j += 1;
          } else if (src[j] === quote && depth === 0) {
            j += 1;
            break;
          } else j += 1;
        }
      } else {
        while (j < n) {
          if (src[j] === "\\") j += 2;
          else if (src[j] === quote) {
            j += 1;
            break;
          } else if (src[j] === "\n")
            break; // 单行字符串（TS 语义，防未终止引号吞掉整文件）
          else j += 1;
        }
      }
      out += src.slice(i, j);
      i = j;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      // 行注释整段剥除（保留换行）
      while (i < n && src[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      // 块注释按「首个闭合符」结束（与解析器同语义）；闭合符本身剥除
      while (i < n - 1 && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
      if (i < n - 1) i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  // 判定面：剥除字符串区间后再找 `*/`——字面量正文的合法星号斜杠连写不参与判定
  let idx = -1;
  for (let k = 0; k < out.length - 1; k++) {
    const ch = out[k];
    if (ch === '"' || ch === "'" || ch === TICK) {
      const quote = ch;
      let m = k + 1;
      while (m < out.length) {
        if (out[m] === "\\") {
          m += 2;
          continue;
        }
        if (out[m] === quote) {
          m += 1;
          break;
        }
        if (quote !== TICK && out[m] === "\n") break;
        m += 1;
      }
      k = m - 1;
      continue;
    }
    if (ch === "*" && out[k + 1] === "/") {
      idx = k;
      break;
    }
  }
  return idx;
}

/**
 * 跨层存在性判定（css-layer-check 检查 6 的纯函数抽出）。
 *
 * 检查 3 的判定域是「本域命名空间」，故命名空间在本域不存在的类（错名 / 从未实现）结构上落在
 * 它的盲区里——2026-09 实测残余盲区 42 类，其中 `.lt-*` 全族是真缺陷（色块空 span 恒不可见），
 * `.heatmap-bar-*` 则有内联承载、属合法无规则。本函数用**全局**口径补上对偶的另一半：
 * 一个类若在「所有 shadow 域 CSS ∪ document 层 CSS」都没有定义，就是「用了但哪儿都没定义」，
 * 正是错名断链的形态。
 *
 * 刻意**不做 JS 引用启发式**（`classList` / `querySelector` 全仓字符串扫描）：实测对偶口径
 * naive 版报 617 条、真死 0 条（绝大多数是运行时加的类），噪声换不到信号；
 * 合法无规则类一律由调用方经 `KNOWN_NO_CSS_CLASSES` 显式登记（逐类附理由）。
 *
 * @param domainUsed 域 → （类名 → 首次出现该类的模板文件名）
 * @param globallyDefined 全仓任何 CSS 层定义过的类名并集
 * @param exempt 显式豁免集（合法无规则类）
 */
export function findUndefinedAnywhereClasses(
  domainUsed: ReadonlyMap<string, ReadonlyMap<string, string>>,
  globallyDefined: ReadonlySet<string>,
  exempt: ReadonlySet<string>,
): { domain: string; cls: string; file: string }[] {
  const out: { domain: string; cls: string; file: string }[] = [];
  for (const [domain, used] of domainUsed) {
    for (const [cls, file] of used) {
      if (globallyDefined.has(cls) || exempt.has(cls)) continue;
      out.push({ domain, cls, file });
    }
  }
  return out;
}

/**
 * 选择器位类名提取（css-layer-check 检查 7 的纯函数抽出）。
 *
 * **为什么不能沿用 extractClasses 的裸正则**：检查 7 的输入是承载 CSS 的 **TS 源文件**
 * （`export const XxxCSS = \`…\``），而 TS 代码里 `.foo` 绝大多数是**属性访问**
 * （`this.root` / `deps.styleSheets.filter` / `import.meta`）——裸正则会把 `root`、
 * `filter`、`meta` 当成「定义过的类」，再被判「无消费者」而变成假阳性。
 *
 * 判定：`.` 之前不得是标识符字符 / 右括号 / 引号 / 反引号 / 点号——
 *   - TS 属性访问 `x.foo`（前是标识符）、`fn().foo`（前是 `)`）、链式 `a.b.c`（前是 `.`）→ 排除
 *   - 字符串里的 `querySelector(".foo")`（前是引号）→ 排除（那是**消费者**，不是定义）
 *   - CSS 选择器 `.foo`（前是空白 / `,` / `>` / `+` / `~` / 行首）→ 收下
 * 边界（有意）：`#id.foo`、`.a.foo` 这类复合选择器里的第二个类**收不到**——宁漏勿误报
 * （漏收只让该类的死判定更保守，误收会直接产出假 ERROR）。
 */
export function extractSelectorClasses(src: string): Set<string> {
  const classes = new Set<string>();
  const re = /(?<![\w)\]"'.`])\.[a-zA-Z][a-zA-Z0-9-]*/g;
  for (const m of stripCssComments(src).matchAll(re)) {
    const cls = m[0].slice(1);
    if (!cls.endsWith("-")) classes.add(cls);
  }
  return classes;
}

/**
 * 掩掉选择器位类名（替换为 NUL），供「消费者语料」判定：定义源文件自己写下的
 * `.foo { … }` 选择器**不算**它自己的消费者（否则每个定义都自我证明存活）。
 * 字符串里的 `class="foo"` / `querySelector(".foo")` / `classList.add("foo")`
 * 不受影响（它们前面是引号或没有点号），仍是有效消费者证据。
 */
export function maskSelectorClasses(src: string): string {
  return stripCssComments(src).replace(/(?<![\w)\]"'.`])\.[a-zA-Z][a-zA-Z0-9-]*/g, "\u0000");
}

/** _lib 内部：剥块注释与行注释（类名提取不被注释里的 `.foo` 洗白）。 */
function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<![:/])\/\/[^\n]*/g, "");
}

/** 类名是否作为**独立 token** 出现在语料中（`-`/词字符作边界：`.foo` 不匹配 `foo-bar`）。 */
function containsClassToken(corpus: string, cls: string): boolean {
  const esc = cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w-])${esc}(?![\\w-])`).test(corpus);
}

/**
 * 动态拼接提示：类名是否可由「前缀 + 变量」构造——`classList.add(\`前缀${x}\`)` /
 * `className = "前缀" + x` / `class="前缀${x}"`。仅作**提示**（附在死类告警里帮人核实），
 * **不作为豁免依据**：实测前缀判定会把 `sidebar-${verb}-selected` 误栽给 `sidebar-header`
 * （同前缀、不同族）——自动豁免会静默吞掉真死类，故豁免一律走显式登记表。
 */
export function dynamicClassHint(cls: string, corpus: string): string | null {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (let i = cls.indexOf("-"); i > 0; i = cls.indexOf("-", i + 1)) {
    const prefix = cls.slice(0, i + 1);
    const p = esc(prefix);
    if (new RegExp(`${p}\\$\\{|${p}["']\\s*\\+|\\+\\s*["']${p}`).test(corpus)) return prefix;
  }
  return null;
}

export interface DeadCssFinding {
  /** 定义源文件（相对仓库根，正斜杠） */
  file: string;
  /** 定义了但全仓无消费者的类名 */
  cls: string;
  /** 疑似动态拼接前缀（仅提示，非豁免依据）；无则 null */
  dynHint: string | null;
}

/**
 * 死 CSS 反向判定（css-layer-check 检查 7 的纯函数抽出）。
 *
 * 与 `findUndefinedAnywhereClasses`（检查 6）互为**对偶**：
 *   - 检查 6：用了、但全仓没有任何 CSS 层定义 → 漏定义 / 错名
 *   - 检查 7：定义了、但全仓没有任何消费者 → 化石层（改名/重构后留下的旧规则）
 *
 * 消费者判定 = 「类名作为独立 token 出现在语料里」。语料刻意**不做**类名启发式解析
 * （不做 `class="…"` 定点匹配）：任何形式的引用（模板属性、`classList.add("x")`、
 * `querySelector(".x")`、测试断言、Go 侧模板串）都算消费者——**宁漏勿误报**。
 *
 * @param definitions 定义源 → 该源里选择器位定义的类名集合
 * @param corpus      消费者语料（定义源的选择器位已被 maskSelectorClasses 掩掉）
 * @param exempt      显式豁免集（动态拼接族等，逐类附理由登记）
 */
export function findDeadCssClasses(
  definitions: ReadonlyArray<{ file: string; classes: ReadonlySet<string> }>,
  corpus: string,
  exempt: ReadonlySet<string>,
): DeadCssFinding[] {
  const out: DeadCssFinding[] = [];
  for (const def of definitions) {
    for (const cls of [...def.classes].sort()) {
      if (exempt.has(cls)) continue;
      if (containsClassToken(corpus, cls)) continue;
      out.push({ file: def.file, cls, dynHint: dynamicClassHint(cls, corpus) });
    }
  }
  return out;
}
