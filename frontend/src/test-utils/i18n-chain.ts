// ===== `t.ts|tOf` 三层回退链的测试替身（i18n 出口类测试共享）=====
// 立因（2026-10-15 子代理复核指出）：`conflicts-rtype-label.test.ts` 与
// `dedup-rtype-label.test.ts` 各自手写了一份 tOf mock，且都**跳过了第 ② 层**——
// 生产 `tOf` 是 `当前包 → FALLBACK_LANG(en) → 裸 key` 三层（`t.ts|tOf`），
// 只在「zh 与 en 同时缺」时才落裸 key，进而触发 `rtypeLabelOf` 的注册表中文回落。
// 只缺 zh 时界面拿到的是**英文**。mock 漏掉中间层 = 把「回落中文」的概率高估，
// 也让同一套判据在两文件里各写一遍（规则一改即分叉）。故收口为本叶。
import { en } from "@/locales/en.ts";
import { zhCN } from "@/locales/zh-CN.ts";

const zhBundle = zhCN as unknown as Record<string, string>;
const enBundle = en as unknown as Record<string, string>;

/** `{name}` 插值（与 t.ts 同款语法；测试只需简单替换） */
function fill(tpl: string, params?: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_m, p: string) => params?.[p] ?? `{${p}}`);
}

export type TofChainMode =
  /** 真实三层链（zh → en → 裸 key），不掺假值 */
  | "real"
  /** 目标键族返回可辨识假译文（证明「真的走了译文通道」，而非恰好同值的中文） */
  | "translated"
  /** 目标键族 zh 缺、en 有 → 返回 **en 值**（生产里中文界面此刻显示英文，不是裸 key） */
  | "zhMissingEnHit"
  /** 目标键族两层皆缺 → 返回裸 key（`rtypeLabelOf` 靠比对 key 自身识别该形态并回落注册表名） */
  | "allMissing";

export interface TofChainOptions {
  mode?: TofChainMode;
  /** 受 mode 影响的键前缀（默认 `rtype.`——类型/分组显示名出口族） */
  family?: string;
  /** translated 模式的假译文标记（默认 `EN::`，断言据此判「走过出口」） */
  marker?: string;
}

/**
 * 生成可直接交给 `vi.fn().mockImplementation(...)` 的实现。
 * ⚠️ 必须在 `beforeEach` 里**显式安装**：`vi.mock` 工厂只在模块求值时跑一次，
 * 而 `vi.resetAllMocks()` 会清掉 mock 实现（首版即踩：图标还在、标签全空）。
 */
export function tOfChain(
  opts: TofChainOptions = {},
): (key: string, params?: Record<string, string>) => string {
  const mode = opts.mode ?? "real";
  const family = opts.family ?? "rtype.";
  const marker = opts.marker ?? "EN::";
  return (key: string, params?: Record<string, string>) => {
    const inFamily = key.startsWith(family);
    if (inFamily) {
      if (mode === "translated") return `${marker}${key}`;
      if (mode === "allMissing") return key;
      if (mode === "zhMissingEnHit") return fill(enBundle[key] ?? key, params);
    }
    // 其余键（外壳文案如 diagnostics.scanHash）走真实链：不掺假值，断言才有意义
    const v = zhBundle[key] ?? enBundle[key];
    return v === undefined ? key : fill(v, params);
  };
}

/**
 * 汉字判据（en 界面不得出现注册表中文）。**必须带 `u` 旗标**：
 * 无 u 旗标时字符类按 **UTF-16 code unit** 匹配，代理项半区（U+D800-DFFF）会落进
 * 宽区间——曾误写 U+8C48-U+FAFF，结果带图标的选择器里每个 emoji 都被判成汉字（实测踩到）。
 * 区间 = CJK 统一汉字 + 扩展 A + 兼容表意，覆盖简繁与日文汉字（假名不在内，
 * 故本判据语义是「不含汉字」而非「必须是英文」）。
 */
export const CJK_HAN_RE = /[\u3400-\u9fff\uf900-\ufaff]/u;
