// 绑定版本卡片事件（展开/收起、反向同步、安装）
function bindVersionEvents(card, ins, status, repoRoot, refreshAll) {
    const head = card.querySelector('.vh');
    const body = card.querySelector('.vb');

    // 展开/收起
    head.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        toggleVersionCard(head, body, ins.Name);
    });

    // 反向同步按钮
    const syncBackBtn = card.querySelector('.sync-back-btn');
    syncBackBtn?.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        await handleSyncBack(ins, repoRoot, refreshAll);
    });

    // 安装按钮
    const installBtns = card.querySelectorAll('button[data-path]');
    installBtns.forEach(btn => {
        btn.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            await handleInstall(
                ev.target.dataset.path,
                ev.target.dataset.customDir,
                ins.Name,
                refreshAll
            );
        });
    });
}

// 切换版本卡片展开状态
function toggleVersionCard(head, body, insName) {
    const isOpen = head.dataset.open === 'true';
    if (isOpen) {
        head.dataset.open = 'false';
        body.style.display = 'none';
        localStorage.removeItem('openInstance');
    } else {
        // 关闭其他卡片
        document.querySelectorAll('.vh[data-open="true"]').forEach(h => {
            h.dataset.open = 'false';
            h.nextElementSibling.style.display = 'none';
        });
        head.dataset.open = 'true';
        body.style.display = 'block';
        localStorage.setItem('openInstance', insName);
    }
}