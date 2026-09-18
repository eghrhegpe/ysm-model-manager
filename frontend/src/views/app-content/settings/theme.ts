// ===== 设置页：主题段（ADR-040 拆分自 init.ts）=====
// ADR-044 策略 A：主题段读写统一走 utils/base/storage.ts 的 safeGet/safeSet——
// 隐私模式（存储禁用）下 localStorage 抛错会中断 initSettings、整页失效。
// 原局部 themeGet/themeSet 收敛为共享工具（app-modules 启动链同源实现）。

import { applyTheme } from "@/theme-core";
import { logWarn } from "@/utils/base/primitives/log.ts";
import { safeGet, safeSet } from "@/utils/base/primitives/storage.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import { getCfg } from "./store.ts";

// 时间段主题边界（魔法数值收敛）：6:00–18:00 白天 warm，其余夜晚 cyber
const DAY_START_HOUR = 6;
const DAY_END_HOUR = 18;

/** 时间段主题切换：返回实际应用的主题名（warm 白天 / cyber 夜晚） */
function applyTimeTheme(): string {
  const hour = new Date().getHours();
  const isDay = hour >= DAY_START_HOUR && hour < DAY_END_HOUR;
  const themeName = isDay ? "warm" : "cyber";
  applyTheme(themeName);
  return themeName;
}

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

/** 初始化主题段：主题卡片点击切换 + 自动切换下拉框 */
export function initThemeSection(root: ShadowRoot): void {
  // 主题卡片：直接点击切换
  const savedTheme = safeGet("theme") || "cyber";
  const themePicker = root.getElementById("theme-picker");
  if (themePicker) {
    // 色点回填：shadow 内 var() 只会拿到当前主题，逐主题探针取真实色写 inline（见 probeThemeSwatch）
    themePicker.querySelectorAll(".theme-card").forEach((card) => {
      const sw = probeThemeSwatch((card as HTMLElement).dataset.theme || "");
      if (!sw) return;
      card.querySelectorAll<HTMLElement>("[data-var]").forEach((dot) => {
        const v = dot.dataset.var;
        if (v && v in sw) dot.style.background = sw[v as keyof typeof sw];
      });
    });
    themePicker.querySelectorAll(".theme-card").forEach((card) => {
      card.classList.toggle("active", (card as HTMLElement).dataset.theme === savedTheme);
      card.addEventListener("click", () => {
        themePicker.querySelectorAll(".theme-card").forEach((c) => {
          c.classList.remove("active");
        });
        card.classList.add("active");
        const themeName = (card as HTMLElement).dataset.theme || "";
        applyTheme(themeName);
        safeSet("theme", themeName);
        // P2 修复：主题切后同步到 ysm_config.json，保持 localStorage ↔ JSON 一致
        // P3 修复（审核，linkMode 失同步）：读 cfg.linkMode 而非闭包旧值 linkMode——
        // 原 initSettings 顶部的 const linkMode 是捕获值，用户在链接模式下拉改过后不更新，
        // 主题切换会用旧值把已改的 linkMode 覆盖回退
        void (async () => {
          try {
            const { SaveAppConfig } = await backendGetApp();
            await SaveAppConfig(
              getCfg().filesRoot || "",
              getCfg().resourcepackRoot || "",
              getCfg().mcRoot || "",
              getCfg().linkMode || "copy",
              themeName,
            );
          } catch (e) {
            logWarn(
              "settings",
              "主题保存到配置失败",
              e,
            ); /* 保存失败不影响 UI 主题，但留痕便于排障 */
          }
        })();
        // 关闭自动切换
        const autoSelect = root.getElementById("theme-auto") as HTMLSelectElement | null;
        if (autoSelect) autoSelect.value = "off";
        safeSet("theme-auto", "off");
      });
    });
  }

  // 自动切换下拉框
  // P2 修复（code_review）：theme-auto 段同样走 safe 包装——原裸 getItem 在隐私模式
  // 下抛错中断 initSettings（与主题卡片段同源），且 setItem 三处未封口
  const savedAuto = safeGet("theme-auto") || "off";
  const autoSelect = root.getElementById("theme-auto") as HTMLSelectElement | null;
  if (autoSelect) {
    autoSelect.value = savedAuto;
    autoSelect.addEventListener("change", () => {
      const mode = autoSelect.value;
      safeSet("theme-auto", mode);
      if (mode === "system") {
        applyTheme("system");
        safeSet("theme", "system");
        // 更新卡片选中态
        if (themePicker)
          themePicker.querySelectorAll(".theme-card").forEach((c) => {
            c.classList.remove("active");
          });
      } else if (mode === "time") {
        // P2 修复：applyTimeTheme 返回实际主题（warm/cyber）并写入 theme 键——
        // 原实现写 "time" 非法值，重启后 initTheme 归一化为 system，按时间段模式被静默降级
        const themeName = applyTimeTheme();
        safeSet("theme", themeName);
        if (themePicker)
          themePicker.querySelectorAll(".theme-card").forEach((c) => {
            c.classList.remove("active");
          });
      }
      // "off" 时不改变当前主题，等用户手动点卡片
    });
    // 初始化：如果 savedAuto 是 system/time，应用对应主题
    if (savedAuto === "system") {
      applyTheme("system");
    } else if (savedAuto === "time") {
      const themeName = applyTimeTheme();
      safeSet("theme", themeName);
    } else {
      applyTheme(savedTheme);
    }
  } else {
    applyTheme(savedTheme);
  }
}
