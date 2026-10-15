// ===== 设置页：主题段（ADR-040 拆分自 init.ts）=====
// ADR-044 策略 A：主题段读写统一走 utils/base/storage.ts 的 safeGet/safeSet——
// 隐私模式（存储禁用）下 localStorage 抛错会中断 initSettings、整页失效。
// 原局部 themeGet/themeSet 收敛为共享工具（app-modules 启动链同源实现）。

import { applyTheme, applyTimeTheme, THEME_DARK } from "@/theme-core";
import { logWarn } from "@/utils/base/primitives/log.ts";
import { safeGet, safeSet } from "@/utils/base/primitives/storage.ts";
import { saveCfg } from "./path-cards.ts";

// applyTimeTheme / 时段常量已下沉至 theme-core.ts（设置页与启动链共用单源，P3 修复重启失效）

// ===== 主题卡片色点取色（运行时探针，2026-09 修）=====
// 主题色单一事实源 = document 层 variables.css（.theme-x 块，--bd 为 color-mix 派生）。
// Shadow DOM 内 document 规则不匹配 shadow 元素，自定义属性经宿主继承只透「当前主题」
// 的值——卡片上的 .theme-x 作用域类解析不到任何规则，六卡色点全同色（历史缺陷）。
// 故在 document.body 挂一个 .theme-x 探针元素，getComputedStyle 取该主题三态真实色
// （--bd 已 var 替换为 color-mix 表达式，可直接作 inline background）。
// 零硬编码：值永远来自 variables.css；加主题只需 variables.css 加块 + THEME_VALID 加名。
const SWATCH_VARS = ["bg", "accent", "bd"] as const;

function probeThemeSwatch(theme: string): Record<(typeof SWATCH_VARS)[number], string> | null {
  if (typeof document === "undefined" || !document.body) return null;
  const probe = document.createElement("div");
  probe.className = `theme-${theme}`;
  probe.style.cssText = "position:fixed;width:0;height:0;opacity:0;pointer-events:none;";
  document.body.appendChild(probe);
  try {
    const cs = getComputedStyle(probe);
    const out = {} as Record<(typeof SWATCH_VARS)[number], string>;
    for (const v of SWATCH_VARS) {
      out[v] = cs.getPropertyValue(`--${v}`).trim();
    }
    return out.bg && out.accent && out.bd ? out : null;
  } finally {
    probe.remove();
  }
}

function syncThemeCards(themePicker: ParentNode, activeTheme: string | null): void {
  themePicker.querySelectorAll<HTMLElement>(".theme-card").forEach((card) => {
    const active = card.dataset.theme === activeTheme;
    card.classList.toggle("active", active);
    card.setAttribute("aria-pressed", String(active));
  });
}

/** 色点回填：shadow 内 var() 只会拿到当前主题，逐主题探针取真实色写 inline（见 probeThemeSwatch） */
function fillThemeCardSwatches(themePicker: ParentNode): void {
  themePicker.querySelectorAll(".theme-card").forEach((card) => {
    const sw = probeThemeSwatch((card as HTMLElement).dataset.theme || "");
    if (!sw) return;
    card.querySelectorAll<HTMLElement>("[data-var]").forEach((dot) => {
      const v = dot.dataset.var;
      if (v && v in sw) dot.style.background = sw[v as keyof typeof sw];
    });
  });
}

/**
 * 主题配置落盘（saveCfg 唯一出口：未传字段取重读的最新 Go 配置）。原手抄六位置实参
 * 吃 getCfg() 快照、linkMode 还用 "copy" 字面量兜底（本页其余点均引 LINK_MODE_DEFAULT）；
 * themeAuto="off" = 点卡片即手动选主题 → 自动模式关闭（P4 口径）
 */
async function persistThemeSelection(themeName: string): Promise<void> {
  try {
    await saveCfg({ theme: themeName, themeAuto: "off" });
  } catch (e) {
    logWarn("settings", "主题保存到配置失败", e); /* 保存失败不影响 UI 主题，但留痕便于排障 */
  }
}

/**
 * 自动主题模式落盘（theme-auto 变更同步 ysm_config.json，P4 口径）。
 * P0 修复（2026-10-15 锐评）：重算后的 theme 须与 mode 同笔显式落盘——旧版只传 themeAuto
 * 并依赖 saveCfg「theme 缺省自 localStorage 兜底」，而 config-write P1 修复后缺省改走
 * 磁盘重读、不再读 localStorage，兜底链被截断：disk 里的 theme 恒停留于旧手动定格值，
 * 与 disk 优先的 initTheme 合谋成「跟随系统重启失效」。theme 传 undefined（off 分支）
 * 则 patch 不含 theme → 保磁盘重读值，沿用当前定格主题（P4 口径不变）。
 */
async function persistAutoMode(mode: string, theme?: string): Promise<void> {
  try {
    // exactOptionalPropertyTypes：theme 缺席时 patch 不得含该键（显式 undefined 非法），
    // 条件构造保证 off 分支 patch 只有 themeAuto → 磁盘重读值保定格主题
    await saveCfg(theme !== undefined ? { theme, themeAuto: mode } : { themeAuto: mode });
  } catch (e) {
    logWarn("settings", "自动主题模式保存到配置失败", e);
  }
}

/** 主题卡片：点击切换 = 手动选主题 = 自动模式关闭（P4 口径） */
function bindThemeCardClicks(root: ShadowRoot, themePicker: ParentNode): void {
  themePicker.querySelectorAll<HTMLElement>(".theme-card").forEach((card) => {
    card.addEventListener("click", () => {
      const themeName = card.dataset.theme || "";
      syncThemeCards(themePicker, themeName);
      applyTheme(themeName);
      safeSet("theme", themeName);
      // P2 修复：主题切后同步到 ysm_config.json，保持 localStorage ↔ JSON 一致
      // P3 修复（审核，linkMode 失同步）：读 cfg.linkMode 而非闭包旧值 linkMode——
      // 原 initSettings 顶部的 const linkMode 是捕获值，用户在链接模式下拉改过后不更新，
      // 主题切换会用旧值把已改的 linkMode 覆盖回退
      // P4 修复（theme-auto 落盘）：点击卡片 = 手动选主题 = 自动模式关闭 → themeAuto="off"
      void persistThemeSelection(themeName);
      // 关闭自动切换
      const autoSelect = root.getElementById("theme-auto") as HTMLSelectElement | null;
      if (autoSelect) autoSelect.value = "off";
      safeSet("theme-auto", "off");
    });
  });
}

/** 主题卡片段：色点回填 + 选中态同步 + 点击切换绑定 */
function initThemePicker(root: ShadowRoot, themePicker: ParentNode, savedTheme: string): void {
  fillThemeCardSwatches(themePicker);
  syncThemeCards(themePicker, savedTheme);
  bindThemeCardClicks(root, themePicker);
}

/**
 * 应用一次自动主题模式（只管渲染，不落盘）：system/time 分支写 theme 键 + 卡片取消选中，
 * off 不动当前主题；返回本次应用的定格主题（off 返回 null）。
 * 落盘职责唯一在 change 处理器的 persistAutoMode（P0 修复 2026-10-15 收口）——原实现里
 * system/time 分支与 change 处理器各调一次 persistAutoMode（双写），且本函数在 init 路径
 * 被调用（打开设置页即触发落盘，读路径写盘）；现渲染与落盘分离，init 路径写零。
 */
function applyAutoThemeMode(mode: string, themePicker: ParentNode | null): string | null {
  if (mode === "system") {
    applyTheme("system");
    safeSet("theme", "system");
    // 更新卡片选中态
    if (themePicker) syncThemeCards(themePicker, null);
    return "system";
  }
  if (mode === "time") {
    // P2 修复：applyTimeTheme 返回实际主题（warm/cyber）并写入 theme 键——
    // 原实现写 "time" 非法值，重启后 initTheme 归一化为 system，按时间段模式被静默降级
    const themeName = applyTimeTheme();
    safeSet("theme", themeName);
    if (themePicker) syncThemeCards(themePicker, null);
    return themeName;
  }
  // "off" 时不改变当前主题，等用户手动点卡片
  return null;
}

/** 自动切换下拉框段：初始化值 + change 绑定 + 按 savedAuto 应用初始主题 */
function initAutoThemeSelect(
  root: ShadowRoot,
  themePicker: ParentNode | null,
  savedTheme: string,
  savedAuto: string,
): void {
  // P2 修复（code_review）：theme-auto 段同样走 safe 包装——原裸 getItem 在隐私模式
  // 下抛错中断 initSettings（与主题卡片段同源），且 setItem 三处未封口
  const autoSelect = root.getElementById("theme-auto") as HTMLSelectElement | null;
  if (!autoSelect) return;
  autoSelect.value = savedAuto;
  autoSelect.addEventListener("change", () => {
    const mode = autoSelect.value;
    safeSet("theme-auto", mode);
    // P0 修复（2026-10-15 锐评）：重算主题与模式同笔落盘 ysm_config.json，与读侧
    // disk 权威（initTheme `cfg.theme` 优先）对齐——原实现只落 themeAuto，theme 恒停留
    // 旧手动定格值，「跟随系统」重启即失效（localStorage 的 "system" 又被 initTheme
    // 用 disk 陈旧值覆盖回去）。system/time 分支 applyAutoThemeMode 返回应用的定格
    // 主题，随 mode 一并落盘；off 返回 null → patch 不含 theme → 保磁盘重读值
    // （P4 口径：off 沿用当前定格主题，零行为变化）。
    const appliedTheme = applyAutoThemeMode(mode, themePicker);
    void persistAutoMode(mode, appliedTheme ?? undefined);
  });
  // 初始化：如果 savedAuto 是 system/time，应用对应主题
  applyAutoThemeMode(savedAuto, themePicker);
  if (savedAuto === "off") applyTheme(savedTheme);
}

/** 初始化主题段：主题卡片点击切换 + 自动切换下拉框 */
export function initThemeSection(root: ShadowRoot): void {
  // 主题卡片：直接点击切换
  // 缺省回退引 THEME_DARK（theme-core 单一来源）：原 "cyber" 字面量与本页其余保存点
  // （init.ts / path-cards.ts 均 `|| THEME_DARK`）同语义两种拼法——改默认主题时漏一处即漂移
  const savedTheme = safeGet("theme") || THEME_DARK;
  const themePicker = root.getElementById("theme-picker");
  if (themePicker) initThemePicker(root, themePicker, savedTheme);

  // 自动切换下拉框
  // P2 修复（code_review）：theme-auto 段同样走 safe 包装——原裸 getItem 在隐私模式
  // 下抛错中断 initSettings（与主题卡片段同源），且 setItem 三处未封口
  const savedAuto = safeGet("theme-auto") || "off";
  const autoSelect = root.getElementById("theme-auto") as HTMLSelectElement | null;
  if (autoSelect) initAutoThemeSelect(root, themePicker, savedTheme, savedAuto);
  else applyTheme(savedTheme);
}
