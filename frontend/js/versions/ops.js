// 处理安装
async function handleInstall(srcPath, customDir, insName, refreshAll) {
    const status = statuses.find(s => s.Name === insName);
    if (status && !status.HasYSM) {
        if (localStorage.getItem('skipYSMWarn') !== 'true') {
            const skip = await showConfirm('该整合包没有安装 YSM 模组，安装模型也无法使用。\n确定要继续安装吗？\n\n[勾选确定可不再提示]');
            if (!skip) return;
            localStorage.setItem('skipYSMWarn', 'true');
        }
    }
    st.textContent = '⏳ 安装中...';
    try {
        await window.go.main.App.InstallModelTo(srcPath, customDir);
        const shortName = (srcPath.split('\\').pop() || srcPath.split('/').pop() || srcPath).substring(0, 30);
        st.textContent = '✅ 已安装: ' + shortName;
        await refreshAll();
    } catch (err) {
        await window.go.main.App.AddImportLog(
            srcPath.split('/').pop(),
            srcPath,
            customDir,
            0,
            'failed',
            err.message || '安装失败'
        );
        showToast('❌ 安装失败，请查看 📋 导入日志');
    }
}

// 处理上传新模型到仓库
async function handleSyncBack(ins, repoRoot, refreshAll) {
    if (!ins || !repoRoot) { showToast('请先选择仓库目录'); return; }
    if (!await showConfirm(`确定将 ${ins.Name} 中的新模型导入仓库吗？`)) return;
    st.textContent = '⏳ 上传新模型到仓库中...';
    try {
        const n = await window.go.main.App.SyncCustomToRepo(ins.CustomDir, repoRoot);
        showSummaryDialog('✅ 上传新模型到仓库完成', n, 0, 0);
        entries = await window.go.main.App.ScanModelEntries(repoRoot);
        buildTree();
        await refreshAll();
    } catch (e) { showToast('上传新模型到仓库失败: ' + (e.message || e)); }
}
