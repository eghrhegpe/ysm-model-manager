// ===== 主题切换 =====
const TLABEL = {
  cyber: "🌙 赛博霓虹",
  warm: "☀️ 温暖木纹",
  pro: "⚪ 极简深邃",
  system: "💻 跟随系统",
};
const TMODES = ["cyber", "warm", "pro", "system"];
const DEFAULT_THEME = "system";

// 注入涟漪动画样式
const rippleStyle = document.createElement("style");
rippleStyle.textContent = `
@keyframes themeRipple {
  from { clip-path: circle(0% at var(--ripple-x, 50%) var(--ripple-y, 50%)); }
  to   { clip-path: circle(150% at var(--ripple-x, 50%) var(--ripple-y, 50%)); }
}
body.theme-ripple-active {
  animation: themeRipple .5s ease-in-out;
}
`;
document.head.appendChild(rippleStyle);

function triggerThemeRipple(e) {
  const x = ((e?.clientX || window.innerWidth / 2) / window.innerWidth * 100) + "%";
  const y = ((e?.clientY || window.innerHeight / 2) / window.innerHeight * 100) + "%";
  document.body.style.setProperty("--ripple-x", x);
  document.body.style.setProperty("--ripple-y", y);
  document.body.classList.remove("theme-ripple-active");
  // 强制 reflow 以重新触发动画
  void document.body.offsetWidth;
  document.body.classList.add("theme-ripple-active");
  setTimeout(() => document.body.classList.remove("theme-ripple-active"), 600);
}

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
  themeBtn.addEventListener("click", (e) => {
    const cur = localStorage.getItem("theme") || DEFAULT_THEME;
    const next = TMODES[(TMODES.indexOf(cur) + 1) % TMODES.length];
    triggerThemeRipple(e);
    if (window.applyTheme) window.applyTheme(next);
    localStorage.setItem("theme", next);
    themeBtn.textContent = TLABEL[next];
  });
}
bindThemeBtn();
