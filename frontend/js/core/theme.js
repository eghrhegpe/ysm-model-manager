// ===== 主题切换 =====
const TLABEL = {
  cyber: "🌙 赛博霓虹",
  warm: "☀️ 温暖木纹",
  pro: "⚪ 极简深邃",
  system: "💻 跟随系统",
};
const TMODES = ["cyber", "warm", "pro", "system"];
const DEFAULT_THEME = "system";

function initTheme() {
  const saved = localStorage.getItem("theme") || DEFAULT_THEME;
  if (window.applyTheme) window.applyTheme(saved);
  const btn = document.getElementById("btn-theme");
  if (btn) btn.textContent = TLABEL[saved] || TLABEL.system;
}

// 延迟到 DOM 就绪后获取按钮
function bindThemeBtn() {
  const themeBtn = document.getElementById("btn-theme");
  if (!themeBtn) {
    setTimeout(bindThemeBtn, 100);
    return;
  }
  themeBtn.addEventListener("click", () => {
    const cur = localStorage.getItem("theme") || DEFAULT_THEME;
    const next = TMODES[(TMODES.indexOf(cur) + 1) % TMODES.length];
    if (window.applyTheme) window.applyTheme(next);
    localStorage.setItem("theme", next);
    themeBtn.textContent = TLABEL[next];
  });
}
bindThemeBtn();
