// ===== 版本列表渲染 =====
// 注意：此文件不使用 ES Module import/export，
// 而是依赖 HTML 中 <script> 标签的顺序加载。
// 子模块函数直接定义在全局作用域中。

// 主渲染函数（仅协调模块）
async function renderVersions() {
    vg.innerHTML = '';
    if (!instances.length) {
        vg.innerHTML = '<div style="color:var(--muted);font-size:12px;text-align:center;padding:30px 0">请指定 .minecraft 目录</div>';
        return;
    }

    // 1. 数据处理
    const verSearch = document.getElementById('ver-search');
    const ysmOnly = document.getElementById('ysm-only');
    const filtered = filterInstances(instances, verSearch?.value, ysmOnly?.checked);
    const sorted = sortInstances(filtered, statuses);
    const openInstance = localStorage.getItem('openInstance');

    // 2. 渲染每个版本卡片
    sorted.forEach(ins => {
        const status = statuses.find(s => s.Name === ins.Name) || { Missing: [], Extra: [], Disabled: [] };
        const counts = calcVersionCounts(entries, status, repoRoot);
        const card = renderVersionCard(ins, status, counts, repoRoot, openInstance);
        bindVersionEvents(card, ins, status, repoRoot, refreshAll);
        vg.appendChild(card);
    });

    // 3. 更新统计
    updateVersionStats(instances, statuses, entries);
    if (typeof updateInstallBtn === "function") updateInstallBtn();
}

// 保留原 refreshAll（仅调用 renderVersions）
async function refreshAll() {
    if (!mcRoot || !repoRoot) return;
    try {
        instances = await window.go.main.App.ListVersionInstances(mcRoot);
        statuses = await window.go.main.App.GetInstanceStatus(mcRoot, repoRoot);
    } catch (e) {
        console.error('refreshAll error:', e);
        statuses = [];
    }
    renderVersions();
}
