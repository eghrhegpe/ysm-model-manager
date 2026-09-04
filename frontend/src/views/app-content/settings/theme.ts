// ===== 设置页：主题段（ADR-040 拆分自 init.ts）=====
// ADR-044 策略 A：主题段读写统一走 utils/dom/storage.ts 的 safeGet/safeSet——
// 隐私模式（存储禁用）下 localStorage 抛错会中断 initSettings、整页失效。
// 原局部 themeGet/themeSet 收敛为共享工具（app-modules 启动链同源实现）。

import { getApp } from "../../../backend/app.ts";
import { applyTheme } from "../../../theme-core.ts";
import { safeGet, safeSet } from "../../../utils/dom/storage.ts";
import { cfg } from "./store.ts";

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

/** 初始化主题段：主题卡片点击切换 + 自动切换下拉框 */
export function initThemeSection(root: ShadowRoot): void {
  // 主题卡片：直接点击切换
  const savedTheme = safeGet("theme") || "cyber";
  const themePicker = root.getElementById("theme-picker");
  if (themePicker) {
    themePicker.querySelectorAll(".theme-card").forEach((card) => {
      card.classList.toggle("active", (card as HTMLElement).dataset.theme === savedTheme);
      card.addEventListener("click", () => {
        themePicker.querySelectorAll(".theme-card").forEach((c) => c.classList.remove("active"));
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
            const { SaveAppConfig } = await getApp();
            await SaveAppConfig(
              cfg.filesRoot || "",
              cfg.resourcepackRoot || "",
              cfg.mcRoot || "",
              cfg.linkMode || "copy",
              themeName,
            );
          } catch (e) {
            console.warn(
              "[settings] 主题保存到配置失败:",
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
          themePicker.querySelectorAll(".theme-card").forEach((c) => c.classList.remove("active"));
      } else if (mode === "time") {
        // P2 修复：applyTimeTheme 返回实际主题（warm/cyber）并写入 theme 键——
        // 原实现写 "time" 非法值，重启后 initTheme 归一化为 system，按时间段模式被静默降级
        const themeName = applyTimeTheme();
        safeSet("theme", themeName);
        if (themePicker)
          themePicker.querySelectorAll(".theme-card").forEach((c) => c.classList.remove("active"));
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
