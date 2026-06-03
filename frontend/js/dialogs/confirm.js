// 悬浮确认框
function showConfirm(msg) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center';
        const box = document.createElement('div');
        box.style.cssText = 'background:var(--surf);border:1px solid var(--bd);border-radius:10px;padding:16px;max-width:360px;box-shadow:0 8px 24px rgba(0,0,0,.5)';
        box.innerHTML = `
            <div style="font-size:12px;color:var(--txt);margin-bottom:12px;white-space:pre-wrap">${esc(msg)}</div>
            <div style="display:flex;gap:8px;justify-content:flex-end">
                <button id="cf-cancel" style="padding:5px 14px;border-radius:5px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:11px">取消</button>
                <button id="cf-ok" style="padding:5px 14px;border-radius:5px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer;font-size:11px">确定</button>
            </div>
        `;
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        box.querySelector('#cf-cancel').onclick = () => { overlay.remove(); resolve(false); };
        box.querySelector('#cf-ok').onclick = () => { overlay.remove(); resolve(true); };
        overlay.onclick = e => { if (e.target === overlay) { overlay.remove(); resolve(false); } };
    });
}

// 悬浮提示（自动消失）
function showToast(msg) {
    const existing = document.querySelector('.toast-msg');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.className = 'toast-msg';
    el.textContent = msg;
    el.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);z-index:99999;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:8px 16px;font-size:11px;color:var(--txt);box-shadow:0 4px 12px rgba(0,0,0,.4);max-width:80%;text-align:center';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}