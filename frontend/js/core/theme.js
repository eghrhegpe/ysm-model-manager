// ===== 主题切换 =====
const TLABEL = {
  cyber: "🌙 赛博霓虹",
  warm: "☀️ 温暖木纹",
  pro: "⚪ 极简深邃",
  system: "💻 跟随系统",
};
const TMODES = ["cyber", "warm", "pro", "system"];

function initTheme() {
  const saved = localStorage.getItem("theme") || "system";
  if (window.applyTheme) window.applyTheme(saved);
  const btn = document.getElementById("btn-theme");
  if (btn) btn.textContent = TLABEL[saved] || TLABEL.system;
}

const themeBtn = document.getElementById("btn-theme");
if (themeBtn) {
  themeBtn.addEventListener("click", () => {
    const cur = localStorage.getItem("theme") || "cyber";
    const next = TMODES[(TMODES.indexOf(cur) + 1) % TMODES.length];
    if (window.applyTheme) window.applyTheme(next);
    localStorage.setItem("theme", next);
    themeBtn.textContent = TLABEL[next];
  });
}
