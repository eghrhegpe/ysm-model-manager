// ===== preview 事件层 =====

export function bindActions(root) {
  root.getElementById("btn-install-missing")?.addEventListener("click", () => {
    bus.emit("stats:install-missing");
  });
  root.getElementById("btn-upload-extra")?.addEventListener("click", () => {
    bus.emit("stats:upload-extra");
  });
  root.getElementById("btn-refresh-stat")?.addEventListener("click", () => {
    bus.emit("stats:refresh");
  });

  // Tab 切换
  const tabs = root.querySelectorAll(".tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const name = tab.dataset.tab;
      tabs.forEach((t) => t.classList.toggle("active", t === tab));
      const statCont = root.getElementById("tab-stat");
      const logCont = root.getElementById("tab-log");
      if (statCont) statCont.style.display = name === "stat" ? "" : "none";
      if (logCont) logCont.style.display = name === "log" ? "" : "none";
      if (name === "log") bus.emit("logs:refresh");
    });
  });

  // 清空日志
  root.getElementById("btn-clear-logs")?.addEventListener("click", async () => {
    const { ClearImportLogs } = await import("../../../wailsjs/go/main/App.js");
    await ClearImportLogs();
    bus.emit("logs:refresh");
    bus.emit("toast:show", {
      msg: "🗑️ 日志已清空",
      duration: 2000,
      type: "info",
    });
  });
}

export function bindBusUpdates(root, stats, unsubs) {
  unsubs.push(
    bus.on("stats:updated", (s) => {
      if (s) Object.assign(stats, s);
      bus.emit("_preview:needs-update");
    }),
  );
}
