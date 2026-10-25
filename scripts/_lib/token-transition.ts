/**
 * token-transition.ts — transition **实时反馈判据 + 整值精确建议**（2026-10-25 沿真缝拆出）。
 *
 * 这一簇的独特性：它判的不是「有没有用令牌」，而是「**这个过渡根本不该用令牌**」——
 * 滑块跟手这类实时反馈要求短时长 + linear，套令牌反而破坏手感。故与 style 扫描的
 * 「命中即债」哲学相反，属**豁免判据**层，必须与命中级分开审阅。
 *
 * 依赖：./token-tables.ts（TRANSITION_TOKEN_VALUES）/ ./token-types.ts。
 */
import { TRANSITION_TOKEN_VALUES } from "./token-tables.ts";
import type { TokenRawMap } from "./token-types.ts";

/**
 * 「实时反馈」类过渡的属性白名单——这些属性上的短时长 + `linear` **不适用令牌体系**。
 *
 * 为什么需要（实测教训）：滑块跟手（`.cs-fill { transition: width 0.06s linear }`、
 * `.cs-thumb { transition: left 0.06s linear }`）语义是**跟手**而非**缓动**——它跟随
 * pointermove 的实时位置，每帧都在重设目标值。这类过渡若套 `--tr-fast`（0.12s）会
 * 叠加进拖拽回路，观感从「跟手」退化为「拖泥带水」。
 *
 * 因此本仓 `docs/UI-Design.md` §7 明确把「拖拽跟手 / 进度条填充」列为**不违规例外**。
 * 本表是该例外在判定层的唯一表达，**不是豁免清单**：它描述的是「这类过渡不适用令牌」
 * 这一条**规则**，而非「这几个文件不要报」——后者会与 baseline 形成双真相源并漂移。
 *
 * 准入三条（须同时满足，见 `isRealtimeFeedbackTransition`）：
 *   ① 属性属于跟手类（几何位移/尺寸：width/height/left/top/right/bottom/transform 的位移分量）；
 *   ② 缓动为 `linear`（跟手必须线性；缓动函数会让位置滞后于指针）；
 *   ③ 时长 < 0.1s（足够短以致不被感知为「动画」，纯为消除抖动）。
 */
export const REALTIME_FEEDBACK_PROPS: ReadonlySet<string> = new Set([
  "width",
  "height",
  "left",
  "top",
  "right",
  "bottom",
]);

/** 实时反馈类过渡的时长上限（秒）——达到或超过即视为常规过渡，须套令牌。 */
export const REALTIME_FEEDBACK_MAX_SECS = 0.1;

/**
 * 判定一条 transition 是否属「实时反馈」（跟手）——是则**不适用令牌**，报告层应放过。
 *
 * 与 `suggestTransitionToken` 的关系：后者按「时长是否撞令牌」机械匹配，会把它当成
 * 「无对应令牌的硬编码时长」；本函数在报告层**先于**令牌匹配生效，识别出跟手语义后
 * 直接排除，避免规则把一条正确的写法长期挂在基线里当「永远不会修的债」。
 *
 * 只处理**单属性**值（`width 0.06s linear`）；多属性值返回 false（交由既有逻辑报告）。
 *
 * @param value transition 属性值（如 `width 0.06s linear`）
 */
export function isRealtimeFeedbackTransition(value: string): boolean {
  const v = value.trim();
  if (!v || v.includes(",")) return false;
  const m = /^([a-z-]+)\s+(\d*\.?\d+)(s|ms)\s*(.*)$/i.exec(v);
  if (!m) return false;
  const prop = (m[1] ?? "").toLowerCase();
  if (!REALTIME_FEEDBACK_PROPS.has(prop)) return false;
  const rawNum = Number(m[2]);
  const secs = m[3] === "ms" ? rawNum / 1000 : rawNum;
  if (!(secs < REALTIME_FEEDBACK_MAX_SECS)) return false; // 须严格短于上限
  const ease = (m[4] ?? "").trim().toLowerCase();
  return ease === "linear"; // 跟手必须线性
}

/**
 * 自定义缓动函数判定（`cubic-bezier(...)` / `steps(...)`）——命中则该过渡**不套令牌**。
 *
 * 为什么需要：`--tr-*` 三档的缓动是固定关键字（`ease` / `ease-out`），**无法表达回弹
 * （overshoot）或阶跃**。本仓有多处刻意的回弹动效（如 `.stat-card .num` 的 bump
 * `cubic-bezier(.34,1.56,.64,1)`、`.rec-card` hover 上浮），套任一令牌都会把回弹抹成
 * 直落——那是把设计意图当债务。故这类按 UI-Design.md §7「说明为何非它不可」豁免。
 *
 * 与 `isRealtimeFeedbackTransition` 并列，同属**规则**（哪类写法不适用令牌），
 * 不是文件/行号豁免清单（后者会与 baseline 形成双真相源）。
 */
export function hasCustomEasing(value: string): boolean {
  return /cubic-bezier\(|steps\(/i.test(value);
}

/**
 * 「非它不可」注释豁免标记（UI-Design.md §7 的机器可读出口）。
 *
 * 用法：在**同一行**的 CSS 注释里写 `tr-exempt: <理由>`，该行的 transition 即不报。
 *   `.x { transition: opacity .4s; /* tr-exempt: 涟漪需缓慢浮现 *\/ }`
 *
 * 为什么必须同行：判定层是**逐行**纯函数（`findStyleAttrViolations(line, lineNo, …)`），
 * 不持有上文；跨行回溯会把签名与所有调用方一起复杂化，收益不抵成本。
 *
 * 这是**最后手段**，仅在「既非跟手、又无自定义缓动、且现有三档确实表达不了」时使用——
 * 每处命中都应在注释里写清理由，便于 review 与未来复审。
 */
export const TR_EXEMPT_MARKER = "tr-exempt";

/** 缓动关键字白名单（用于区分「缓动缺省」与「显式写了别的缓动」）。 */
const EASE_KEYWORDS = new Set([
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "linear",
  "step-start",
  "step-end",
]);

/**
 * transition 值 → **可整值替换**的令牌名（时长与缓动双双一致才返回，否则 null）。
 *
 * 与 `suggestTransitionToken`（只比时长，供报告）严格区分：本函数是 **--fix 的准入闸**。
 *
 * 三条安全前提（缺一不可，均为「不改语义」服务）：
 *   ① **单属性单时长**：值形如 `<prop> <dur> [<ease>]`。多属性值
 *      （`background .12s, color .12s`）**一律不整值替换**——用 `var(--tr-fast)` 覆盖
 *      会把两个属性塌缩成一个，语义直接丢失。这类由报告层提示、人工逐条处理。
 *   ② **时长与令牌相等**（数值级，`.12s` 与 `0.12s` 视为同）。
 *   ③ **缓动与令牌相等**：缺省缓动按 CSS 规范视为 `ease`；显式写了 `linear` /
 *      `cubic-bezier(...)` 等与令牌不同的一律拒绝——否则会把「平滑 ease」偷偷换成
 *      「减速 ease-out」，属静默改变动效观感。
 *
 * @param value     transition 属性值（如 `background .12s ease`）
 * @param tokenMap  已解析令牌映射（校验令牌真实存在）
 */
export function suggestTransitionTokenExact(
  value: string,
  tokenMap?: TokenRawMap | null,
): string | null {
  const v = value.trim();
  if (!v || v.includes(",")) return null; // 前提①：多属性不整值替换
  const m = /^([a-z-]+)\s+(\d*\.?\d+)(s|ms)\s*(.*)$/i.exec(v);
  if (!m) return null;
  const prop = (m[1] ?? "").toLowerCase();
  if (prop === "none") return null; // `transition: none` 之类
  const rawNum = Number(m[2]);
  const secs = m[3] === "ms" ? rawNum / 1000 : rawNum;
  const easeRaw = (m[4] ?? "").trim();
  // 缓动可能是多值（`ease 0.1s` 之类非常规写法）——只认单 token 或空
  if (easeRaw.includes(" ")) return null;
  const ease = easeRaw === "" ? "ease" : easeRaw.toLowerCase(); // 前提③：缺省 = ease
  if (easeRaw !== "" && !EASE_KEYWORDS.has(ease)) return null; // cubic-bezier()/steps() 等不碰

  for (const [name, tok] of Object.entries(TRANSITION_TOKEN_VALUES)) {
    if (Math.abs(tok.dur - secs) > 1e-6) continue;
    if (tok.ease !== ease) continue;
    if (tokenMap && !tokenMap.has(name)) continue;
    return name;
  }
  return null;
}
