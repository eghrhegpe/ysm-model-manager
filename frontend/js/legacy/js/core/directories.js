// ===== 目录选择 =====
document.getElementById('btn-repo').addEventListener('click', async () => {
    const dir = await window.go.main.App.SelectDirectory();
    if (!dir) return;
    repoRoot = dir;
    window.go.main.App.SetRepoRoot(dir);
    localStorage.setItem('repoRoot', dir);
    document.getElementById('btn-repo').textContent = '📁 ' + dir;
    await saveConfig();
    await loadAll();
});

document.getElementById('btn-mc').addEventListener('click', async () => {
    const dir = await window.go.main.App.SelectDirectory();
    if (!dir) return;
    mcRoot = dir;
    localStorage.setItem('mcRoot', dir);
    document.getElementById('btn-mc').textContent = '🎮 ' + dir;
    await saveConfig();
    if (repoRoot) await loadAll();
});

// ===== 配置持久化到磁盘 =====
async function saveConfig() {
    const linkMode = localStorage.getItem('linkMode') || '';
    try {
        await window.go.main.App.SaveAppConfig(repoRoot, mcRoot, linkMode);
    } catch (e) {
        console.error('配置保存失败:', e);
    }
}
