// ===== 对话框模块 =====

// 日志对话框
async function openLogDialog() {
  let logs = [];
  try {
    logs = await window.go.main.App.GetImportLogs();
  } catch {}
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center";
  const dialog = document.createElement("div");
  dialog.style.cssText =
    "width:640px;height:420px;background:var(--surf);border:1px solid var(--bd);border-radius:10px;padding:14px;display:flex;flex-direction:column";
  let logHtml =
    logs.length === 0
      ? '<div style="color:var(--muted);text-align:center;padding:20px">暂无导入记录</div>'
      : [...logs]
          .reverse()
          .map((l) => {
            const sColor =
              l.Status === "success"
                ? "#2ea44f"
                : l.Status === "skipped"
                  ? "#f9a826"
                  : "#ff6";
            const sText =
              l.Status === "success"
                ? "✅成功"
                : l.Status === "skipped"
                  ? "⏭️跳过"
                  : "❌失败";
            return (
              '<div style="padding:4px 0;border-bottom:1px solid var(--bd)"><div style="display:flex;justify-content:space-between"><span style="font-weight:600">' +
              esc(l.ModelName) +
              '</span><span style="color:' +
              sColor +
              '">' +
              sText +
              '</span></div><div style="color:var(--muted)">📅 ' +
              new Date(l.Timestamp).toLocaleString() +
              " | 📦 " +
              fmt(l.FileSize) +
              '</div><div style="color:var(--muted);word-break:break-all">📂 ' +
              esc(l.SourcePath) +
              "</div>" +
              (l.ErrorMsg
                ? '<div style="color:#ff6">⚠️ ' + esc(l.ErrorMsg) + "</div>"
                : "") +
              '<button class="log-copy-btn" data-info="' +
              esc(
                l.ModelName +
                  " | " +
                  l.Status +
                  " | " +
                  l.SourcePath +
                  (l.ErrorMsg ? " | " + l.ErrorMsg : ""),
              ) +
              '" style="padding:1px 5px;font-size:8px;border-radius:3px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;margin-top:2px">📋 复制</button>' +
              "</div>"
            );
          })
          .join("");
  dialog.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h3 style="font-size:13px">📋 导入日志</h3><div style="display:flex;gap:4px"><button id="log-copy-all" style="padding:2px 8px;font-size:10px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--txt);cursor:pointer">📋 复制全部</button><button id="log-refresh" style="padding:2px 8px;font-size:10px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer">🔄 刷新</button><button id="log-clear" style="padding:2px 8px;font-size:10px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:#ff6;cursor:pointer">🗑️ 清空</button><button id="log-close" style="padding:2px 8px;font-size:10px;border-radius:4px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer">关闭</button></div></div><div style="flex:1;overflow-y:auto;background:var(--bg);border-radius:5px;padding:6px;font-size:10px">' +
    logHtml +
    "</div>";
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  dialog.querySelector("#log-close").onclick = () => overlay.remove();
  dialog.querySelector("#log-refresh").onclick = () => {
    overlay.remove();
    openLogDialog();
  };
  dialog.querySelectorAll(".log-copy-btn").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const text = e.target.dataset.info;
      navigator.clipboard.writeText(text).then(() => {
        e.target.textContent = "✅ 已复制";
        setTimeout(() => {
          e.target.textContent = "📋 复制";
        }, 1500);
      });
    };
  });
  dialog.querySelector("#log-clear").onclick = async () => {
    if (confirm("确定清空所有日志？")) {
      await window.go.main.App.ClearImportLogs();
      overlay.remove();
      openLogDialog();
    }
  };
  // 复制所有日志到剪贴板
  dialog.querySelector("#log-copy-all").onclick = () => {
    const allText = logs
      .map(
        (l) =>
          l.ModelName +
          " | " +
          l.Status +
          " | " +
          l.SourcePath +
          (l.ErrorMsg ? " | " + l.ErrorMsg : ""),
      )
      .join("\n");
    navigator.clipboard.writeText(allText).then(() => {
      dialog.querySelector("#log-copy-all").textContent = "✅ 已复制";
      setTimeout(() => {
        dialog.querySelector("#log-copy-all").textContent = "📋 复制全部";
      }, 1500);
    });
  };
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };
}
