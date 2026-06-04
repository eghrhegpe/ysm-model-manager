// ===== 主题切换 =====
function initTheme() {
  const saved = localStorage.getItem("theme") || "system";
  if (window.applyTheme) {
    window.applyTheme(saved);
  } else if (saved === "light") {
    document.body.classList.add("light");
  }
  const btn = document.getElementById("btn-theme");
  if (btn)
    btn.textContent =
      saved === "light"
        ? "☀️ 亮色"
        : saved === "system"
          ? "💻 跟随系统"
          : "🌙 暗色";
}

const themeBtn = document.getElementById("btn-theme");
if (themeBtn) {
  themeBtn.addEventListener("click", () => {
    const modes = ["dark", "light", "system"];
    const cur = localStorage.getItem("theme") || "dark";
    const next = modes[(modes.indexOf(cur) + 1) % modes.length];
    if (window.applyTheme) window.applyTheme(next);
    else document.body.classList.toggle("light");
    localStorage.setItem("theme", next);
    themeBtn.textContent =
      next === "light"
        ? "☀️ 亮色"
        : next === "system"
          ? "💻 跟随系统"
          : "🌙 暗色";
  });
}
