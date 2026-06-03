// ===== 主题切换 =====
function initTheme() {
    const saved = localStorage.getItem('theme');
    if (saved === 'light') {
        document.body.classList.add('light');
        document.getElementById('btn-theme').textContent = '☀️ 亮色';
    }
}

document.getElementById('btn-theme').addEventListener('click', () => {
    document.body.classList.toggle('light');
    const isLight = document.body.classList.contains('light');
    document.getElementById('btn-theme').textContent = isLight ? '☀️ 亮色' : '🌙 暗色';
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
});
