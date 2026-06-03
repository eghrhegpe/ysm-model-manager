// 右键菜单 - 工具函数
function createMenu(x, y) {
    const menu = document.createElement("div");
    menu.style.cssText = "position:fixed;z-index:99999;background:var(--surf);border:1px solid var(--bd);border-radius:6px;padding:4px 0;min-width:180px;box-shadow:0 4px 12px rgba(0,0,0,.4)";
    menu.style.left = x + "px";
    menu.style.top = y + "px";
    return menu;
}

function renderMenuItems(items) {
    items.forEach(item => {
        const div = document.createElement("div");
        div.textContent = item.label;
        div.style.cssText = "padding:6px 12px;font-size:11px;color:var(--txt);cursor:pointer";
        div.onmouseenter = () => div.style.background = "var(--hover)";
        div.onmouseleave = () => div.style.background = "transparent";
        div.onclick = () => { item.action(); closeContextMenu(); };
        contextMenu.appendChild(div);
    });
}

// 复制到剪贴板
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        const toast = document.createElement("div");
        toast.textContent = "✅ 已复制: " + text.substring(0, 40) + (text.length > 40 ? "..." : "");
        toast.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:999999;background:var(--surf);border:1px solid var(--bd);border-radius:8px;padding:8px 16px;font-size:11px;color:var(--txt);box-shadow:0 4px 12px rgba(0,0,0,.4)";
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2500);
    }).catch(() => {});
}
