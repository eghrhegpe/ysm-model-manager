// ===== preview 事件层 =====

export function bindActions(root) {
  root.getElementById("btn-refresh")?.addEventListener("click", () => bus.emit("stats:refresh"));
  root.getElementById("btn-upload")?.addEventListener("click", () => bus.emit("stats:upload"));
  root.getElementById("btn-logs")?.addEventListener("click", () => bus.emit("stats:logs"));
}

export function bindBusUpdates(root, stats, unsubs) {
  unsubs.push(
    bus.on("stats:updated", (s) => {
      if (s) Object.assign(stats, s);
      // 触发更新由 index.js 的 _updateDisplay 完成
      // 但这里通过 bus 通知 index
      bus.emit("_preview:needs-update");
    })
  );
}
