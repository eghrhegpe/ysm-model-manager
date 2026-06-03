// ===== 展开/折叠全部 =====
document.getElementById('btn-enable-all').addEventListener('click', () => {
    tree.querySelectorAll('.ti:not(.open) > .ar').forEach(ar => ar.closest('.ti')?.click());
});
document.getElementById('btn-disable-all').addEventListener('click', () => {
    tree.querySelectorAll('.ti.open > .ar').forEach(ar => ar.closest('.ti.open')?.click());
});

// ===== 同步全部 =====
document.getElementById('btn-sync-all').addEventListener('click', async () => {
    if (!mcRoot || !repoRoot) { showToast('请先选择仓库和游戏目录'); return; }
    const totalMissing = (statuses || []).filter(x => x.HasYSM).reduce((s, x) => s + (x.Missing ? x.Missing.length : 0), 0);
    if (totalMissing > 0) {
        await doSyncMissing();
    } else {
        await doSyncAll();
    }
});

// ===== 对话框按钮 =====
document.getElementById('btn-recycle').addEventListener('click', () => openRecycleDialog());
document.getElementById('btn-logs').addEventListener('click', () => openLogDialog());
document.getElementById('btn-settings').addEventListener('click', () => openSettingsDialog());
document.getElementById('btn-refresh').addEventListener('click', () => loadAll());
document.getElementById('btn-dedup').addEventListener('click', () => doDeduplicate());
document.getElementById('btn-sync-toggle').addEventListener('click', async () => {
    if (!mcRoot || !repoRoot) { showToast('请先选择仓库和游戏目录'); return; }
    st.textContent = '⏳ 同步状态中...';
    try {
        statuses = await window.go.main.App.GetInstanceStatus(mcRoot, repoRoot);
        renderVersions();
        updateInstallBtn();
        st.textContent = '就绪';
        showToast('✅ 同步状态已刷新');
    } catch (e) { showToast('同步状态刷新失败: ' + (e.message || e)); st.textContent = '❌ 失败'; }
});

// ===== 上传按钮 =====
document.getElementById('btn-upload').addEventListener('click', async () => {
    if (!mcRoot || !repoRoot) { showToast('请先选择仓库和游戏目录'); return; }
    const repoNames = new Set(entries.map(e => e.Name));
    const pendingList = [];
    statuses.forEach(s => {
        if (s.Extra) {
            s.Extra.forEach(name => {
                if (!repoNames.has(name)) {
                    // 从 instances 找到对应的 CustomDir
                    const ins = instances.find(x => x.Name === s.Name);
                    pendingList.push({ name, customDir: ins ? ins.CustomDir : '' });
                }
            });
        }
    });
    if (!pendingList.length) { showToast('没有待上传的模型，请先同步'); return; }
    if (!await showConfirm('将 ' + pendingList.length + ' 个待上传模型上传到仓库？')) return;
    st.textContent = '⏳ 上传中...';
    let ok = 0, fail = 0;
    const detailList = [];
    for (const item of pendingList) {
        if (!item.customDir) { fail++; detailList.push({ name: item.name, type: 'fail' }); continue; }
        try {
            const n = await window.go.main.App.SyncCustomToRepo(item.customDir, repoRoot);
            if (n > 0) { ok++; detailList.push({ name: item.name, type: 'success' }); }
            else { fail++; detailList.push({ name: item.name, type: 'fail', detail: '仓库已有同名文件' }); }
        } catch (e) { fail++; detailList.push({ name: item.name, type: 'fail', detail: e.message || '未知错误' }); }
    }
    showSummaryDialog('📤 上传完成', ok, 0, fail, null, detailList);
    entries = await window.go.main.App.ScanModelEntries(repoRoot);
    buildTree();
    if (mcRoot) await refreshAll();
});

// ===== 搜索/筛选 =====
document.getElementById('ver-search').addEventListener('input', () => renderVersions());
document.getElementById('ysm-only').addEventListener('change', () => renderVersions());

// ===== 仓库搜索 =====
searchInput.addEventListener('input', () => {
    buildTree();
});

sortSelect.addEventListener('change', () => {
    buildTree();
});