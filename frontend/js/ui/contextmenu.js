// 右键菜单 - 入口
let contextMenu = null;

document.addEventListener("contextmenu", e => {
    const ti = e.target.closest(".ti");
    const vh = e.target.closest(".vh");
    if (!ti && !vh) { closeContextMenu(); return; }
    if (vh) { showVersionContextMenu(e, vh); return; }
    showTreeContextMenu(e, ti);
});

document.addEventListener("click", closeContextMenu);

function closeContextMenu() {
    if (contextMenu) { contextMenu.remove(); contextMenu = null; }
}