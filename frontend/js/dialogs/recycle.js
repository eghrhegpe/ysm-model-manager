// 回收站对话框
async function openRecycleDialog() {
  if (!repoRoot) {
    showToast("❌ 请先选择仓库目录");
    return;
  }
  st.textContent = "⏳ 正在读取回收站...";
  let recycleEntries = [];
  try {
    recycleEntries = await window.go.main.App.ListRecycleBin(repoRoot);
  } catch (e) {
    showToast("❌ 读取回收站失败: " + e.message);
    st.textContent = "❌ 读取回收站失败";
    return;
  }
  st.textContent = "";
  if (!recycleEntries.length) {
    showToast("🗑️ 回收站为空");
    return;
  }
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center";
  const dialog = document.createElement("div");
  dialog.style.cssText =
    "width:420px;max-height:80vh;background:var(--surf);border:1px solid var(--bd);border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:8px";
  dialog.innerHTML =
    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="font-size:13px;font-weight:600">🗑️ 回收站 (' +
    recycleEntries.length +
    ' 个文件)</span><button id="btn-empty-recycle" style="margin-left:auto;padding:3px 8px;border-radius:4px;border:1px solid #e5534b;background:transparent;color:#e5534b;cursor:pointer;font-size:9px">清空回收站</button></div><div id="recycle-list" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:4px;min-height:0">';
  const listDiv = dialog.querySelector("#recycle-list");
  for (const e of recycleEntries) {
    const item = document.createElement("div");
    item.style.cssText =
      "display:flex;flex-direction:column;gap:2px;padding:5px 8px;border-radius:5px;background:var(--bg);font-size:11px";
    const name = e.Name.replace(/\.(ysm|zip|7z)\.ban$/i, ".$1");
    const size = e.Size ? fmt(e.Size) : "?";
    item.innerHTML =
      '<div style="display:flex;align-items:center;gap:6px"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--txt)" title="' +
      esc(e.Path) +
      '">' +
      esc(name) +
      '</span><span style="font-size:9px;color:var(--muted)">' +
      size +
      '</span><button class="recy-restore" data-path="' +
      esc(e.Path) +
      '" style="padding:2px 6px;border-radius:3px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);cursor:pointer;font-size:9px">↩️ 恢复</button><button class="recy-del" data-path="' +
      esc(e.Path) +
      '" style="padding:2px 6px;border-radius:3px;border:1px solid #e5534b;background:transparent;color:#e5534b;cursor:pointer;font-size:9px">🗑️ 删除</button></div><div style="font-size:9px;color:var(--muted);padding-left:2px;word-break:break-all">📂 ' +
      esc(e.Path) +
      "</div>";
    listDiv.appendChild(item);
  }
  dialog.innerHTML +=
    '</div><button id="recycle-close" style="padding:5px 0;border-radius:5px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:11px;margin-top:4px">关闭</button>';
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  dialog.querySelector("#recycle-close").onclick = () => overlay.remove();
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };
  dialog.querySelectorAll(".recy-restore").forEach((btn) => {
    btn.onclick = async () => {
      try {
        await window.go.main.App.RestoreFromRecycle(btn.dataset.path, repoRoot);
        btn.closest("div").remove();
        entries = await window.go.main.App.ScanModelEntries(repoRoot);
        buildTree();
        if (mcRoot) await refreshAll();
        const remaining = dialog.querySelectorAll(".recy-restore").length;
        dialog.querySelector('span[style*="font-size:13px"]').textContent =
          "🗑️ 回收站 (" + remaining + " 个文件)";
        if (!remaining) overlay.remove();
        st.textContent = "✅ 已恢复";
      } catch (e) {
        showToast("❌ 恢复失败: " + e.message);
      }
    };
  });
  dialog.querySelectorAll(".recy-del").forEach((btn) => {
    btn.onclick = async () => {
      if (!(await showConfirm("确定永久删除此文件？"))) return;
      try {
        await window.go.main.App.DeleteFromRecycle(btn.dataset.path);
        btn.closest("div").remove();
        const remaining = dialog.querySelectorAll(".recy-del").length;
        dialog.querySelector('span[style*="font-size:13px"]').textContent =
          "🗑️ 回收站 (" + remaining + " 个文件)";
        if (!remaining) overlay.remove();
        st.textContent = "✅ 已删除";
      } catch (e) {
        showToast("❌ 删除失败: " + e.message);
      }
    };
  });
  dialog.querySelector("#btn-empty-recycle").onclick = async () => {
    if (!(await showConfirm("确定永久清空回收站所有文件？此操作不可恢复！")))
      return;
    try {
      const n = await window.go.main.App.EmptyRecycleBin(repoRoot);
      overlay.remove();
      st.textContent = "✅ 已清空 " + n + " 个文件";
      entries = await window.go.main.App.ScanModelEntries(repoRoot);
      buildTree();
      if (mcRoot) await refreshAll();
    } catch (e) {
      showToast("❌ 清空失败: " + e.message);
    }
  };
}
